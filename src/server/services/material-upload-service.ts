import { createOpaqueMaterialObjectKey } from "@/domain/material";
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
    private readonly generateObjectKey: () => string = () => createOpaqueMaterialObjectKey(),
  ) {}

  async reserve(input: MaterialUploadRequest) {
    const reservation = await this.repository.reserve(input);
    let uploadStarted = false;
    const beginInput: BeginObjectUpload = {
      uploadId: reservation.uploadId,
      objectKey: reservation.objectKey || this.generateObjectKey(),
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
    const result = await this.objectStore.completeEncryptedUpload(input);
    if (result.storedBytes !== input.expectedBytes || result.sha256 !== input.expectedSha256) {
      await this.objectStore.abortUpload(input.uploadId);
      await this.repository.release(input.accountId, input.uploadId);
      throw new Error("MATERIAL_SIZE_OR_HASH_MISMATCH");
    }
    await this.repository.complete(input.accountId, input.uploadId, result);
  }
}
