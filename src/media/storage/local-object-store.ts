import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { MAX_MATERIAL_BYTES } from "@/domain/material";
import type {
  BeginObjectUpload,
  CompleteObjectUpload,
  DecryptedObject,
  EncryptedUploadStart,
  MaterialObjectReader,
  MaterialObjectStore,
  ReadEncryptedObject,
} from "./object-store";

const ENVELOPE_SCHEME = "AES-256-GCM" as const;
const DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024;
const UPLOAD_TARGET_TTL_MS = 15 * 60 * 1000;

export interface LocalEncryptedObjectStoreOptions {
  rootDir: string;
  keyVersion: string;
  masterKey: Uint8Array;
  partSizeBytes?: number;
  now?: () => Date;
}

interface UploadMetadata {
  uploadId: string;
  objectKey: string;
  expectedBytes: number;
  partSizeBytes: number;
  keyVersion: string;
  wrappedKey: string;
}

interface EncryptedPart {
  partNumber: number;
  initializationVector: string;
  authenticationTag: string;
  ciphertext: string;
}

interface ObjectManifest {
  objectKey: string;
  storedBytes: number;
  sha256: string;
  encryption: {
    scheme: typeof ENVELOPE_SCHEME;
    keyVersion: string;
    wrappedKey: string;
  };
  parts: EncryptedPart[];
}

function assertSafeUploadId(uploadId: string): void {
  if (!/^[A-Za-z0-9_-]{1,120}$/u.test(uploadId)) {
    throw new Error("LOCAL_UPLOAD_ID_INVALID");
  }
}

function assertSafeObjectKey(objectKey: string): void {
  if (!/^materials\/[a-f0-9]{32}$/u.test(objectKey)) {
    throw new Error("LOCAL_OBJECT_KEY_INVALID");
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function encodePart(input: {
  key: Uint8Array;
  partNumber: number;
  bytes: Uint8Array;
}): EncryptedPart {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", input.key, initializationVector);
  const ciphertext = Buffer.concat([cipher.update(input.bytes), cipher.final()]);
  return {
    partNumber: input.partNumber,
    initializationVector: initializationVector.toString("base64url"),
    authenticationTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decodePart(part: EncryptedPart, key: Uint8Array): Buffer {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(part.initializationVector, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(part.authenticationTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(part.ciphertext, "base64url")),
    decipher.final(),
  ]);
}

function wrapKey(dataEncryptionKey: Uint8Array, masterKey: Uint8Array): string {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, initializationVector);
  const ciphertext = Buffer.concat([cipher.update(dataEncryptionKey), cipher.final()]);
  return JSON.stringify({
    scheme: ENVELOPE_SCHEME,
    initializationVector: initializationVector.toString("base64url"),
    authenticationTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}

function unwrapKey(wrappedKey: string, masterKey: Uint8Array): Buffer {
  let envelope: {
    scheme?: unknown;
    initializationVector?: unknown;
    authenticationTag?: unknown;
    ciphertext?: unknown;
  };
  try {
    envelope = JSON.parse(wrappedKey) as typeof envelope;
  } catch {
    throw new Error("LOCAL_WRAPPED_KEY_INVALID");
  }
  if (
    envelope.scheme !== ENVELOPE_SCHEME ||
    typeof envelope.initializationVector !== "string" ||
    typeof envelope.authenticationTag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("LOCAL_WRAPPED_KEY_INVALID");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      masterKey,
      Buffer.from(envelope.initializationVector, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64url"));
    const key = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
    if (key.byteLength !== 32) throw new Error("LOCAL_DATA_KEY_INVALID");
    return key;
  } catch (error) {
    if (error instanceof Error && error.message === "LOCAL_DATA_KEY_INVALID") throw error;
    throw new Error("LOCAL_WRAPPED_KEY_INVALID");
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${randomBytes(8).toString("hex")}`;
  await writeFile(temporaryPath, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export class LocalEncryptedObjectStore implements MaterialObjectStore, MaterialObjectReader {
  private readonly rootDir: string;
  private readonly keyVersion: string;
  private readonly masterKey: Uint8Array;
  private readonly partSizeBytes: number;
  private readonly now: () => Date;

  constructor(options: LocalEncryptedObjectStoreOptions) {
    if (!options.rootDir || path.isAbsolute(options.rootDir) === false) {
      throw new TypeError("rootDir must be an absolute path");
    }
    if (!options.keyVersion || options.keyVersion.length > 80) {
      throw new TypeError("keyVersion must be a non-empty short identifier");
    }
    if (options.masterKey.byteLength !== 32) {
      throw new TypeError("masterKey must contain 32 bytes");
    }
    const partSizeBytes = options.partSizeBytes ?? DEFAULT_PART_SIZE_BYTES;
    assertPositiveInteger(partSizeBytes, "partSizeBytes");
    if (partSizeBytes > MAX_MATERIAL_BYTES) {
      throw new TypeError("partSizeBytes cannot exceed the per-file material limit");
    }
    this.rootDir = path.resolve(options.rootDir);
    this.keyVersion = options.keyVersion;
    this.masterKey = new Uint8Array(options.masterKey);
    this.partSizeBytes = partSizeBytes;
    this.now = options.now ?? (() => new Date());
  }

  async beginEncryptedUpload(input: BeginObjectUpload): Promise<EncryptedUploadStart> {
    assertSafeUploadId(input.uploadId);
    assertSafeObjectKey(input.objectKey);
    assertPositiveInteger(input.expectedBytes, "expectedBytes");
    if (input.expectedBytes > MAX_MATERIAL_BYTES) {
      throw new Error("LOCAL_OBJECT_SIZE_LIMIT_EXCEEDED");
    }
    if (input.encryptedEnvelope.scheme !== ENVELOPE_SCHEME) {
      throw new Error("LOCAL_ENVELOPE_SCHEME_INVALID");
    }

    const uploadDir = this.uploadDir(input.uploadId);
    await mkdir(uploadDir, { recursive: true, mode: 0o700 });
    const metadataPath = path.join(uploadDir, "metadata.json");
    try {
      await readFile(metadataPath, "utf8");
      throw new Error("LOCAL_UPLOAD_ALREADY_EXISTS");
    } catch (error) {
      if (error instanceof Error && error.message === "LOCAL_UPLOAD_ALREADY_EXISTS") throw error;
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }

    const dataEncryptionKey = randomBytes(32);
    const metadata: UploadMetadata = {
      uploadId: input.uploadId,
      objectKey: input.objectKey,
      expectedBytes: input.expectedBytes,
      partSizeBytes: this.partSizeBytes,
      keyVersion: this.keyVersion,
      wrappedKey: wrapKey(dataEncryptionKey, this.masterKey),
    };
    await writeJsonAtomically(metadataPath, metadata);

    const partCount = Math.ceil(input.expectedBytes / this.partSizeBytes);
    const expiresAt = new Date(this.now().getTime() + UPLOAD_TARGET_TTL_MS).toISOString();
    return {
      uploadTarget: {
        transport: "platform_encrypted_multipart",
        uploadId: input.uploadId,
        objectKey: input.objectKey,
        partSizeBytes: this.partSizeBytes,
        parts: Array.from({ length: partCount }, (_, index) => ({
          partNumber: index + 1,
          url: `/api/material-uploads/${input.uploadId}/parts/${index + 1}`,
          expiresAt,
        })),
      },
      encryption: {
        scheme: ENVELOPE_SCHEME,
        keyVersion: this.keyVersion,
        wrappedKey: metadata.wrappedKey,
      },
    };
  }

  async uploadPart(input: { uploadId: string; partNumber: number; bytes: Uint8Array }): Promise<void> {
    assertSafeUploadId(input.uploadId);
    assertPositiveInteger(input.partNumber, "partNumber");
    if (input.bytes.byteLength === 0) throw new Error("LOCAL_OBJECT_PART_EMPTY");
    const metadata = await this.readUploadMetadata(input.uploadId);
    const partCount = Math.ceil(metadata.expectedBytes / metadata.partSizeBytes);
    if (input.partNumber > partCount) throw new Error("LOCAL_OBJECT_PART_INVALID");
    const expectedPartBytes = input.partNumber === partCount
      ? metadata.expectedBytes - ((input.partNumber - 1) * metadata.partSizeBytes)
      : metadata.partSizeBytes;
    if (input.bytes.byteLength !== expectedPartBytes) {
      throw new Error("LOCAL_OBJECT_PART_SIZE_MISMATCH");
    }
    const key = unwrapKey(metadata.wrappedKey, this.masterKey);
    await writeJsonAtomically(
      path.join(this.uploadDir(input.uploadId), `part-${input.partNumber}.json`),
      encodePart({ key, partNumber: input.partNumber, bytes: input.bytes }),
    );
  }

  async completeEncryptedUpload(input: CompleteObjectUpload): Promise<{
    objectKey: string;
    sha256: string;
    storedBytes: number;
  }> {
    assertSafeUploadId(input.uploadId);
    assertSafeObjectKey(input.objectKey);
    assertPositiveInteger(input.expectedBytes, "expectedBytes");
    const metadata = await this.readUploadMetadata(input.uploadId);
    if (metadata.objectKey !== input.objectKey || metadata.expectedBytes !== input.expectedBytes) {
      throw new Error("LOCAL_OBJECT_METADATA_MISMATCH");
    }
    try {
      await readFile(this.objectPath(input.objectKey), "utf8");
      throw new Error("LOCAL_OBJECT_ALREADY_EXISTS");
    } catch (error) {
      if (error instanceof Error && error.message === "LOCAL_OBJECT_ALREADY_EXISTS") throw error;
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const key = unwrapKey(metadata.wrappedKey, this.masterKey);
    const partCount = Math.ceil(metadata.expectedBytes / metadata.partSizeBytes);
    const parts: EncryptedPart[] = [];
    const digest = createHash("sha256");
    let storedBytes = 0;
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      const partPath = path.join(this.uploadDir(input.uploadId), `part-${partNumber}.json`);
      let part: EncryptedPart;
      try {
        part = JSON.parse(await readFile(partPath, "utf8")) as EncryptedPart;
      } catch {
        throw new Error("LOCAL_OBJECT_PART_MISSING");
      }
      const plaintext = decodePart(part, key);
      storedBytes += plaintext.byteLength;
      digest.update(plaintext);
      parts.push(part);
    }
    if (storedBytes !== metadata.expectedBytes || storedBytes !== input.expectedBytes) {
      throw new Error("LOCAL_OBJECT_SIZE_MISMATCH");
    }
    const sha256 = digest.digest("hex");
    if (sha256 !== input.expectedSha256) throw new Error("LOCAL_OBJECT_HASH_MISMATCH");

    const manifest: ObjectManifest = {
      objectKey: metadata.objectKey,
      storedBytes,
      sha256,
      encryption: {
        scheme: ENVELOPE_SCHEME,
        keyVersion: metadata.keyVersion,
        wrappedKey: metadata.wrappedKey,
      },
      parts,
    };
    const objectPath = this.objectPath(input.objectKey);
    await mkdir(path.dirname(objectPath), { recursive: true, mode: 0o700 });
    await writeJsonAtomically(objectPath, manifest);
    await rm(this.uploadDir(input.uploadId), { recursive: true, force: true });
    return { objectKey: input.objectKey, sha256, storedBytes };
  }

  async readDecryptedObject(input: ReadEncryptedObject): Promise<DecryptedObject> {
    assertSafeObjectKey(input.objectKey);
    const manifest = await this.readObjectManifest(input.objectKey);
    if (
      manifest.encryption.scheme !== input.encryptionScheme ||
      manifest.encryption.keyVersion !== input.keyVersion ||
      manifest.encryption.wrappedKey !== input.wrappedKey
    ) {
      throw new Error("LOCAL_OBJECT_ENVELOPE_MISMATCH");
    }
    const key = unwrapKey(manifest.encryption.wrappedKey, this.masterKey);
    const plaintext = Buffer.concat(manifest.parts.map((part) => decodePart(part, key)));
    if (plaintext.byteLength !== manifest.storedBytes || createHash("sha256").update(plaintext).digest("hex") !== manifest.sha256) {
      throw new Error("LOCAL_OBJECT_INTEGRITY_FAILURE");
    }
    return { body: plaintext, contentLength: plaintext.byteLength };
  }

  async abortUpload(uploadId: string): Promise<void> {
    assertSafeUploadId(uploadId);
    await rm(this.uploadDir(uploadId), { recursive: true, force: true });
  }

  async deleteObject(objectKey: string): Promise<void> {
    assertSafeObjectKey(objectKey);
    await rm(this.objectPath(objectKey), { force: true });
  }

  private uploadDir(uploadId: string): string {
    return path.join(this.rootDir, "uploads", uploadId);
  }

  private objectPath(objectKey: string): string {
    assertSafeObjectKey(objectKey);
    return path.join(this.rootDir, "objects", `${objectKey.slice("materials/".length)}.json`);
  }

  private async readUploadMetadata(uploadId: string): Promise<UploadMetadata> {
    try {
      return JSON.parse(await readFile(path.join(this.uploadDir(uploadId), "metadata.json"), "utf8")) as UploadMetadata;
    } catch {
      throw new Error("LOCAL_UPLOAD_NOT_FOUND");
    }
  }

  private async readObjectManifest(objectKey: string): Promise<ObjectManifest> {
    try {
      return JSON.parse(await readFile(this.objectPath(objectKey), "utf8")) as ObjectManifest;
    } catch {
      throw new Error("LOCAL_OBJECT_NOT_FOUND");
    }
  }
}
