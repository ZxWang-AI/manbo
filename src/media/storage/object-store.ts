export interface MultipartUploadTarget {
  uploadId: string;
  objectKey: string;
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

export interface MaterialObjectStore {
  beginEncryptedUpload(input: BeginObjectUpload): Promise<EncryptedUploadStart>;
  completeEncryptedUpload(input: CompleteObjectUpload): Promise<{
    objectKey: string;
    sha256: string;
    storedBytes: number;
  }>;
  abortUpload(uploadId: string): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
}
