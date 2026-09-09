import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAdminMaterialRepository } from "@/server/repositories/admin-material-repository";

describe("administrator material repository", () => {
  it("scopes material lookup to an active private case and returns encryption metadata", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      materialId: "material-a",
      caseId: "case-a",
      objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      usedBytes: 42n,
      declaredBytes: 100n,
      encryptionScheme: "AES-256-GCM",
      keyVersion: "key-v1",
      wrappedKey: "wrapped-key",
      originalFilename: "contract.pdf",
      declaredMime: "application/pdf",
      detectedMime: "application/pdf",
    });
    const database = { material: { findFirst } } as unknown as PrismaClient;
    const repository = new PrismaAdminMaterialRepository(database);

    await expect(repository.findActive("case-a", "material-a")).resolves.toEqual({
      materialId: "material-a",
      caseId: "case-a",
      objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      storedBytes: 42,
      encryptionScheme: "AES-256-GCM",
      keyVersion: "key-v1",
      wrappedKey: "wrapped-key",
      originalFilename: "contract.pdf",
      contentType: "application/pdf",
    });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        materialId: "material-a",
        caseId: "case-a",
        status: "uploaded",
        deletedAt: null,
        case: { is: { caseId: "case-a", visibility: "private", deletedAt: null } },
      }),
    }));
  });

  it("returns null when no active owned material exists", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const database = { material: { findFirst } } as unknown as PrismaClient;
    await expect(new PrismaAdminMaterialRepository(database).findActive("case-a", "missing"))
      .resolves.toBeNull();
  });
});
