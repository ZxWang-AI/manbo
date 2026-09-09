import type { PrismaClient } from "@prisma/client";

import type { MaterialProcessingSource, MaterialProcessingSourceRepository } from "@/server/services/material-processing-task-service";

export class PrismaMaterialProcessingSourceRepository implements MaterialProcessingSourceRepository {
  constructor(private readonly database: PrismaClient) {}

  async getSource(input: {
    accountId: string;
    caseId: string;
    materialId: string;
  }): Promise<MaterialProcessingSource | null> {
    const row = await this.database.material.findFirst({
      where: {
        materialId: input.materialId,
        caseId: input.caseId,
        accountId: input.accountId,
        status: "uploaded",
        deletedAt: null,
        case: {
          is: {
            caseId: input.caseId,
            accountId: input.accountId,
            visibility: "private",
            deletedAt: null,
          },
        },
      },
      select: {
        materialId: true,
        declaredMime: true,
        originalFilename: true,
        processingState: true,
        processingVersion: true,
        detectedMime: true,
        signatureStatus: true,
        eligibleForAi: true,
        objectKey: true,
        encryptionScheme: true,
        keyVersion: true,
        wrappedKey: true,
      },
    });
    if (!row) return null;
    return {
      materialId: row.materialId,
      declaredMime: row.declaredMime,
      originalFilename: row.originalFilename ?? "unnamed-material",
      processingState: row.processingState,
      processingVersion: row.processingVersion,
      detectedMime: row.detectedMime,
      signatureStatus: row.signatureStatus,
      eligibleForAi: row.eligibleForAi,
      objectKey: row.objectKey,
      encryptionScheme: row.encryptionScheme,
      keyVersion: row.keyVersion,
      wrappedKey: row.wrappedKey,
    };
  }
}
