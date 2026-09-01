import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRealtimeVoiceEventRepository } from "@/server/repositories/realtime-voice-repository";

describe("realtime voice repository", () => {
  it("uses the atomic database function for an owned session sequence", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ sequence: 7 }]);
    const database = { $queryRaw: queryRaw } as unknown as PrismaClient;
    const repository = new PrismaRealtimeVoiceEventRepository(
      database,
      "a".repeat(32),
      "d393a0b3-34b8-46b2-b845-dd5ca45e004a",
    );

    await expect(
      repository.append({
        sessionId: "a4a5fe5a-caf7-4aa8-94cb-1ab20b6f60d1",
        sequence: 1,
        type: "user_caption",
        text: "一句话",
      }),
    ).resolves.toMatchObject({ sequence: 7, type: "user_caption" });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("scopes reconnect reads to account, case, and cursor", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const database = { realtimeVoiceEvent: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaRealtimeVoiceEventRepository(
      database,
      "a".repeat(32),
      "d393a0b3-34b8-46b2-b845-dd5ca45e004a",
    );

    await repository.list("a4a5fe5a-caf7-4aa8-94cb-1ab20b6f60d1", 4);

    expect(findMany).toHaveBeenCalledOnce();
  });
});
