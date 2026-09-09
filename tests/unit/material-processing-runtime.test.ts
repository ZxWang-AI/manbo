import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createMaterialProcessingQueue } from "@/server/services/material-processing-runtime";

describe("material processing runtime", () => {
  it("uses the PostgreSQL enqueue adapter only when durable mode is explicit", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({
      jobId: "00000000-0000-4000-8000-000000000003",
      accountId: "a".repeat(32),
      caseId: "00000000-0000-4000-8000-000000000001",
      materialId: "00000000-0000-4000-8000-000000000002",
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
    });
    const database = {
      materialProcessingJob: { findFirst, create },
    } as unknown as PrismaClient;

    const queue = createMaterialProcessingQueue({
      database,
      objectStorage: { available: false, mode: "unavailable", store: {} as never },
      queueMode: "durable",
    });

    await expect(queue.enqueue({
      accountId: "a".repeat(32),
      caseId: "00000000-0000-4000-8000-000000000001",
      materialId: "00000000-0000-4000-8000-000000000002",
    })).resolves.toMatchObject({ status: "pending" });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
