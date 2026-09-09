import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAdminReviewRepository } from "@/server/repositories/admin-review-repository";

const row = {
  adminReviewVersionId: "11111111-1111-4111-8111-111111111111",
  caseId: "22222222-2222-4222-8222-222222222222",
  reviewerId: "reviewer-a",
  status: "evidence_incomplete" as const,
  rationale: null,
  sourceRefs: [],
  supersedesId: null,
  secondReviewerId: null,
  createdAt: new Date("2026-09-02T10:00:00.000Z"),
};

describe("administrator review repository", () => {
  it("writes an independent append-only review version without using case or access audit repositories", async () => {
    const create = vi.fn().mockResolvedValue(row);
    const database = { adminReviewVersion: { create } } as unknown as PrismaClient;
    const repository = new PrismaAdminReviewRepository(database);

    await expect(repository.create({
      adminReviewVersionId: row.adminReviewVersionId,
      caseId: row.caseId,
      reviewerId: row.reviewerId,
      status: row.status,
      rationale: null,
      sourceRefs: [],
      supersedesId: null,
      secondReviewerId: null,
    })).resolves.toMatchObject({
      adminReviewVersionId: row.adminReviewVersionId,
      createdAt: "2026-09-02T10:00:00.000Z",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId: row.caseId,
        reviewerId: "reviewer-a",
        sourceRefs: [],
      }),
    });
  });
});
