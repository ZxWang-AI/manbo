import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  assertMaterialProcessingTransition,
  type MaterialProcessingRecord,
} from "@/domain/material";
import type { MaterialProcessingRepository } from "@/server/services/material-processing-service";

function toProcessingRecord(row: {
  materialId: string;
  declaredMime: string | null;
  originalFilename: string | null;
  processingState: MaterialProcessingRecord["processingState"];
  processingVersion: number;
  detectedMime: string | null;
  signatureStatus: MaterialProcessingRecord["signatureStatus"];
  eligibleForAi: boolean;
}): MaterialProcessingRecord {
  return {
    materialId: row.materialId,
    declaredMime: row.declaredMime,
    originalFilename: row.originalFilename ?? "unnamed-material",
    processingState: row.processingState,
    processingVersion: row.processingVersion,
    detectedMime: row.detectedMime,
    signatureStatus: row.signatureStatus,
    eligibleForAi: row.eligibleForAi,
  };
}

export class PrismaMaterialProcessingRepository implements MaterialProcessingRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly accountId: string,
    private readonly caseId: string,
  ) {}

  async get(materialId: string): Promise<MaterialProcessingRecord | null> {
    const row = await this.database.material.findFirst({
      where: {
        materialId,
        accountId: this.accountId,
        caseId: this.caseId,
        status: "uploaded",
        deletedAt: null,
        case: { is: { accountId: this.accountId, caseId: this.caseId, visibility: "private", deletedAt: null } },
      },
    });
    return row ? toProcessingRecord(row) : null;
  }

  async transition(
    materialId: string,
    expectedVersion: number,
    next: Partial<Pick<MaterialProcessingRecord, "processingState" | "detectedMime" | "signatureStatus" | "eligibleForAi">>,
  ): Promise<MaterialProcessingRecord> {
    const current = await this.get(materialId);
    if (!current || current.processingVersion !== expectedVersion || !next.processingState) {
      throw new Error("MATERIAL_PROCESSING_VERSION_CONFLICT");
    }
    assertMaterialProcessingTransition(current.processingState, next.processingState);
    if (next.eligibleForAi && next.processingState !== "parsed") {
      throw new Error("MATERIAL_AI_ELIGIBILITY_INVALID");
    }
    const updated = await this.database.material.updateMany({
      where: {
        materialId,
        accountId: this.accountId,
        caseId: this.caseId,
        processingVersion: expectedVersion,
        deletedAt: null,
      },
      data: {
        processingState: next.processingState,
        processingVersion: { increment: 1 },
        eligibleForAi: next.eligibleForAi ?? false,
        ...(next.detectedMime !== undefined ? { detectedMime: next.detectedMime } : {}),
        ...(next.signatureStatus ? { signatureStatus: next.signatureStatus } : {}),
      },
    });
    if (updated.count !== 1) throw new Error("MATERIAL_PROCESSING_VERSION_CONFLICT");
    const row = await this.get(materialId);
    if (!row) throw new Error("MATERIAL_NOT_FOUND");
    return row;
  }

  async addDerivative(derivative: {
    contentRef: string;
    sourceMaterialId: string;
    parserId: string;
  }): Promise<void> {
    const material = await this.database.material.findFirst({
      where: {
        materialId: derivative.sourceMaterialId,
        accountId: this.accountId,
        caseId: this.caseId,
        status: "uploaded",
        deletedAt: null,
      },
      select: { objectKey: true, sha256: true },
    });
    if (!material?.objectKey || !material.sha256) throw new Error("MATERIAL_SOURCE_UNAVAILABLE");
    await this.database.materialDerivative.upsert({
      where: {
        materialId_contentRef: {
          materialId: derivative.sourceMaterialId,
          contentRef: derivative.contentRef,
        },
      },
      create: {
        derivativeId: randomUUID(),
        materialId: derivative.sourceMaterialId,
        caseId: this.caseId,
        accountId: this.accountId,
        contentRef: derivative.contentRef,
        parserId: derivative.parserId,
        parserVersion: "1",
        sourceObjectKey: material.objectKey,
        sourceSha256: material.sha256,
      },
      update: {},
    });
  }

  async listAiEligibleContentRefs(materialId: string): Promise<string[]> {
    const rows = await this.database.materialDerivative.findMany({
      where: {
        materialId,
        accountId: this.accountId,
        caseId: this.caseId,
        material: {
          is: {
            accountId: this.accountId,
            caseId: this.caseId,
            processingState: "parsed",
            eligibleForAi: true,
            deletedAt: null,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      select: { contentRef: true },
    });
    return rows.map((row) => row.contentRef);
  }
}
