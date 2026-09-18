import { randomUUID } from "node:crypto";

import {
  Prisma,
  type CaseRecord as PersistedCaseRecord,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";

import {
  caseRecordSchema,
  type CaseDraft,
  type CasePatch,
  type CaseRecord,
} from "@/domain/case-record";
import type { PrivateCaseListItem } from "@/domain/case-list";

export type { PrivateCaseListItem } from "@/domain/case-list";

const caseDraftSchema = caseRecordSchema.omit({
  caseId: true,
  accountId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  version: true,
});
export const casePatchSchema = caseRecordSchema
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
  listPrivate(accountId: string): Promise<PrivateCaseListItem[]>;
  getPrivate(accountId: string, caseId: string): Promise<CaseRecord | null>;
  getVersionPrivate(
    accountId: string,
    caseId: string,
    version: number,
  ): Promise<CaseRecord | null>;
  updatePrivate(
    accountId: string,
    caseId: string,
    patch: CasePatch,
    expectedVersion: number,
  ): Promise<CaseRecord>;
  markDeleted(accountId: string, caseId: string): Promise<void>;
}

export function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function casePatchUpdateData(parsed: z.infer<typeof casePatchSchema>, now: Date): Prisma.CaseRecordUpdateManyMutationInput {
  return {
    version: { increment: 1 },
    updatedAt: now,
    ...(parsed.jurisdiction ? { jurisdiction: jsonInput(parsed.jurisdiction) } : {}),
    ...(parsed.facts ? { facts: jsonInput(parsed.facts) } : {}),
    ...(parsed.timeline ? { timeline: jsonInput(parsed.timeline) } : {}),
    ...(parsed.iloIndicators ? { iloIndicators: jsonInput(parsed.iloIndicators) } : {}),
    ...(parsed.elements ? { elements: jsonInput(parsed.elements) } : {}),
    ...(parsed.evidenceCoverage ? { evidenceCoverage: jsonInput(parsed.evidenceCoverage) } : {}),
    ...(parsed.legalNavigation ? { legalNavigation: jsonInput(parsed.legalNavigation) } : {}),
    ...(parsed.referrals ? { referrals: jsonInput(parsed.referrals) } : {}),
    ...(parsed.safetyFlags ? { safetyFlags: jsonInput(parsed.safetyFlags) } : {}),
    ...(parsed.sourceTrace ? { sourceTrace: jsonInput(parsed.sourceTrace) } : {}),
    ...(parsed.consent ? { consent: jsonInput(parsed.consent) } : {}),
    ...(parsed.lifecycle ? { lifecycle: parsed.lifecycle } : {}),
    ...(parsed.aiReviewStatus ? { aiReviewStatus: parsed.aiReviewStatus } : {}),
  };
}

/** Apply only the case row update inside a caller-owned transaction. */
export async function applyPrivatePatchInTransaction(
  transaction: Prisma.TransactionClient,
  accountId: string,
  caseId: string,
  patch: CasePatch,
  expectedVersion: number,
  now: Date = new Date(),
): Promise<PersistedCaseRecord> {
  const parsed = casePatchSchema.parse(patch);
  if (parsed.lifecycle === "deleted") {
    throw new Error("Use markDeleted to preserve the deletion invariant");
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ConcurrencyConflict();
  }
  const updated = await transaction.caseRecord.updateMany({
    where: { accountId, caseId, visibility: "private", version: expectedVersion, deletedAt: null },
    data: casePatchUpdateData(parsed, now),
  });
  if (updated.count !== 1) throw new ConcurrencyConflict();
  const row = await transaction.caseRecord.findFirst({
    where: { accountId, caseId, visibility: "private", deletedAt: null },
  });
  if (!row) throw new ConcurrencyConflict();
  return row;
}

export function toDomainRecord(row: PersistedCaseRecord): CaseRecord {
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

export async function appendCaseRevision(
  transaction: Prisma.TransactionClient,
  row: PersistedCaseRecord,
): Promise<CaseRecord> {
  const snapshot = toDomainRecord(row);
  await transaction.caseRecordRevision.create({
    data: {
      revisionId: randomUUID(),
      caseId: row.caseId,
      accountId: row.accountId,
      version: row.version,
      snapshot: jsonInput(snapshot),
    },
  });
  return snapshot;
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
      await appendCaseRevision(transaction, created);
      return created;
    });

    return toDomainRecord(row);
  }

  async listPrivate(accountId: string): Promise<PrivateCaseListItem[]> {
    const rows = await this.database.caseRecord.findMany({
      where: { accountId, visibility: "private", deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { caseId: "asc" }],
      take: 100,
      select: {
        caseId: true,
        lifecycle: true,
        version: true,
        aiReviewStatus: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { materials: true } },
      },
    });

    return rows.map((row) => ({
      caseId: row.caseId,
      lifecycle: row.lifecycle,
      version: row.version,
      ...(row.aiReviewStatus ? { aiReviewStatus: row.aiReviewStatus as CaseRecord["aiReviewStatus"] } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      materialCount: row._count.materials,
    }));
  }

  async getPrivate(accountId: string, caseId: string): Promise<CaseRecord | null> {
    const row = await this.database.caseRecord.findFirst({
      where: { accountId, caseId, visibility: "private", deletedAt: null },
    });
    return row ? toDomainRecord(row) : null;
  }

  async getVersionPrivate(
    accountId: string,
    caseId: string,
    version: number,
  ): Promise<CaseRecord | null> {
    if (!Number.isInteger(version) || version < 1) {
      return null;
    }
    const revision = await this.database.caseRecordRevision.findFirst({
      where: {
        accountId,
        caseId,
        version,
        case: { is: { accountId, caseId, visibility: "private", deletedAt: null } },
      },
      select: { snapshot: true },
    });
    if (!revision) {
      return null;
    }
    const snapshot = caseRecordSchema.parse(revision.snapshot);
    if (
      snapshot.accountId !== accountId ||
      snapshot.caseId !== caseId ||
      snapshot.version !== version
    ) {
      throw new Error("Case revision snapshot does not match its ownership metadata");
    }
    return snapshot;
  }

  async updatePrivate(
    accountId: string,
    caseId: string,
    patch: CasePatch,
    expectedVersion: number,
  ): Promise<CaseRecord> {
    return this.database.$transaction(async (transaction) => {
      const row = await applyPrivatePatchInTransaction(
        transaction,
        accountId,
        caseId,
        patch,
        expectedVersion,
        this.now(),
      );
      await appendCaseRevision(transaction, row);
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
      const deletedRow = await transaction.caseRecord.findFirst({
        where: { accountId, caseId, visibility: "private", lifecycle: "deleted" },
      });
      if (!deletedRow) {
        throw new ConcurrencyConflict();
      }
      await appendCaseRevision(transaction, deletedRow);
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
