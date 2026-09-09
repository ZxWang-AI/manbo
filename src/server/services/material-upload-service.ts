import type {
  BeginObjectUpload,
  MaterialObjectStore,
} from "@/media/storage/object-store";
import type { MaterialReservationRepository } from "@/server/repositories/material-repository";
import type { MaterialProcessingQueue } from "./material-processing-queue";

export interface MaterialUploadRequest {
  accountId: string;
  caseId: string;
  byteLength: number;
  originalFilename?: string | undefined;
  declaredMime?: string | undefined;
}

export class MaterialUploadService {
  constructor(
    private readonly repository: MaterialReservationRepository,
    private readonly objectStore: MaterialObjectStore,
    private readonly processing?: MaterialProcessingQueue,
  ) {}

  async reserve(input: MaterialUploadRequest) {
    const reservation = await this.repository.reserve(input);
    if (
      this.repository.attachMetadata &&
      (input.originalFilename !== undefined || input.declaredMime !== undefined)
    ) {
      await this.repository.attachMetadata(input.accountId, reservation.uploadId, {
        ...(input.originalFilename !== undefined ? { originalFilename: input.originalFilename } : {}),
        ...(input.declaredMime !== undefined ? { declaredMime: input.declaredMime } : {}),
      });
    }
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
      return {
        reservation,
        ...started,
        uploadTarget: {
          ...started.uploadTarget,
          parts: started.uploadTarget.parts.map((part) => ({
            ...part,
            url: `/api/cases/${input.caseId}/materials/uploads/${reservation.uploadId}/parts/${part.partNumber}`,
          })),
        },
      };
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
    caseId: string;
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
    if (reservation.caseId !== input.caseId) {
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
      if (this.processing) {
        // Persistence of the original is authoritative. A transient queue
        // outage must not roll back or delete an already finalized object;
        // operators/users can retry processing through the dedicated endpoint.
        try {
          await this.processing.enqueue({
            accountId: input.accountId,
            caseId: reservation.caseId,
            materialId: reservation.materialId,
          });
        } catch {
          // Deliberately swallow queue failures after database completion.
        }
      }
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

  async uploadPart(input: {
    accountId: string;
    caseId: string;
    uploadId: string;
    partNumber: number;
    bytes: Uint8Array;
  }): Promise<void> {
    const reservation = await this.repository.findActive(input.accountId, input.uploadId);
    if (!reservation || reservation.caseId !== input.caseId) {
      throw new Error("MATERIAL_UPLOAD_UNAVAILABLE");
    }
    if (!this.objectStore.uploadPart) {
      throw new Error("MATERIAL_OBJECT_STORAGE_UNAVAILABLE");
    }
    await this.objectStore.uploadPart({
      uploadId: input.uploadId,
      partNumber: input.partNumber,
      bytes: input.bytes,
    });
  }

  async cancel(input: { accountId: string; caseId: string; uploadId: string }): Promise<void> {
    const reservation = await this.repository.findActive(input.accountId, input.uploadId);
    if (!reservation || reservation.caseId !== input.caseId) return;
    const results = await Promise.allSettled([
      this.objectStore.abortUpload(input.uploadId),
      this.repository.release(input.accountId, input.uploadId),
    ]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}
