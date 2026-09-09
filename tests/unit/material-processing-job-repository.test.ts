import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMaterialProcessingJobRepository } from "@/server/repositories/material-processing-job-repository";

const input = {
  accountId: "a".repeat(32),
  caseId: "00000000-0000-4000-8000-000000000001",
  materialId: "00000000-0000-4000-8000-000000000002",
};

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "00000000-0000-4000-8000-000000000003",
    ...input,
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    availableAt: new Date("2026-09-04T00:00:00.000Z"),
    leaseUntil: null,
    leasedBy: null,
    lastErrorCode: null,
    createdAt: new Date("2026-09-04T00:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    updatedAt: new Date("2026-09-04T00:00:00.000Z"),
    ...overrides,
  };
}

describe("durable material processing job repository", () => {
  it("enqueues a pending job with retry policy and returns an existing active job", async () => {
    const existing = jobRow();
    const database = {
      materialProcessingJob: {
        findFirst: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
    } as unknown as PrismaClient;
    const repository = new PrismaMaterialProcessingJobRepository(database);

    await expect(repository.enqueue(input)).resolves.toMatchObject({
      jobId: existing.jobId,
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
    });
    expect(database.materialProcessingJob.create).not.toHaveBeenCalled();
  });

  it("keeps a retryable failed job active so a manual retry cannot duplicate it", async () => {
    const retryable = jobRow({ status: "failed", attempts: 2 });
    const findFirst = vi.fn().mockResolvedValue(retryable);
    const database = {
      materialProcessingJob: { findFirst, create: vi.fn() },
    } as unknown as PrismaClient;

    await expect(new PrismaMaterialProcessingJobRepository(database).enqueue(input)).resolves.toMatchObject({
      jobId: retryable.jobId,
      status: "failed",
    });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["pending", "processing", "failed"] } }),
    }));
    expect(database.materialProcessingJob.create).not.toHaveBeenCalled();
  });

  it("claims the oldest available job with a worker lease", async () => {
    const pending = jobRow();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      materialProcessingJob: {
        findFirst: vi.fn().mockResolvedValue(pending),
        updateMany,
      },
    }));
    const database = { $transaction: transaction } as unknown as PrismaClient;
    const repository = new PrismaMaterialProcessingJobRepository(database);

    await expect(repository.claimNext("worker-a", {
      now: new Date("2026-09-04T00:01:00.000Z"),
      leaseDurationMs: 30_000,
    })).resolves.toMatchObject({
      jobId: pending.jobId,
      status: "processing",
      leasedBy: "worker-a",
      attempts: 1,
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ jobId: pending.jobId }),
      data: expect.objectContaining({ status: "processing", leasedBy: "worker-a", attempts: { increment: 1 } }),
    }));
  });

  it("recovers a lease that expires exactly at the claim timestamp", async () => {
    const now = new Date("2026-09-04T00:01:00.000Z");
    const expired = jobRow({
      status: "processing",
      attempts: 2,
      startedAt: new Date("2026-09-04T00:00:00.000Z"),
      leaseUntil: now,
      leasedBy: "worker-old",
    });
    const findFirst = vi.fn().mockResolvedValue(expired);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      materialProcessingJob: { findFirst, updateMany },
    }));
    const database = { $transaction: transaction } as unknown as PrismaClient;

    await expect(new PrismaMaterialProcessingJobRepository(database).claimNext("worker-new", {
      now,
      leaseDurationMs: 30_000,
    })).resolves.toMatchObject({
      status: "processing",
      leasedBy: "worker-new",
      attempts: 3,
    });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { status: "processing", leaseUntil: { lte: now } },
        ]),
      }),
    }));
  });

  it("dead-letters an expired final-attempt lease without running it again", async () => {
    const now = new Date("2026-09-04T00:01:00.000Z");
    const finalAttempt = jobRow({
      status: "processing",
      attempts: 5,
      maxAttempts: 5,
      leaseUntil: new Date("2026-09-04T00:00:30.000Z"),
      leasedBy: "worker-crashed",
    });
    const findFirst = vi.fn()
      .mockResolvedValueOnce(finalAttempt)
      .mockResolvedValueOnce(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      materialProcessingJob: { findFirst, updateMany },
    }));
    const database = { $transaction: transaction } as unknown as PrismaClient;

    await expect(new PrismaMaterialProcessingJobRepository(database).claimNext("worker-new", { now })).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        jobId: finalAttempt.jobId,
        status: "processing",
        leaseUntil: { lte: now },
      }),
      data: expect.objectContaining({
        status: "dead_letter",
        completedAt: now,
        lastErrorCode: "PROCESSING_LEASE_EXPIRED",
      }),
    }));
  });

  it("requires the current lease owner for completion and failure updates", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const database = { materialProcessingJob: { updateMany } } as unknown as PrismaClient;
    const repository = new PrismaMaterialProcessingJobRepository(database);

    await expect(repository.complete("job-a", "worker-old", new Date())).resolves.toBe(false);
    await expect(repository.fail("job-a", "worker-old", "PROCESSING_TASK_FAILED", {
      attempts: 1,
      maxAttempts: 5,
      now: new Date(),
    })).resolves.toBe(false);
    expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ jobId: "job-a", status: "processing", leasedBy: "worker-old" }),
    }));
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ jobId: "job-a", status: "processing", leasedBy: "worker-old" }),
    }));
  });

  it("does not let an expired owner acknowledge a job after its lease ends", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const database = { materialProcessingJob: { updateMany } } as unknown as PrismaClient;
    const repository = new PrismaMaterialProcessingJobRepository(database);
    const now = new Date("2026-09-04T00:01:00.000Z");

    await expect(repository.complete("job-a", "worker-a", now)).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        jobId: "job-a",
        status: "processing",
        leasedBy: "worker-a",
        leaseUntil: { gt: now },
      },
    }));
  });

  it("renews an active lease for its current owner", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = { materialProcessingJob: { updateMany } } as unknown as PrismaClient;
    const repository = new PrismaMaterialProcessingJobRepository(database);
    const now = new Date("2026-09-04T00:01:00.000Z");

    await expect(repository.renew("job-a", "worker-a", now, 30_000)).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        jobId: "job-a",
        status: "processing",
        leasedBy: "worker-a",
        leaseUntil: { gt: now },
      },
      data: { leaseUntil: new Date("2026-09-04T00:01:30.000Z") },
    });
  });

  it("backs off retryable failures and moves exhausted jobs to dead letter", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = { materialProcessingJob: { updateMany } } as unknown as PrismaClient;
    const repository = new PrismaMaterialProcessingJobRepository(database);
    const now = new Date("2026-09-04T00:01:00.000Z");

    await repository.fail("00000000-0000-4000-8000-000000000003", "worker-a", "SCANNER_UNAVAILABLE", {
      now,
      attempts: 2,
      maxAttempts: 5,
    });
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", lastErrorCode: "SCANNER_UNAVAILABLE" }),
    }));

    await repository.fail("00000000-0000-4000-8000-000000000003", "worker-a", "SCANNER_UNAVAILABLE", {
      now,
      attempts: 5,
      maxAttempts: 5,
    });
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "dead_letter", completedAt: now }),
    }));
  });
});
