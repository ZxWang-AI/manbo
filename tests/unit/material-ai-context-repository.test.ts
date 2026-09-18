import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMaterialAiContextRepository } from "@/server/repositories/material-ai-context-repository";
import type { MaterialDerivativeContentCipher } from "@/media/security/material-derivative-content";

function makeCipher(): MaterialDerivativeContentCipher {
  return {
    encrypt: vi.fn(),
    decrypt: vi.fn().mockResolvedValue({
      text: "安全派生文本",
      sourceSpans: [{ start: 0, end: 6 }],
    }),
  };
}

describe("material AI context repository", () => {
  it("returns decrypted content only for parsed eligible derivatives in the owner scope", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      contentRef: "derived/material-a-v1",
      materialId: "material-a",
      encryptedContent: { ciphertext: "opaque" },
    }]);
    const database = { materialDerivative: { findMany } } as unknown as PrismaClient;
    const cipher = makeCipher();
    const repository = new PrismaMaterialAiContextRepository(database, cipher);

    await expect(repository.resolveAiContext(
      "a".repeat(32),
      "case-a",
      ["derived/material-a-v1"],
    )).resolves.toEqual([{
      contentRef: "derived/material-a-v1",
      materialId: "material-a",
      text: "安全派生文本",
      sourceSpans: [{ start: 0, end: 6 }],
    }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        accountId: "a".repeat(32),
        caseId: "case-a",
        contentRef: { in: ["derived/material-a-v1"] },
        material: expect.objectContaining({
          is: expect.objectContaining({ processingState: "parsed", eligibleForAi: true }),
        }),
      }),
    }));
    expect(cipher.decrypt).toHaveBeenCalledWith({ ciphertext: "opaque" });
  });

  it("rejects a request when any requested ref is absent from the eligible scope", async () => {
    const database = {
      materialDerivative: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const repository = new PrismaMaterialAiContextRepository(database, makeCipher());

    await expect(repository.resolveAiContext(
      "a".repeat(32),
      "case-a",
      ["derived/not-owned"],
    )).rejects.toThrow("MATERIAL_CONTEXT_UNAVAILABLE");
  });

  it("deduplicates refs and enforces the total context character limit", async () => {
    const cipher = makeCipher();
    vi.mocked(cipher.decrypt).mockResolvedValue({ text: "x".repeat(200_001) });
    const database = {
      materialDerivative: {
        findMany: vi.fn().mockResolvedValue([{
          contentRef: "derived/material-a-v1",
          materialId: "material-a",
          encryptedContent: { ciphertext: "opaque" },
        }]),
      },
    } as unknown as PrismaClient;
    const repository = new PrismaMaterialAiContextRepository(database, cipher);

    await expect(repository.resolveAiContext(
      "a".repeat(32),
      "case-a",
      ["derived/material-a-v1", "derived/material-a-v1"],
    )).rejects.toThrow("MATERIAL_CONTEXT_TOO_LARGE");
  });
});
