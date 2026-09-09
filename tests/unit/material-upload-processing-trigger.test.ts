import { describe, expect, it, vi } from "vitest";

import { MaterialUploadService } from "@/server/services/material-upload-service";

const reservation = {
  uploadId: "upload-a",
  materialId: "material-a",
  caseId: "case-a",
  objectKey: "materials/11111111111111111111111111111111",
  reservedBytes: 4,
  expiresAt: "2026-09-04T00:00:00.000Z",
};

function makeRepository(status: "completed" | "already_completed") {
  return {
    reserve: vi.fn(),
    attachEncryption: vi.fn(),
    findActive: vi.fn().mockResolvedValue(reservation),
    complete: vi.fn().mockResolvedValue(status),
    release: vi.fn(),
  };
}

const objectStore = {
  beginEncryptedUpload: vi.fn(),
  completeEncryptedUpload: vi.fn().mockResolvedValue({
    objectKey: reservation.objectKey,
    sha256: "a".repeat(64),
    storedBytes: 4,
  }),
  abortUpload: vi.fn(),
  deleteObject: vi.fn(),
};

describe("material upload processing trigger", () => {
  it("enqueues the first completed upload with its ownership scope", async () => {
    const repository = makeRepository("completed");
    const enqueue = vi.fn().mockResolvedValue({ jobId: "job-a", status: "pending" });
    const service = new MaterialUploadService(repository, objectStore, { enqueue });

    await service.complete({
      accountId: "a".repeat(32),
      caseId: "case-a",
      uploadId: reservation.uploadId,
      objectKey: reservation.objectKey,
      expectedBytes: 4,
      expectedSha256: "a".repeat(64),
    });

    expect(enqueue).toHaveBeenCalledWith({
      accountId: "a".repeat(32),
      caseId: "case-a",
      materialId: reservation.materialId,
    });
  });

  it("does not enqueue a retry when the completion request is an idempotent replay", async () => {
    const repository = makeRepository("already_completed");
    const enqueue = vi.fn();
    const service = new MaterialUploadService(repository, objectStore, { enqueue });

    await service.complete({
      accountId: "a".repeat(32),
      caseId: "case-a",
      uploadId: reservation.uploadId,
      objectKey: reservation.objectKey,
      expectedBytes: 4,
      expectedSha256: "a".repeat(64),
    });

    expect(enqueue).not.toHaveBeenCalled();
  });
});
