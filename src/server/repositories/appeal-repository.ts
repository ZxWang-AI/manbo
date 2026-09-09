import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

export interface AppealRecord {
  appealId: string;
  caseId: string;
  accountId: string;
  adminReviewVersionId: string;
  statement: string;
  supportingMaterialIds: string[];
  status: "submitted" | "under_review" | "resolved";
  createdAt: string;
}

export interface AppealDraft {
  appealId: string;
  caseId: string;
  accountId: string;
  adminReviewVersionId: string;
  statement: string;
  supportingMaterialIds: readonly string[];
}

export interface AppealRepository {
  create(draft: AppealDraft): Promise<AppealRecord>;
  listForOwner(accountId: string, caseId: string): Promise<AppealRecord[]>;
}

function toDomain(row: {
  appealId: string;
  caseId: string;
  accountId: string;
  adminReviewVersionId: string;
  statement: string;
  supportingMaterialIds: Prisma.JsonValue;
  status: AppealRecord["status"];
  createdAt: Date;
}): AppealRecord {
  const supportingMaterialIds = Array.isArray(row.supportingMaterialIds)
    ? row.supportingMaterialIds.filter((value): value is string => typeof value === "string")
    : [];
  return {
    appealId: row.appealId,
    caseId: row.caseId,
    accountId: row.accountId,
    adminReviewVersionId: row.adminReviewVersionId,
    statement: row.statement,
    supportingMaterialIds,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class PrismaAppealRepository implements AppealRepository {
  constructor(private readonly database: PrismaClient) {}

  async create(draft: AppealDraft): Promise<AppealRecord> {
    const statement = draft.statement.trim();
    if (!statement) throw new Error("APPEAL_STATEMENT_REQUIRED");
    if (draft.supportingMaterialIds.some((id) => id.trim() === "")) {
      throw new Error("APPEAL_MATERIAL_ID_INVALID");
    }
    const row = await this.database.$transaction(async (transaction) => {
      const review = await transaction.adminReviewVersion.findFirst({
        where: {
          adminReviewVersionId: draft.adminReviewVersionId,
          case: { is: { caseId: draft.caseId, accountId: draft.accountId, visibility: "private", deletedAt: null } },
        },
        select: { adminReviewVersionId: true },
      });
      if (!review) throw new Error("APPEAL_REVIEW_NOT_FOUND");

      const materials = await transaction.material.findMany({
        where: {
          materialId: { in: [...draft.supportingMaterialIds] },
          caseId: draft.caseId,
          accountId: draft.accountId,
          status: "uploaded",
          deletedAt: null,
        },
        select: { materialId: true },
      });
      if (materials.length !== draft.supportingMaterialIds.length) {
        throw new Error("APPEAL_MATERIAL_NOT_OWNED");
      }

      const appeal = await transaction.appealRecord.create({
        data: {
          appealId: draft.appealId || randomUUID(),
          caseId: draft.caseId,
          accountId: draft.accountId,
          adminReviewVersionId: draft.adminReviewVersionId,
          statement,
          supportingMaterialIds: jsonInput(draft.supportingMaterialIds),
          status: "submitted",
        },
      });
      await transaction.auditEvent.create({
        data: {
          auditEventId: randomUUID(),
          accountId: draft.accountId,
          caseId: draft.caseId,
          action: "update",
          metadata: { reviewStatus: "appeal_submitted" },
        },
      });
      return appeal;
    });
    return toDomain(row);
  }

  async listForOwner(accountId: string, caseId: string): Promise<AppealRecord[]> {
    const rows = await this.database.appealRecord.findMany({
      where: { accountId, caseId, case: { is: { accountId, caseId, visibility: "private", deletedAt: null } } },
      orderBy: [{ createdAt: "asc" }, { appealId: "asc" }],
    });
    return rows.map(toDomain);
  }
}
