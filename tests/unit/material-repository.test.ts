import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMaterialReservationRepository } from "@/server/repositories/material-repository";

describe("material reservation repository", () => {
  it("reserves quota through the atomic database function and returns the canonical row", async () => {
    const reservation = {
      uploadId: "2b130ede-c0ad-4396-b885-a9eca4026d02",
      materialId: "457e08e0-e496-4d42-8d84-ae4f82ec68b4",
      caseId: "36ee7b31-8590-4afe-995e-0e360714d647",
      objectKey: "materials/03030303030303030303030303030303",
      reservedBytes: 1024n,
      expiresAt: new Date("2026-08-31T12:15:00.000Z"),
    };
    const queryRaw = vi.fn().mockResolvedValue([reservation]);
    const database = { $queryRaw: queryRaw } as unknown as PrismaClient;
    const repository = new PrismaMaterialReservationRepository(
      database,
      () => "materials/03030303030303030303030303030303",
      () => new Date("2026-08-31T12:00:00.000Z"),
    );

    await expect(
      repository.reserve({
        accountId: "a".repeat(32),
        caseId: reservation.caseId,
        byteLength: 1024,
      }),
    ).resolves.toEqual({ ...reservation, reservedBytes: 1024, expiresAt: reservation.expiresAt.toISOString() });
  });

  it("releases a reservation idempotently without accepting an account from stored metadata", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ status: "already_released" }]);
    const database = { $queryRaw: queryRaw } as unknown as PrismaClient;
    const repository = new PrismaMaterialReservationRepository(database);

    await repository.release("a".repeat(32), "2b130ede-c0ad-4396-b885-a9eca4026d02");
    await repository.release("a".repeat(32), "2b130ede-c0ad-4396-b885-a9eca4026d02");

    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("fails closed when encryption metadata cannot be attached to an owned active reservation", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const database = { $executeRaw: executeRaw } as unknown as PrismaClient;
    const repository = new PrismaMaterialReservationRepository(database);

    await expect(
      repository.attachEncryption("a".repeat(32), "2b130ede-c0ad-4396-b885-a9eca4026d02", {
        scheme: "AES-256-GCM",
        keyVersion: "kek-v1",
        wrappedKey: "wrapped",
      }),
    ).rejects.toThrow("MATERIAL_UPLOAD_UNAVAILABLE");
  });
});
