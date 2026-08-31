import type {
  BeginObjectUpload,
  MaterialObjectStore,
} from "@/media/storage/object-store";
import type { MaterialReservationRepository } from "@/server/repositories/material-repository";

export interface MaterialUploadRequest {
  accountId: string;
  caseId: string;
  byteLength: number;
}

export class MaterialUploadService {
  constructor(
    private readonly repository: MaterialReservationRepository,
    private readonly objectStore: MaterialObjectStore,
  ) {}

  async reserve(input: MaterialUploadRequest) {
    const reservation = await this.repository.reserve(input);
    let uploadStarted = false;
    const beginInput: BeginObjectUpload = {
      uploadId: reservation.uploadId,
      objectKey: reservation.objectKey,
      expectedBytes: reservation.reservedBytes,
      encryptedEnvelope: { scheme: "AES-256-GCM", keyVersion: "pending" },
    };

    try {
      const started = await this.objectStore.beginEncryptedUpload(beginInput);
      uploadStarted = true;
      await this.repository.attachEncryption(input.accountId, reservation.uploadId, started.encryption);
      return { reservation, ...started };
    } catch (error) {
      if (uploadStarted) {
        await this.objectStore.abortUpload(reservation.uploadId);
      }
      await this.repository.release(input.accountId, reservation.uploadId);
      throw error;
    }
  }

  async complete(input: {
    accountId: string;
    uploadId: string;
    objectKey: string;
    expectedBytes: number;
    expectedSha256: string;
  }): Promise<void> {
    const reservation = await this.repository.findActive(input.accountId, input.uploadId);
    if (!reservation) {
      await this.repository.release(input.accountId, input.uploadId);
      throw new Error("MATERIAL_UPLOAD_UNAVAILABLE");
    }
    if (reservation.objectKey !== input.objectKey || reservation.reservedBytes !== input.expectedBytes) {
      throw new Error("MATERIAL_COMPLETION_METADATA_MISMATCH");
    }

    let result: Awaited<ReturnType<MaterialObjectStore["completeEncryptedUpload"]>> | null = null;
    try {
      result = await this.objectStore.completeEncryptedUpload(input);
      if (result.objectKey !== reservation.objectKey) {
        throw new Error("MATERIAL_OBJECT_KEY_MISMATCH");
      }
      if (result.storedBytes !== reservation.reservedBytes || result.sha256 !== input.expectedSha256) {
        throw new Error("MATERIAL_SIZE_OR_HASH_MISMATCH");
      }
      const completion = await this.repository.complete(input.accountId, input.uploadId, result);
      if (completion === "already_completed") return;
    } catch (error) {
      await Promise.allSettled([
        this.objectStore.abortUpload(input.uploadId),
        ...(result ? [this.objectStore.deleteObject(result.objectKey)] : []),
        this.repository.release(input.accountId, input.uploadId),
      ]);
      if (error instanceof Error && error.message === "MATERIAL_OBJECT_KEY_MISMATCH") {
        throw error;
      }
      if (error instanceof Error && error.message === "MATERIAL_SIZE_OR_HASH_MISMATCH") {
        throw error;
      }
      throw error;
    }
  }
}
