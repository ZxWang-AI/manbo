import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@/server/db";
import { appendCaseRevision } from "@/server/repositories/case-repository";

export const DELETION_TARGETS = [
  "primary_record",
  "conversation_messages",
  "material_metadata",
  "object_store",
  "transcript_versions",
  "wrapped_keys",
  "search_index",
  "cache",
  "backup_queue",
] as const;

export interface DeletionReceipt {
  receiptId: string;
  caseId: string;
  deletedAt: string;
  targets: readonly (typeof DELETION_TARGETS)[number][];
  externalSystems: "not_applicable";
}

export function createDeletionReceipt(caseId: string, now: () => Date = () => new Date()): DeletionReceipt {
  const deletedAt = now();
  if (Number.isNaN(deletedAt.valueOf())) throw new Error("DELETION_TIME_INVALID");
  return {
    receiptId: randomUUID(),
    caseId,
    deletedAt: deletedAt.toISOString(),
    targets: [...DELETION_TARGETS],
    externalSystems: "not_applicable",
  };
}

export async function deleteCase(
  accountId: string,
  caseId: string,
  database: PrismaClient = prisma,
  now: () => Date = () => new Date(),
): Promise<DeletionReceipt> {
  const deletedAt = now();
  const receipt = createDeletionReceipt(caseId, () => deletedAt);
  await database.$transaction(async (transaction) => {
    const current = await transaction.caseRecord.findFirst({
      where: { accountId, caseId, visibility: "private" },
    });
    if (!current) throw new Error("CASE_NOT_FOUND");

    if (current.deletedAt === null) {
      const updated = await transaction.caseRecord.updateMany({
        where: { accountId, caseId, visibility: "private", deletedAt: null },
        data: { lifecycle: "deleted", deletedAt, updatedAt: deletedAt, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new Error("CASE_DELETE_CONFLICT");
      const deleted = await transaction.caseRecord.findFirstOrThrow({ where: { accountId, caseId } });
      await appendCaseRevision(transaction, deleted);

      await transaction.materialUploadReservation.updateMany({
        where: { accountId, caseId, status: "reserved" },
        data: { status: "deleted", updatedAt: deletedAt },
      });
      await transaction.material.updateMany({
        where: { accountId, caseId, deletedAt: null },
        data: { status: "deleted", deletedAt },
      });
      await transaction.voiceSession.updateMany({
        where: { accountId, caseId, status: "active" },
        data: { status: "ended", endedAt: deletedAt },
      });
      await transaction.auditEvent.create({
        data: {
          auditEventId: randomUUID(), accountId, caseId, action: "delete", metadata: {}, occurredAt: deletedAt,
        },
      });
    }

    for (const target of DELETION_TARGETS) {
      await transaction.cleanupJob.upsert({
        where: { caseId_target: { caseId, target } },
        create: { cleanupJobId: randomUUID(), accountId, caseId, target, status: "pending" },
        update: {},
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return receipt;
}

export async function processCleanupJob(
  cleanupJobId: string,
  processTarget: (target: string) => Promise<void>,
  database: PrismaClient = prisma,
): Promise<void> {
  const claimed = await database.cleanupJob.updateMany({
    where: { cleanupJobId, status: { in: ["pending", "failed"] } },
    data: { status: "running", attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return;
  const job = await database.cleanupJob.findUniqueOrThrow({ where: { cleanupJobId } });
  try {
    await processTarget(job.target);
    await database.cleanupJob.update({ where: { cleanupJobId }, data: { status: "completed", completedAt: new Date() } });
  } catch (error) {
    await database.cleanupJob.update({ where: { cleanupJobId }, data: { status: "failed" } });
    throw error;
  }
}
