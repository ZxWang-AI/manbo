import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalEncryptedObjectStore } from "@/media/storage/local-object-store";

const stores: string[] = [];
const objectKey = "materials/0123456789abcdef0123456789abcdef";
const uploadId = "11111111-1111-4111-8111-111111111111";

async function makeStore() {
  const root = await mkdtemp(path.join(tmpdir(), "manbo-object-store-"));
  stores.push(root);
  return { root, store: new LocalEncryptedObjectStore({
    rootDir: root,
    keyVersion: "local-kek-v1",
    masterKey: Buffer.alloc(32, 7),
    partSizeBytes: 8,
  }) };
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local encrypted object store", () => {
  it("encrypts every uploaded part and supports an authenticated round trip", async () => {
    const { root, store } = await makeStore();
    const plaintext = Buffer.from("private material that must not be stored in plaintext");
    const started = await store.beginEncryptedUpload({
      uploadId,
      objectKey,
      expectedBytes: plaintext.byteLength,
      encryptedEnvelope: { scheme: "AES-256-GCM", keyVersion: "pending" },
    });

    expect(started.encryption).toMatchObject({ scheme: "AES-256-GCM", keyVersion: "local-kek-v1" });
    expect(started.encryption.wrappedKey).not.toContain(plaintext.toString("utf8"));
    expect(started.uploadTarget.parts.length).toBe(Math.ceil(plaintext.byteLength / 8));

    for (const part of started.uploadTarget.parts) {
      const begin = (part.partNumber - 1) * 8;
      await store.uploadPart({
        uploadId,
        partNumber: part.partNumber,
        bytes: plaintext.subarray(begin, Math.min(begin + 8, plaintext.byteLength)),
      });
    }

    const completed = await store.completeEncryptedUpload({
      uploadId,
      objectKey,
      expectedBytes: plaintext.byteLength,
      expectedSha256: createHash("sha256").update(plaintext).digest("hex"),
    });
    expect(completed).toMatchObject({ objectKey, storedBytes: plaintext.byteLength });

    const files = await readdir(root, { recursive: true });
    for (const file of files) {
      const absolute = path.join(root, String(file));
      if (!(await stat(absolute)).isFile()) continue;
      const contents = await readFile(absolute);
      expect(contents.toString("utf8")).not.toContain(plaintext.toString("utf8"));
    }

    const decrypted = await store.readDecryptedObject({
      objectKey,
      encryptionScheme: started.encryption.scheme,
      keyVersion: started.encryption.keyVersion,
      wrappedKey: started.encryption.wrappedKey,
    });
    expect(Buffer.from(decrypted.body as Uint8Array)).toEqual(plaintext);
    expect(decrypted.contentLength).toBe(plaintext.byteLength);
  });

  it("rejects a completed upload whose size or hash does not match", async () => {
    const { store } = await makeStore();
    await store.beginEncryptedUpload({
      uploadId,
      objectKey,
      expectedBytes: 3,
      encryptedEnvelope: { scheme: "AES-256-GCM", keyVersion: "pending" },
    });
    await store.uploadPart({ uploadId, partNumber: 1, bytes: Buffer.from("abc") });

    await expect(store.completeEncryptedUpload({
      uploadId,
      objectKey,
      expectedBytes: 3,
      expectedSha256: "0".repeat(64),
    })).rejects.toThrow("LOCAL_OBJECT_HASH_MISMATCH");
  });

  it("refuses to overwrite an already finalized object version", async () => {
    const { store } = await makeStore();
    const plaintext = Buffer.from("stable");
    const expectedSha256 = createHash("sha256").update(plaintext).digest("hex");

    await store.beginEncryptedUpload({
      uploadId,
      objectKey,
      expectedBytes: plaintext.byteLength,
      encryptedEnvelope: { scheme: "AES-256-GCM", keyVersion: "pending" },
    });
    await store.uploadPart({ uploadId, partNumber: 1, bytes: plaintext });
    await store.completeEncryptedUpload({ uploadId, objectKey, expectedBytes: plaintext.byteLength, expectedSha256 });

    await store.beginEncryptedUpload({
      uploadId: "22222222-2222-4222-8222-222222222222",
      objectKey,
      expectedBytes: plaintext.byteLength,
      encryptedEnvelope: { scheme: "AES-256-GCM", keyVersion: "pending" },
    });
    await store.uploadPart({ uploadId: "22222222-2222-4222-8222-222222222222", partNumber: 1, bytes: Buffer.from("change") });

    await expect(store.completeEncryptedUpload({
      uploadId: "22222222-2222-4222-8222-222222222222",
      objectKey,
      expectedBytes: plaintext.byteLength,
      expectedSha256,
    })).rejects.toThrow("LOCAL_OBJECT_ALREADY_EXISTS");
  });

  it("removes incomplete uploads and finalized objects without allowing path traversal", async () => {
    const { store } = await makeStore();
    await expect(store.beginEncryptedUpload({
      uploadId,
      objectKey: "../outside",
      expectedBytes: 1,
      encryptedEnvelope: { scheme: "AES-256-GCM", keyVersion: "pending" },
    })).rejects.toThrow("LOCAL_OBJECT_KEY_INVALID");

    await store.beginEncryptedUpload({
      uploadId,
      objectKey,
      expectedBytes: 1,
      encryptedEnvelope: { scheme: "AES-256-GCM", keyVersion: "pending" },
    });
    await store.abortUpload(uploadId);
    await expect(store.completeEncryptedUpload({
      uploadId,
      objectKey,
      expectedBytes: 1,
      expectedSha256: "0".repeat(64),
    })).rejects.toThrow("LOCAL_UPLOAD_NOT_FOUND");
    await expect(store.deleteObject(objectKey)).resolves.toBeUndefined();
  });
});
