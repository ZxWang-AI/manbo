import type { PrismaClient } from "@prisma/client";

import { caseRecordSchema, type CaseRecord } from "@/domain/case-record";
import type { CasePatch } from "@/domain/case-record";
import { PrismaCaseRepository } from "@/server/repositories/case-repository";
import type {
  AdminCaseListItem,
  AdminCaseRepository,
  AdminCaseView,
  AdminMaterialSummary,
} from "@/server/admin/admin-case-service";

function toRecord(row: {
  schemaVersion: string;
  caseId: string;
  accountId: string;
  visibility: string;
  lifecycle: string;
  version: number;
  jurisdiction: unknown;
  facts: unknown;
  timeline: unknown;
  iloIndicators: unknown;
  elements: unknown;
  evidenceCoverage: unknown;
  legalNavigation: unknown;
  referrals: unknown;
  safetyFlags: unknown;
  sourceTrace: unknown;
  consent: unknown;
  aiReviewStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): CaseRecord {
  return caseRecordSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.deletedAt ? { deletedAt: row.deletedAt.toISOString() } : {}),
    ...(row.aiReviewStatus ? { aiReviewStatus: row.aiReviewStatus } : {}),
  });
}

function toMaterial(row: {
  materialId: string;
  originalFilename: string | null;
  declaredBytes: bigint;
  declaredMime: string | null;
  processingState: string;
  eligibleForAi: boolean;
  createdAt: Date;
}): AdminMaterialSummary {
  return {
    materialId: row.materialId,
    originalFilename: row.originalFilename,
    declaredBytes: Number(row.declaredBytes),
    declaredMime: row.declaredMime,
    processingState: row.processingState,
    eligibleForAi: row.eligibleForAi,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PrismaAdminCaseRepository implements AdminCaseRepository {
  constructor(private readonly database: PrismaClient) {}

  async listActive(): Promise<AdminCaseListItem[]> {
    const rows = await this.database.caseRecord.findMany({
      where: { visibility: "private", deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        caseId: true,
        lifecycle: true,
        aiReviewStatus: true,
        updatedAt: true,
        _count: { select: { materials: { where: { deletedAt: null, status: "uploaded" } } } },
      },
    });
    return rows.map((row) => ({
      caseId: row.caseId,
      lifecycle: row.lifecycle,
      ...(row.aiReviewStatus ? { aiReviewStatus: row.aiReviewStatus as CaseRecord["aiReviewStatus"] } : {}),
      updatedAt: row.updatedAt.toISOString(),
      materialCount: row._count.materials,
    }));
  }

  async getActive(caseId: string): Promise<AdminCaseView | null> {
    const row = await this.database.caseRecord.findFirst({
      where: { caseId, visibility: "private", deletedAt: null },
      include: {
        materials: {
          where: { deletedAt: null, status: "uploaded" },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!row) return null;
    return {
      record: toRecord(row),
      materials: row.materials.map(toMaterial),
    };
  }

  async updateActive(caseId: string, patch: CasePatch, expectedVersion: number): Promise<AdminCaseView> {
    const current = await this.getActive(caseId);
    if (!current) throw new Error("ADMIN_CASE_NOT_FOUND");
    await new PrismaCaseRepository(this.database).updatePrivate(
      current.record.accountId,
      caseId,
      patch,
      expectedVersion,
    );
    const updated = await this.getActive(caseId);
    if (!updated) throw new Error("ADMIN_CASE_NOT_FOUND");
    return updated;
  }

  async deleteActive(caseId: string): Promise<void> {
    const current = await this.getActive(caseId);
    if (!current) throw new Error("ADMIN_CASE_NOT_FOUND");
    await new PrismaCaseRepository(this.database).markDeleted(current.record.accountId, caseId);
  }
}
