import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAdminCaseChangeRepository } from "@/server/repositories/admin-case-change-repository";

describe("administrator case change repository", () => {
  it("persists an immutable change version with the authenticated administrator", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const database = { adminCaseChangeVersion: { create } } as unknown as PrismaClient;
    await new PrismaAdminCaseChangeRepository(database).create({
      changeVersionId: "11111111-1111-4111-8111-111111111111",
      caseId: "22222222-2222-4222-8222-222222222222",
      adminId: "supervisor-b",
      action: "modify",
      expectedVersion: 1,
      resultingVersion: 2,
      patch: { lifecycle: "confirmed" },
      createdAt: "2026-09-02T10:00:00.000Z",
    });

    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      adminId: "supervisor-b",
      action: "modify",
      expectedVersion: 1,
      resultingVersion: 2,
      patch: { lifecycle: "confirmed" },
    }) });
  });

  it("returns change history in creation order without exposing mutable storage handles", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        changeVersionId: "11111111-1111-4111-8111-111111111111",
        caseId: "22222222-2222-4222-8222-222222222222",
        adminId: "supervisor-b",
        action: "modify",
        expectedVersion: 1,
        resultingVersion: 2,
        patch: { lifecycle: "confirmed" },
        createdAt: new Date("2026-09-02T10:00:00.000Z"),
      },
    ]);
    const database = { adminCaseChangeVersion: { findMany } } as unknown as PrismaClient;

    await expect(new PrismaAdminCaseChangeRepository(database).findForCase("case-a"))
      .resolves.toEqual([expect.objectContaining({
        changeVersionId: "11111111-1111-4111-8111-111111111111",
        action: "modify",
        createdAt: "2026-09-02T10:00:00.000Z",
      })]);
    expect(findMany).toHaveBeenCalledWith({
      where: { caseId: "case-a" },
      orderBy: { createdAt: "asc" },
    });
  });
});
