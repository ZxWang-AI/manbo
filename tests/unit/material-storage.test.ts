import { describe, expect, it } from "vitest";

import {
  MAX_CASE_MATERIAL_BYTES,
  MAX_MATERIAL_BYTES,
  MaterialStorageLimitExceeded,
  assertMaterialReservationAllowed,
  createOpaqueMaterialObjectKey,
} from "@/domain/material";
import type { MaterialObjectStore } from "@/media/storage/object-store";
import type { MaterialReservationRepository } from "@/server/repositories/material-repository";
import { MaterialUploadService } from "@/server/services/material-upload-service";

describe("material storage limits", () => {
  it("accepts the exact per-file and per-case limits", () => {
    expect(() =>
      assertMaterialReservationAllowed({
        byteLength: MAX_MATERIAL_BYTES,
        usedBytes: MAX_CASE_MATERIAL_BYTES - MAX_MATERIAL_BYTES,
        reservedBytes: 0,
      }),
    ).not.toThrow();
  });

  it("rejects a file larger than 100 MB before upload", () => {
    expect(() =>
      assertMaterialReservationAllowed({
        byteLength: MAX_MATERIAL_BYTES + 1,
        usedBytes: 0,
        reservedBytes: 0,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<MaterialStorageLimitExceeded>>({
        code: "FILE_STORAGE_LIMIT_EXCEEDED",
      }),
    );
  });

  it("counts active reservations toward the 2 GB case limit", () => {
    expect(() =>
      assertMaterialReservationAllowed({
        byteLength: 2,
        usedBytes: MAX_CASE_MATERIAL_BYTES - 2,
        reservedBytes: 1,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<MaterialStorageLimitExceeded>>({
        code: "CASE_STORAGE_LIMIT_EXCEEDED",
      }),
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid byte length: %s",
    (byteLength) => {
      expect(() =>
        assertMaterialReservationAllowed({ byteLength, usedBytes: 0, reservedBytes: 0 }),
      ).toThrow(/positive integer/i);
    },
  );

  it("creates an opaque object key that does not embed case or filename data", () => {
    const key = createOpaqueMaterialObjectKey(() => Buffer.alloc(16, 3));

    expect(key).toMatch(/^materials\/[a-f0-9]{32}$/);
    expect(key).not.toContain("case");
    expect(key).not.toContain("passport.pdf");
  });
});

describe("material upload service", () => {
  it("rejects an unavailable reservation before touching object storage", async () => {
    let objectStoreCalls = 0;
    const repository = {
      reserve: async () => {
        throw new Error("unused");
      },
      findActive: async () => null,
      attachEncryption: async () => undefined,
      complete: async () => "completed",
      release: async () => undefined,
    } as MaterialReservationRepository;
    const objectStore: MaterialObjectStore = {
      beginEncryptedUpload: async () => {
        throw new Error("unused");
      },
      completeEncryptedUpload: async () => {
        objectStoreCalls += 1;
        throw new Error("must not be called");
      },
      abortUpload: async () => undefined,
      deleteObject: async () => undefined,
    };

    await expect(
      new MaterialUploadService(repository, objectStore).complete({
        accountId: "acct-a",
        uploadId: "upload-a",
        objectKey: "materials/03030303030303030303030303030303",
        expectedBytes: 1024,
        expectedSha256: "a".repeat(64),
      }),
    ).rejects.toThrow("MATERIAL_UPLOAD_UNAVAILABLE");
    expect(objectStoreCalls).toBe(0);
  });

  it("rejects client completion metadata that differs from the canonical reservation", async () => {
    let objectStoreCalls = 0;
    const repository = {
      reserve: async () => {
        throw new Error("unused");
      },
      findActive: async () => ({
        uploadId: "upload-a",
        materialId: "material-a",
        caseId: "case-a",
        objectKey: "materials/03030303030303030303030303030303",
        reservedBytes: 1024,
        expiresAt: "2026-08-31T12:15:00.000Z",
      }),
      attachEncryption: async () => undefined,
      complete: async () => "completed",
      release: async () => undefined,
    } as MaterialReservationRepository;
    const objectStore: MaterialObjectStore = {
      beginEncryptedUpload: async () => {
        throw new Error("unused");
      },
      completeEncryptedUpload: async () => {
        objectStoreCalls += 1;
        throw new Error("must not be called");
      },
      abortUpload: async () => undefined,
      deleteObject: async () => undefined,
    };

    await expect(
      new MaterialUploadService(repository, objectStore).complete({
        accountId: "acct-a",
        uploadId: "upload-a",
        objectKey: "materials/04040404040404040404040404040404",
        expectedBytes: 1024,
        expectedSha256: "a".repeat(64),
      }),
    ).rejects.toThrow("MATERIAL_COMPLETION_METADATA_MISMATCH");
    expect(objectStoreCalls).toBe(0);
  });

  it("releases an atomic quota reservation when encrypted upload setup fails", async () => {
    const reservation = {
      uploadId: "upload-a",
      materialId: "material-a",
      caseId: "case-a",
      objectKey: "materials/03030303030303030303030303030303",
      reservedBytes: 1024,
      expiresAt: "2026-08-31T12:15:00.000Z",
    };
    const released: string[] = [];
    const repository: MaterialReservationRepository = {
      reserve: async () => reservation,
      findActive: async () => null,
      attachEncryption: async () => undefined,
      complete: async () => "completed",
      release: async (_accountId, uploadId) => {
        released.push(uploadId);
      },
    };
    const objectStore: MaterialObjectStore = {
      beginEncryptedUpload: async () => {
        throw new Error("object store unavailable");
      },
      completeEncryptedUpload: async () => {
        throw new Error("unused");
      },
      abortUpload: async () => undefined,
      deleteObject: async () => undefined,
    };
    const service = new MaterialUploadService(repository, objectStore);

    await expect(
      service.reserve({ accountId: "acct-a", caseId: "case-a", byteLength: 1024 }),
    ).rejects.toThrow("object store unavailable");
    expect(released).toEqual(["upload-a"]);
  });

  it("persists encryption metadata before returning a platform upload target", async () => {
    const attached: unknown[] = [];
    const repository: MaterialReservationRepository = {
      reserve: async () => ({
        uploadId: "upload-a",
        materialId: "material-a",
        caseId: "case-a",
        objectKey: "materials/03030303030303030303030303030303",
        reservedBytes: 1024,
        expiresAt: "2026-08-31T12:15:00.000Z",
      }),
      findActive: async () => null,
      attachEncryption: async (...args) => {
        attached.push(args);
      },
      complete: async () => "completed",
      release: async () => undefined,
    };
    const objectStore: MaterialObjectStore = {
      beginEncryptedUpload: async () => ({
        uploadTarget: {
          transport: "platform_encrypted_multipart",
          uploadId: "upload-a",
          objectKey: "materials/03030303030303030303030303030303",
          parts: [],
        },
        encryption: {
          scheme: "AES-256-GCM",
          keyVersion: "kek-v1",
          wrappedKey: "wrapped",
        },
      }),
      completeEncryptedUpload: async () => {
        throw new Error("unused");
      },
      abortUpload: async () => undefined,
      deleteObject: async () => undefined,
    };
    const service = new MaterialUploadService(repository, objectStore);

    const result = await service.reserve({
      accountId: "acct-a",
      caseId: "case-a",
      byteLength: 1024,
    });

    expect(result.uploadTarget.transport).toBe("platform_encrypted_multipart");
    expect(attached).toEqual([
      [
        "acct-a",
        "upload-a",
        { scheme: "AES-256-GCM", keyVersion: "kek-v1", wrappedKey: "wrapped" },
      ],
    ]);
  });

  it("aborts the multipart upload when encryption metadata cannot be persisted", async () => {
    const aborted: string[] = [];
    const repository: MaterialReservationRepository = {
      reserve: async () => ({
        uploadId: "upload-a",
        materialId: "material-a",
        caseId: "case-a",
        objectKey: "materials/03030303030303030303030303030303",
        reservedBytes: 1024,
        expiresAt: "2026-08-31T12:15:00.000Z",
      }),
      findActive: async () => null,
      attachEncryption: async () => {
        throw new Error("metadata write failed");
      },
      complete: async () => "completed",
      release: async () => undefined,
    };
    const objectStore: MaterialObjectStore = {
      beginEncryptedUpload: async () => ({
        uploadTarget: {
          transport: "platform_encrypted_multipart",
          uploadId: "upload-a",
          objectKey: "materials/03030303030303030303030303030303",
          parts: [],
        },
        encryption: { scheme: "AES-256-GCM", keyVersion: "kek-v1", wrappedKey: "wrapped" },
      }),
      completeEncryptedUpload: async () => ({
        objectKey: "materials/03030303030303030303030303030303",
        sha256: "hash",
        storedBytes: 1024,
      }),
      abortUpload: async (uploadId) => {
        aborted.push(uploadId);
      },
      deleteObject: async () => undefined,
    };

    await expect(
      new MaterialUploadService(repository, objectStore).reserve({
        accountId: "acct-a",
        caseId: "case-a",
        byteLength: 1024,
      }),
    ).rejects.toThrow("metadata write failed");
    expect(aborted).toEqual(["upload-a"]);
  });

  it("aborts and releases a completed upload when stored bytes or hash do not match", async () => {
    const aborted: string[] = [];
    const released: string[] = [];
    const repository: MaterialReservationRepository = {
      reserve: async () => {
        throw new Error("unused");
      },
      findActive: async () => ({
        uploadId: "upload-a",
        materialId: "material-a",
        caseId: "case-a",
        objectKey: "materials/03030303030303030303030303030303",
        reservedBytes: 1024,
        expiresAt: "2026-08-31T12:15:00.000Z",
      }),
      attachEncryption: async () => undefined,
      complete: async () => "completed",
      release: async (_accountId, uploadId) => {
        released.push(uploadId);
      },
    };
    const objectStore: MaterialObjectStore = {
      beginEncryptedUpload: async () => {
        throw new Error("unused");
      },
      completeEncryptedUpload: async () => ({
        objectKey: "materials/03030303030303030303030303030303",
        sha256: "wrong-hash",
        storedBytes: 1023,
      }),
      abortUpload: async (uploadId) => {
        aborted.push(uploadId);
      },
      deleteObject: async () => undefined,
    };

    await expect(
      new MaterialUploadService(repository, objectStore).complete({
        accountId: "acct-a",
        uploadId: "upload-a",
        objectKey: "materials/03030303030303030303030303030303",
        expectedBytes: 1024,
        expectedSha256: "hash",
      }),
    ).rejects.toThrow("MATERIAL_SIZE_OR_HASH_MISMATCH");
    expect(aborted).toEqual(["upload-a"]);
    expect(released).toEqual(["upload-a"]);
  });

  it("aborts and releases when the object store returns a different opaque object key", async () => {
    const aborted: string[] = [];
    const released: string[] = [];
    const repository: MaterialReservationRepository = {
      reserve: async () => {
        throw new Error("unused");
      },
      findActive: async () => ({
        uploadId: "upload-a",
        materialId: "material-a",
        caseId: "case-a",
        objectKey: "materials/03030303030303030303030303030303",
        reservedBytes: 1024,
        expiresAt: "2026-08-31T12:15:00.000Z",
      }),
      attachEncryption: async () => undefined,
      complete: async () => "completed",
      release: async (_accountId, uploadId) => {
        released.push(uploadId);
      },
    };
    const objectStore: MaterialObjectStore = {
      beginEncryptedUpload: async () => {
        throw new Error("unused");
      },
      completeEncryptedUpload: async () => ({
        objectKey: "materials/04040404040404040404040404040404",
        sha256: "hash",
        storedBytes: 1024,
      }),
      abortUpload: async (uploadId) => {
        aborted.push(uploadId);
      },
      deleteObject: async () => undefined,
    };

    await expect(
      new MaterialUploadService(repository, objectStore).complete({
        accountId: "acct-a",
        uploadId: "upload-a",
        objectKey: "materials/03030303030303030303030303030303",
        expectedBytes: 1024,
        expectedSha256: "hash",
      }),
    ).rejects.toThrow("MATERIAL_OBJECT_KEY_MISMATCH");
    expect(aborted).toEqual(["upload-a"]);
    expect(released).toEqual(["upload-a"]);
  });

  it("deletes a finalized object and releases quota when database completion fails", async () => {
    const deleted: string[] = [];
    const released: string[] = [];
    const repository = {
      reserve: async () => {
        throw new Error("unused");
      },
      findActive: async () => ({
        uploadId: "upload-a",
        materialId: "material-a",
        caseId: "case-a",
        objectKey: "materials/03030303030303030303030303030303",
        reservedBytes: 1024,
        expiresAt: "2026-08-31T12:15:00.000Z",
      }),
      attachEncryption: async () => undefined,
      complete: async () => {
        throw new Error("database unavailable");
      },
      release: async (_accountId: string, uploadId: string) => {
        released.push(uploadId);
      },
    } as MaterialReservationRepository;
    const objectStore: MaterialObjectStore = {
      beginEncryptedUpload: async () => {
        throw new Error("unused");
      },
      completeEncryptedUpload: async () => ({
        objectKey: "materials/03030303030303030303030303030303",
        sha256: "a".repeat(64),
        storedBytes: 1024,
      }),
      abortUpload: async () => undefined,
      deleteObject: async (objectKey) => {
        deleted.push(objectKey);
      },
    };

    await expect(
      new MaterialUploadService(repository, objectStore).complete({
        accountId: "acct-a",
        uploadId: "upload-a",
        objectKey: "materials/03030303030303030303030303030303",
        expectedBytes: 1024,
        expectedSha256: "a".repeat(64),
      }),
    ).rejects.toThrow("database unavailable");
    expect(deleted).toEqual(["materials/03030303030303030303030303030303"]);
    expect(released).toEqual(["upload-a"]);
  });
});
