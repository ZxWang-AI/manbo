import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaVoiceSessionRepository } from "@/server/repositories/voice-session-repository";

describe("voice session repository", () => {
  it("starts a session only when the owning private case is available", async () => {
    const create = vi.fn().mockResolvedValue({ sessionId: "a4a5fe5a-caf7-4aa8-94cb-1ab20b6f60d1" });
    const transaction = { $queryRaw: vi.fn().mockResolvedValue([{ caseId: "d393a0b3-34b8-46b2-b845-dd5ca45e004a" }]), voiceSession: { create } };
    const database = {
      $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
    } as unknown as PrismaClient;
    const repository = new PrismaVoiceSessionRepository(database, "a".repeat(32), "d393a0b3-34b8-46b2-b845-dd5ca45e004a");

    await expect(repository.start("a4a5fe5a-caf7-4aa8-94cb-1ab20b6f60d1", "zh-CN")).resolves.toEqual({
      sessionId: "a4a5fe5a-caf7-4aa8-94cb-1ab20b6f60d1",
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("refuses cross-account session creation", async () => {
    const database = {
      $transaction: vi.fn(async (operation: (tx: { $queryRaw: ReturnType<typeof vi.fn>; voiceSession: { create: ReturnType<typeof vi.fn> } }) => Promise<unknown>) =>
        operation({ $queryRaw: vi.fn().mockResolvedValue([]), voiceSession: { create: vi.fn() } })),
    } as unknown as PrismaClient;
    const repository = new PrismaVoiceSessionRepository(database, "b".repeat(32), "d393a0b3-34b8-46b2-b845-dd5ca45e004a");

    await expect(
      repository.start("a4a5fe5a-caf7-4aa8-94cb-1ab20b6f60d1", "zh-CN"),
    ).rejects.toThrow("VOICE_SESSION_UNAVAILABLE");
  });
});
