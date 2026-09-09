import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMaterialListRepository } from "@/server/repositories/material-list-repository";

describe("material list repository", () => {
  it("scopes summaries to a private, active case and orders by creation time", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        materialId: "material-a",
        originalFilename: "statement.pdf",
        declaredBytes: 1024n,
        declaredMime: "application/pdf",
        processingState: "parsed",
        eligibleForAi: true,
        createdAt: new Date("2026-09-04T00:00:00.000Z"),
      },
    ]);
    const database = { material: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaMaterialListRepository(database);

    await expect(repository.listActive("a".repeat(32), "case-a")).resolves.toEqual([{
      materialId: "material-a",
      originalFilename: "statement.pdf",
      declaredBytes: 1024,
      declaredMime: "application/pdf",
      processingState: "parsed",
      eligibleForAi: true,
      createdAt: "2026-09-04T00:00:00.000Z",
    }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ accountId: "a".repeat(32), caseId: "case-a", status: "uploaded", deletedAt: null }),
      orderBy: { createdAt: "asc" },
    }));
  });
});
