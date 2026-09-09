import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import { PrismaCaseRepository } from "@/server/repositories/case-repository";
import { PrismaMaterialProcessingJobRepository } from "@/server/repositories/material-processing-job-repository";
import { makeCaseRecordFixture } from "../fixtures/case-record";

function makeDraft() {
  const fixture = makeCaseRecordFixture();
  const { accountId, caseId, createdAt, deletedAt, updatedAt, version, ...draft } = fixture;
  void accountId;
  void caseId;
  void createdAt;
  void deletedAt;
  void updatedAt;
  void version;
  return { ...draft, lifecycle: "draft" as const };
}

async function seedMaterial(accountId: string, caseId: string, materialId: string): Promise<void> {
  await prisma.material.create({
    data: {
      materialId,
      accountId,
      caseId,
      status: "uploaded",
      declaredBytes: 16,
      usedBytes: 16,
      objectKey: "materials/11111111111111111111111111111111",
      sha256: "a".repeat(64),
      encryptionScheme: "AES-256-GCM",
      keyVersion: "local-v1",
      wrappedKey: "wrapped-key",
      originalFilename: "statement.pdf",
      declaredMime: "application/pdf",
    },
  });
}

describe("durable material processing queue integration", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "realtime_voice_events", "voice_sessions", "transcript_confirmations", "transcript_versions", "material_derivatives", "material_object_versions", "material_processing_jobs", "material_upload_reservations", "materials", "appeal_records", "case_storage_usage", "conversation_messages", "consent_events", "audit_events", "cleanup_jobs", "admin_review_versions", "admin_case_change_versions", "case_record_revisions", "case_records", "auth_sessions", "recovery_throttles", "accounts" RESTART IDENTITY CASCADE',
    );
  });

  it("deduplicates repeated enqueue requests for one material", async () => {
    const account = await new PrismaAccountRepository(prisma).createPseudonymous();
    const record = await new PrismaCaseRepository(prisma).createDraft(account.accountId, makeDraft());
    const materialId = randomUUID();
    await seedMaterial(account.accountId, record.caseId, materialId);
    const repository = new PrismaMaterialProcessingJobRepository(prisma);
    const input = { accountId: account.accountId, caseId: record.caseId, materialId };

    const first = await repository.enqueue(input);
    const second = await repository.enqueue(input);

    expect(second.jobId).toBe(first.jobId);
    await expect(prisma.materialProcessingJob.count()).resolves.toBe(1);
  });

  it("recovers an expired lease, renews the new lease, and completes only for its owner", async () => {
    const account = await new PrismaAccountRepository(prisma).createPseudonymous();
    const record = await new PrismaCaseRepository(prisma).createDraft(account.accountId, makeDraft());
    const materialId = randomUUID();
    await seedMaterial(account.accountId, record.caseId, materialId);
    const repository = new PrismaMaterialProcessingJobRepository(prisma);
    const input = { accountId: account.accountId, caseId: record.caseId, materialId };
    const created = await repository.enqueue(input);
    const firstNow = new Date(created.availableAt);
    const firstClaim = await repository.claimNext("worker-a", { now: firstNow, leaseDurationMs: 1_000 });
    expect(firstClaim?.jobId).toBe(created.jobId);

    const recoveredAt = new Date(firstNow.getTime() + 1_000);
    const recovered = await repository.claimNext("worker-b", { now: recoveredAt, leaseDurationMs: 1_000 });
    expect(recovered).toMatchObject({ jobId: created.jobId, leasedBy: "worker-b", attempts: 2 });
    await expect(repository.complete(created.jobId, "worker-a", recoveredAt)).resolves.toBe(false);
    await expect(repository.renew(created.jobId, "worker-b", recoveredAt, 2_000)).resolves.toBe(true);
    await expect(repository.complete(created.jobId, "worker-b", new Date("2026-09-04T00:00:02.500Z"))).resolves.toBe(true);
    await expect(prisma.materialProcessingJob.findUniqueOrThrow({ where: { jobId: created.jobId } }))
      .resolves.toMatchObject({ status: "completed", leasedBy: null, leaseUntil: null });
  });

  it("backs off failed attempts and dead-letters after the configured maximum", async () => {
    const account = await new PrismaAccountRepository(prisma).createPseudonymous();
    const record = await new PrismaCaseRepository(prisma).createDraft(account.accountId, makeDraft());
    const materialId = randomUUID();
    await seedMaterial(account.accountId, record.caseId, materialId);
    const repository = new PrismaMaterialProcessingJobRepository(prisma);
    const input = { accountId: account.accountId, caseId: record.caseId, materialId };
    const created = await repository.enqueue(input);
    let now = new Date(created.availableAt);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimed = await repository.claimNext("worker-a", { now, leaseDurationMs: 1_000 });
      expect(claimed).toMatchObject({ jobId: created.jobId, attempts: attempt });
      await expect(repository.fail(created.jobId, "worker-a", "SCANNER_UNAVAILABLE", {
        now,
        attempts: attempt,
        maxAttempts: 5,
      })).resolves.toBe(true);
      const persisted = await prisma.materialProcessingJob.findUniqueOrThrow({ where: { jobId: created.jobId } });
      if (attempt < 5) {
        expect(persisted.status).toBe("failed");
        now = persisted.availableAt;
      } else {
        expect(persisted.status).toBe("dead_letter");
      }
    }
  });
});
