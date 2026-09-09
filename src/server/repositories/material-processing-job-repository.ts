import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import type {
  MaterialProcessingJob,
  MaterialProcessingJobInput,
  MaterialProcessingJobStatus,
} from "@/server/services/material-processing-queue";

const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60_000;

type JobRow = {
  jobId: string;
  accountId: string;
  caseId: string;
  materialId: string;
  status: MaterialProcessingJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  leaseUntil: Date | null;
  leasedBy: string | null;
  lastErrorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

export interface ClaimOptions {
  now?: Date;
  leaseDurationMs?: number;
}

export interface FailureOptions {
  now?: Date;
  attempts: number;
  maxAttempts: number;
}

function toJob(row: JobRow): MaterialProcessingJob {
  return {
    jobId: row.jobId,
    accountId: row.accountId,
    caseId: row.caseId,
    materialId: row.materialId,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    availableAt: row.availableAt.toISOString(),
    ...(row.leaseUntil ? { leaseUntil: row.leaseUntil.toISOString() } : {}),
    ...(row.leasedBy ? { leasedBy: row.leasedBy } : {}),
    ...(row.lastErrorCode ? { errorCode: "PROCESSING_TASK_FAILED" as const } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
  };
}

export class PrismaMaterialProcessingJobRepository {
  constructor(private readonly database: PrismaClient) {}

  async enqueue(input: MaterialProcessingJobInput): Promise<MaterialProcessingJob> {
    const existing = await this.findActive(input);
    if (existing) return toJob(existing);

    try {
      const created = await this.database.materialProcessingJob.create({
        data: {
          jobId: randomUUID(),
          accountId: input.accountId,
          caseId: input.caseId,
          materialId: input.materialId,
          status: "pending",
          maxAttempts: DEFAULT_MAX_ATTEMPTS,
        },
      });
      return toJob(created as unknown as JobRow);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await this.findActive(input);
      if (!concurrent) throw error;
      return toJob(concurrent);
    }
  }

  async claimNext(workerId: string, options: ClaimOptions = {}): Promise<MaterialProcessingJob | null> {
    const now = options.now ?? new Date();
    const leaseDurationMs = options.leaseDurationMs ?? 60_000;
    if (!workerId.trim() || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 15 * 60_000) {
      throw new Error("MATERIAL_PROCESSING_LEASE_INVALID");
    }
    const leaseUntil = new Date(now.getTime() + leaseDurationMs);

    return this.database.$transaction(async (transaction) => {
      const candidate = await transaction.materialProcessingJob.findFirst({
        where: {
          OR: [
            { status: { in: ["pending", "failed"] }, availableAt: { lte: now } },
            { status: "processing", leaseUntil: { lte: now } },
          ],
        },
        orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
      });
      if (!candidate) return null;

      if (candidate.status === "processing" && candidate.attempts >= candidate.maxAttempts) {
        await transaction.materialProcessingJob.updateMany({
          where: {
            jobId: candidate.jobId,
            status: "processing",
            leaseUntil: { lte: now },
          },
          data: {
            status: "dead_letter",
            leaseUntil: null,
            leasedBy: null,
            lastErrorCode: "PROCESSING_LEASE_EXPIRED",
            completedAt: now,
          },
        });
        return null;
      }

      const claimed = await transaction.materialProcessingJob.updateMany({
        where: {
          jobId: candidate.jobId,
          OR: [
            { status: { in: ["pending", "failed"] }, availableAt: { lte: now } },
            { status: "processing", leaseUntil: { lte: now } },
          ],
        },
        data: {
          status: "processing",
          attempts: { increment: 1 },
          leasedBy: workerId,
          leaseUntil,
          startedAt: candidate.startedAt ?? now,
        },
      });
      if (claimed.count !== 1) return null;

      return toJob({
        ...(candidate as unknown as JobRow),
        status: "processing",
        attempts: candidate.attempts + 1,
        leasedBy: workerId,
        leaseUntil,
        startedAt: candidate.startedAt ?? now,
      });
    });
  }

  async complete(jobId: string, workerId: string, now: Date = new Date()): Promise<boolean> {
    const result = await this.database.materialProcessingJob.updateMany({
      where: { jobId, status: "processing", leasedBy: workerId, leaseUntil: { gt: now } },
      data: { status: "completed", leaseUntil: null, leasedBy: null, completedAt: now },
    });
    return result.count === 1;
  }

  async renew(jobId: string, workerId: string, now: Date, leaseDurationMs: number): Promise<boolean> {
    if (!workerId.trim() || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 15 * 60_000) {
      throw new Error("MATERIAL_PROCESSING_LEASE_INVALID");
    }
    const result = await this.database.materialProcessingJob.updateMany({
      where: { jobId, status: "processing", leasedBy: workerId, leaseUntil: { gt: now } },
      data: { leaseUntil: new Date(now.getTime() + leaseDurationMs) },
    });
    return result.count === 1;
  }

  async fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    options: FailureOptions,
  ): Promise<boolean> {
    const now = options.now ?? new Date();
    const exhausted = options.attempts >= options.maxAttempts;
    const retryDelay = Math.min(BASE_BACKOFF_MS * (2 ** Math.max(0, options.attempts - 1)), MAX_BACKOFF_MS);
    const result = await this.database.materialProcessingJob.updateMany({
      where: { jobId, status: "processing", leasedBy: workerId, leaseUntil: { gt: now } },
      data: {
        status: exhausted ? "dead_letter" : "failed",
        availableAt: exhausted ? now : new Date(now.getTime() + retryDelay),
        leaseUntil: null,
        leasedBy: null,
        lastErrorCode: errorCode.slice(0, 120),
        ...(exhausted ? { completedAt: now } : {}),
      },
    });
    return result.count === 1;
  }

  private async findActive(input: MaterialProcessingJobInput): Promise<JobRow | null> {
    const row = await this.database.materialProcessingJob.findFirst({
      where: {
        accountId: input.accountId,
        caseId: input.caseId,
        materialId: input.materialId,
        status: { in: ["pending", "processing", "failed"] },
      },
      orderBy: { createdAt: "desc" },
    });
    return row as unknown as JobRow | null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
