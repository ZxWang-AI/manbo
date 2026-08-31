import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMaterialProcessingRepository } from "@/server/repositories/material-processing-repository";

describe("material processing repository", () => {
  it("rejects blocked-to-parsed transitions before writing to the database", async () => {
    const updateMany = vi.fn();
    const database = {
      material: {
        findFirst: vi.fn().mockResolvedValue({
          materialId: "material-a",
          declaredMime: "application/pdf",
          originalFilename: "statement.pdf",
          processingState: "blocked_malicious",
          processingVersion: 4,
          detectedMime: "application/vnd.microsoft.portable-executable",
          signatureStatus: "mismatch",
          eligibleForAi: false,
        }),
        updateMany,
      },
    } as unknown as PrismaClient;
    const repository = new PrismaMaterialProcessingRepository(database, "a".repeat(32), "case-a");

    await expect(
      repository.transition("material-a", 4, { processingState: "parsed", eligibleForAi: true }),
    ).rejects.toThrow("MATERIAL_PROCESSING_INVALID_TRANSITION");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns content refs only through the parsed and AI-eligible ownership scope", async () => {
    const findMany = vi.fn().mockResolvedValue([{ contentRef: "derived/material-a-v1" }]);
    const database = { materialDerivative: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaMaterialProcessingRepository(database, "a".repeat(32), "case-a");

    await expect(repository.listAiEligibleContentRefs("material-a")).resolves.toEqual([
      "derived/material-a-v1",
    ]);
    expect(findMany).toHaveBeenCalledOnce();
  });
});
