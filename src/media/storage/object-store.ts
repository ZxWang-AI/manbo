export interface MultipartUploadTarget {
  uploadId: string;
  objectKey: string;
  /** Plaintext size of each non-final part. Clients use this to slice files. */
  partSizeBytes?: number;
  parts: Array<{ partNumber: number; url: string; expiresAt: string }>;
}

export interface BeginObjectUpload {
  uploadId: string;
  objectKey: string;
  expectedBytes: number;
  encryptedEnvelope: {
    scheme: "AES-256-GCM";
    keyVersion: string;
  };
}

export interface EncryptedUploadStart {
  uploadTarget: MultipartUploadTarget & { transport: "platform_encrypted_multipart" };
  encryption: {
    scheme: "AES-256-GCM";
    keyVersion: string;
    wrappedKey: string;
  };
}

export interface CompleteObjectUpload {
  uploadId: string;
  objectKey: string;
  expectedBytes: number;
  expectedSha256: string;
}

export interface UploadObjectPart {
  uploadId: string;
  partNumber: number;
  bytes: Uint8Array;
}

/**
 * A server-side read handle. Implementations must decrypt and authenticate the
 * object before returning the body; callers never receive an object-store URL.
 */
export interface ReadEncryptedObject {
  objectKey: string;
  encryptionScheme: string;
  keyVersion: string;
  wrappedKey: string;
}

export interface DecryptedObject {
  body: Uint8Array | ReadableStream<Uint8Array>;
  contentLength: number;
}

export interface MaterialObjectReader {
  readDecryptedObject(input: ReadEncryptedObject): Promise<DecryptedObject>;
}

export interface MaterialObjectStore {
  beginEncryptedUpload(input: BeginObjectUpload): Promise<EncryptedUploadStart>;
  /** Platform-encrypted adapters may expose server-mediated part upload. */
  uploadPart?(input: UploadObjectPart): Promise<void>;
  completeEncryptedUpload(input: CompleteObjectUpload): Promise<{
    objectKey: string;
    sha256: string;
    storedBytes: number;
  }>;
  abortUpload(uploadId: string): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
}
