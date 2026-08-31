import { randomUUID } from "node:crypto";

import {
  Prisma,
  type CaseRecord as PersistedCaseRecord,
  type PrismaClient,
} from "@prisma/client";

import {
  caseRecordSchema,
  type CaseDraft,
  type CasePatch,
  type CaseRecord,
} from "@/domain/case-record";

const caseDraftSchema = caseRecordSchema.omit({
  caseId: true,
  accountId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  version: true,
});
const casePatchSchema = caseRecordSchema
  .pick({
    jurisdiction: true,
    facts: true,
    timeline: true,
    iloIndicators: true,
    elements: true,
    evidenceCoverage: true,
    legalNavigation: true,
    referrals: true,
    safetyFlags: true,
    sourceTrace: true,
    consent: true,
    lifecycle: true,
    aiReviewStatus: true,
  })
  .partial();

export class ConcurrencyConflict extends Error {
  constructor() {
    super("Case version is stale or the private case is unavailable");
    this.name = "ConcurrencyConflict";
  }
}

export interface CaseRepository {
  createDraft(accountId: string, draft: CaseDraft): Promise<CaseRecord>;
  getPrivate(accountId: string, caseId: string): Promise<CaseRecord | null>;
  updatePrivate(
    accountId: string,
    caseId: string,
    patch: CasePatch,
    expectedVersion: number,
  ): Promise<CaseRecord>;
  markDeleted(accountId: string, caseId: string): Promise<void>;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toDomainRecord(row: PersistedCaseRecord): CaseRecord {
  return caseRecordSchema.parse({
    schemaVersion: row.schemaVersion,
    caseId: row.caseId,
    accountId: row.accountId,
    visibility: row.visibility,
    lifecycle: row.lifecycle,
    version: row.version,
    jurisdiction: row.jurisdiction,
    facts: row.facts,
    timeline: row.timeline,
    iloIndicators: row.iloIndicators,
    elements: row.elements,
    evidenceCoverage: row.evidenceCoverage,
    legalNavigation: row.legalNavigation,
    referrals: row.referrals,
    safetyFlags: row.safetyFlags,
    sourceTrace: row.sourceTrace,
    consent: row.consent,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.deletedAt ? { deletedAt: row.deletedAt.toISOString() } : {}),
    ...(row.aiReviewStatus ? { aiReviewStatus: row.aiReviewStatus } : {}),
  });
}

function auditMetadata(version: number): Prisma.InputJsonObject {
  return { version };
}

export class PrismaCaseRepository implements CaseRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createDraft(accountId: string, draft: CaseDraft): Promise<CaseRecord> {
    const parsed = caseDraftSchema.parse(draft);
    if (parsed.lifecycle !== "draft" || parsed.visibility !== "private") {
      throw new Error("createDraft requires a private draft lifecycle");
    }

    const caseId = randomUUID();
    const row = await this.database.$transaction(async (transaction) => {
      const created = await transaction.caseRecord.create({
        data: {
          caseId,
          accountId,
          schemaVersion: parsed.schemaVersion,
          visibility: "private",
          lifecycle: "draft",
          version: 1,
          jurisdiction: jsonInput(parsed.jurisdiction),
          facts: jsonInput(parsed.facts),
          timeline: jsonInput(parsed.timeline),
          iloIndicators: jsonInput(parsed.iloIndicators),
          elements: jsonInput(parsed.elements),
          evidenceCoverage: jsonInput(parsed.evidenceCoverage),
          legalNavigation: jsonInput(parsed.legalNavigation),
          referrals: jsonInput(parsed.referrals),
          safetyFlags: jsonInput(parsed.safetyFlags),
          sourceTrace: jsonInput(parsed.sourceTrace),
          consent: jsonInput(parsed.consent),
          ...(parsed.aiReviewStatus ? { aiReviewStatus: parsed.aiReviewStatus } : {}),
        },
      });
      await transaction.auditEvent.create({
        data: {
          auditEventId: randomUUID(),
          accountId,
          caseId,
          action: "create",
          metadata: auditMetadata(1),
        },
      });
      return created;
    });

    return toDomainRecord(row);
  }

  async getPrivate(accountId: string, caseId: string): Promise<CaseRecord | null> {
    const row = await this.database.caseRecord.findFirst({
      where: { accountId, caseId, visibility: "private", deletedAt: null },
    });
    return row ? toDomainRecord(row) : null;
  }

  async updatePrivate(
    accountId: string,
    caseId: string,
    patch: CasePatch,
    expectedVersion: number,
  ): Promise<CaseRecord> {
    const parsed = casePatchSchema.parse(patch);
    if (parsed.lifecycle === "deleted") {
      throw new Error("Use markDeleted to preserve the deletion invariant");
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ConcurrencyConflict();
    }

    const data: Prisma.CaseRecordUpdateManyMutationInput = {
      version: { increment: 1 },
      updatedAt: this.now(),
      ...(parsed.jurisdiction ? { jurisdiction: jsonInput(parsed.jurisdiction) } : {}),
      ...(parsed.facts ? { facts: jsonInput(parsed.facts) } : {}),
      ...(parsed.timeline ? { timeline: jsonInput(parsed.timeline) } : {}),
      ...(parsed.iloIndicators ? { iloIndicators: jsonInput(parsed.iloIndicators) } : {}),
      ...(parsed.elements ? { elements: jsonInput(parsed.elements) } : {}),
      ...(parsed.evidenceCoverage
        ? { evidenceCoverage: jsonInput(parsed.evidenceCoverage) }
        : {}),
      ...(parsed.legalNavigation
        ? { legalNavigation: jsonInput(parsed.legalNavigation) }
        : {}),
      ...(parsed.referrals ? { referrals: jsonInput(parsed.referrals) } : {}),
      ...(parsed.safetyFlags ? { safetyFlags: jsonInput(parsed.safetyFlags) } : {}),
      ...(parsed.sourceTrace ? { sourceTrace: jsonInput(parsed.sourceTrace) } : {}),
      ...(parsed.consent ? { consent: jsonInput(parsed.consent) } : {}),
      ...(parsed.lifecycle ? { lifecycle: parsed.lifecycle } : {}),
      ...(parsed.aiReviewStatus ? { aiReviewStatus: parsed.aiReviewStatus } : {}),
    };

    return this.database.$transaction(async (transaction) => {
      const updated = await transaction.caseRecord.updateMany({
        where: {
          accountId,
          caseId,
          visibility: "private",
          version: expectedVersion,
          deletedAt: null,
        },
        data,
      });
      if (updated.count !== 1) {
        throw new ConcurrencyConflict();
      }

      const row = await transaction.caseRecord.findFirst({
        where: { accountId, caseId, visibility: "private", deletedAt: null },
      });
      if (!row) {
        throw new ConcurrencyConflict();
      }
      await transaction.auditEvent.create({
        data: {
          auditEventId: randomUUID(),
          accountId,
          caseId,
          action: "update",
          metadata: auditMetadata(row.version),
        },
      });
      return toDomainRecord(row);
    });
  }

  async markDeleted(accountId: string, caseId: string): Promise<void> {
    const now = this.now();
    await this.database.$transaction(async (transaction) => {
      const deleted = await transaction.caseRecord.updateMany({
        where: { accountId, caseId, visibility: "private", deletedAt: null },
        data: {
          lifecycle: "deleted",
          deletedAt: now,
          updatedAt: now,
          version: { increment: 1 },
        },
      });
      if (deleted.count === 0) {
        return;
      }
      await transaction.auditEvent.create({
        data: {
          auditEventId: randomUUID(),
          accountId,
          caseId,
          action: "delete",
          metadata: {},
        },
      });
    });
  }
}
