import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  createAdminReviewVersion,
  type AdminReviewVersion,
  type AdminReviewVersionDraft,
} from "@/domain/admin-review";

export interface AdminReviewRepository {
  create(draft: AdminReviewVersionDraft): Promise<AdminReviewVersion>;
  findForCase(caseId: string): Promise<AdminReviewVersion[]>;
  findByIdForCase(caseId: string, reviewId: string): Promise<AdminReviewVersion | null>;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toDomain(row: {
  adminReviewVersionId: string;
  caseId: string;
  reviewerId: string;
  status: AdminReviewVersion["status"];
  rationale: string | null;
  sourceRefs: Prisma.JsonValue;
  supersedesId: string | null;
  secondReviewerId: string | null;
  createdAt: Date;
}): AdminReviewVersion {
  const sourceRefs = Array.isArray(row.sourceRefs)
    ? row.sourceRefs.filter((value): value is string => typeof value === "string")
    : [];
  return createAdminReviewVersion({
    adminReviewVersionId: row.adminReviewVersionId,
    caseId: row.caseId,
    reviewerId: row.reviewerId,
    status: row.status,
    rationale: row.rationale,
    sourceRefs,
    supersedesId: row.supersedesId,
    secondReviewerId: row.secondReviewerId,
  }, () => row.createdAt);
}

export class PrismaAdminReviewRepository implements AdminReviewRepository {
  constructor(private readonly database: PrismaClient) {}

  async create(draft: AdminReviewVersionDraft): Promise<AdminReviewVersion> {
    const review = createAdminReviewVersion(draft);
    const row = await this.database.adminReviewVersion.create({
      data: {
        adminReviewVersionId: review.adminReviewVersionId || randomUUID(),
        caseId: review.caseId,
        reviewerId: review.reviewerId,
        status: review.status,
        rationale: review.rationale,
        sourceRefs: jsonInput(review.sourceRefs),
        supersedesId: review.supersedesId,
        secondReviewerId: review.secondReviewerId,
        createdAt: new Date(review.createdAt),
      },
    });
    return toDomain(row);
  }

  async findForCase(caseId: string): Promise<AdminReviewVersion[]> {
    const rows = await this.database.adminReviewVersion.findMany({
      where: { caseId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async findByIdForCase(caseId: string, reviewId: string): Promise<AdminReviewVersion | null> {
    const row = await this.database.adminReviewVersion.findFirst({
      where: { caseId, adminReviewVersionId: reviewId },
    });
    return row ? toDomain(row) : null;
  }
}
