import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import { PrismaCaseRepository } from "@/server/repositories/case-repository";
import { PrismaAppealRepository } from "@/server/repositories/appeal-repository";
import { deleteCase, DELETION_TARGETS, processCleanupJob } from "@/server/retention";
import { makeCaseRecordFixture } from "../fixtures/case-record";

function makeDraft() {
  const fixture = makeCaseRecordFixture();
  const { accountId, caseId, createdAt, deletedAt, updatedAt, version, ...draft } = fixture;
  void accountId; void caseId; void createdAt; void deletedAt; void updatedAt; void version;
  return { ...draft, lifecycle: "draft" as const };
}

describe("privacy lifecycle integration", () => {
  it("soft deletes a case and queues every platform-controlled cleanup target idempotently", async () => {
    const account = await new PrismaAccountRepository(prisma).createPseudonymous();
    const record = await new PrismaCaseRepository(prisma).createDraft(account.accountId, makeDraft());

    const first = await deleteCase(account.accountId, record.caseId, prisma, () => new Date("2026-09-02T00:00:00.000Z"));
    const second = await deleteCase(account.accountId, record.caseId, prisma, () => new Date("2026-09-02T00:01:00.000Z"));

    expect(first.targets).toEqual(DELETION_TARGETS);
    expect(second.targets).toEqual(DELETION_TARGETS);
    await expect(new PrismaCaseRepository(prisma).getPrivate(account.accountId, record.caseId)).resolves.toBeNull();
    await expect(prisma.cleanupJob.count({ where: { caseId: record.caseId } })).resolves.toBe(DELETION_TARGETS.length);
  });

  it("keeps appeal history append-only and binds supporting materials to the owner", async () => {
    const account = await new PrismaAccountRepository(prisma).createPseudonymous();
    const record = await new PrismaCaseRepository(prisma).createDraft(account.accountId, makeDraft());
    const review = await prisma.adminReviewVersion.create({
      data: {
        adminReviewVersionId: randomUUID(), caseId: record.caseId, reviewerId: "reviewer-a",
        status: "evidence_incomplete", rationale: null, sourceRefs: [], supersedesId: null, secondReviewerId: null,
      },
    });
    const appeals = new PrismaAppealRepository(prisma);

    const appeal = await appeals.create({
      appealId: randomUUID(), caseId: record.caseId, accountId: account.accountId,
      adminReviewVersionId: review.adminReviewVersionId, statement: "补充说明", supportingMaterialIds: [],
    });

    expect(appeal.status).toBe("submitted");
    await expect(appeals.listForOwner(account.accountId, record.caseId)).resolves.toHaveLength(1);
    await expect(prisma.auditEvent.findFirst({ where: { caseId: record.caseId, action: "update", metadata: { path: ["reviewStatus"], equals: "appeal_submitted" } } })).resolves.not.toBeNull();
    await expect(prisma.adminReviewVersion.findUniqueOrThrow({ where: { adminReviewVersionId: review.adminReviewVersionId } })).resolves.toMatchObject({ status: "evidence_incomplete" });
  });

  it("marks a cleanup job failed and allows a later retry to claim it", async () => {
    const account = await new PrismaAccountRepository(prisma).createPseudonymous();
    const record = await new PrismaCaseRepository(prisma).createDraft(account.accountId, makeDraft());
    await deleteCase(account.accountId, record.caseId, prisma);
    const job = await prisma.cleanupJob.findFirstOrThrow({ where: { caseId: record.caseId, target: "object_store" } });

    await expect(processCleanupJob(job.cleanupJobId, async () => { throw new Error("temporary"); }, prisma)).rejects.toThrow("temporary");
    await expect(prisma.cleanupJob.findUniqueOrThrow({ where: { cleanupJobId: job.cleanupJobId } })).resolves.toMatchObject({ status: "failed", attempts: 1 });
    await expect(processCleanupJob(job.cleanupJobId, async () => undefined, prisma)).resolves.toBeUndefined();
    await expect(prisma.cleanupJob.findUniqueOrThrow({ where: { cleanupJobId: job.cleanupJobId } })).resolves.toMatchObject({ status: "completed", attempts: 2 });
  });
});
