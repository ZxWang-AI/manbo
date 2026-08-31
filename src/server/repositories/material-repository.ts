import type { EncryptedUploadStart } from "@/media/storage/object-store";

export interface MaterialUploadReservation {
  uploadId: string;
  materialId: string;
  caseId: string;
  objectKey: string;
  reservedBytes: number;
  expiresAt: string;
}

export interface MaterialReservationRepository {
  reserve(input: {
    accountId: string;
    caseId: string;
    byteLength: number;
  }): Promise<MaterialUploadReservation>;
  attachEncryption(
    accountId: string,
    uploadId: string,
    encryption: EncryptedUploadStart["encryption"],
  ): Promise<void>;
  complete(
    accountId: string,
    uploadId: string,
    result: { objectKey: string; sha256: string; storedBytes: number },
  ): Promise<void>;
  release(accountId: string, uploadId: string): Promise<void>;
}
