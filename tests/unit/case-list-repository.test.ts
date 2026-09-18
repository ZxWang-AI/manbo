import { describe, expect, it, vi } from "vitest";

import { PrismaCaseRepository } from "@/server/repositories/case-repository";

describe("private case list repository", () => {
  it("returns bounded, non-sensitive summaries and excludes deleted cases in the query", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      caseId: "case-a",
      lifecycle: "draft",
      version: 2,
      aiReviewStatus: "ready_for_preparation",
      createdAt: new Date("2026-09-14T00:00:00.000Z"),
      updatedAt: new Date("2026-09-14T02:00:00.000Z"),
      _count: { materials: 4 },
    }]);
    const database = { caseRecord: { findMany } } as never;

    const result = await new PrismaCaseRepository(database).listPrivate("a".repeat(32));

    expect(findMany).toHaveBeenCalledWith({
      where: { accountId: "a".repeat(32), visibility: "private", deletedAt: null },
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
    expect(result).toEqual([{
      caseId: "case-a",
      lifecycle: "draft",
      version: 2,
      aiReviewStatus: "ready_for_preparation",
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T02:00:00.000Z",
      materialCount: 4,
    }]);
  });
});
