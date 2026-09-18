import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMaterialProcessingRepository } from "@/server/repositories/material-processing-repository";
import type { MaterialDerivativeContentCipher } from "@/media/security/material-derivative-content";

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
    const findMany = vi.fn().mockResolvedValue([
      { contentRef: "derived/material-a-v1", encryptedContent: { ciphertext: "opaque" } },
      { contentRef: "derived/legacy-v0", encryptedContent: null },
    ]);
    const database = { materialDerivative: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaMaterialProcessingRepository(database, "a".repeat(32), "case-a");

    await expect(repository.listAiEligibleContentRefs("material-a")).resolves.toEqual([
      "derived/material-a-v1",
    ]);
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { contentRef: true, encryptedContent: true },
    }));
  });

  it("encrypts parsed derivative payloads before persisting them", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sha256: "b".repeat(64),
    });
    const upsert = vi.fn().mockResolvedValue({});
    const database = {
      material: { findFirst },
      materialDerivative: { upsert },
    } as unknown as PrismaClient;
    const cipher: MaterialDerivativeContentCipher = {
      encrypt: vi.fn().mockResolvedValue({
        scheme: "AES-256-GCM",
        keyVersion: "derivative-v1",
        initializationVector: "iv",
        authenticationTag: "tag",
        ciphertext: "ciphertext",
      }),
      decrypt: vi.fn(),
    };
    const repository = new PrismaMaterialProcessingRepository(
      database,
      "a".repeat(32),
      "case-a",
      cipher,
    );

    await repository.addDerivative({
      contentRef: "derived/material-a-v1",
      sourceMaterialId: "material-a",
      parserId: "pdf-parser",
      content: { text: "解析文本", sourceSpans: [{ start: 0, end: 4 }] },
    });

    expect(cipher.encrypt).toHaveBeenCalledWith({
      text: "解析文本",
      sourceSpans: [{ start: 0, end: 4 }],
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        encryptedContent: {
          scheme: "AES-256-GCM",
          keyVersion: "derivative-v1",
          initializationVector: "iv",
          authenticationTag: "tag",
          ciphertext: "ciphertext",
        },
      }),
    }));
  });

  it("fails closed when no derivative content cipher is configured", async () => {
    const database = {
      material: {
        findFirst: vi.fn().mockResolvedValue({
          objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sha256: "b".repeat(64),
        }),
      },
      materialDerivative: { upsert: vi.fn() },
    } as unknown as PrismaClient;
    const repository = new PrismaMaterialProcessingRepository(database, "a".repeat(32), "case-a");

    await expect(repository.addDerivative({
      contentRef: "derived/material-a-v1",
      sourceMaterialId: "material-a",
      parserId: "pdf-parser",
      content: { text: "解析文本" },
    })).rejects.toThrow("MATERIAL_DERIVATIVE_CIPHER_UNAVAILABLE");
  });
});
