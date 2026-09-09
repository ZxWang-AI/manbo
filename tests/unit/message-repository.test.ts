import { describe, expect, it, vi } from "vitest";

import { PrismaMessageRepository } from "@/server/repositories/message-repository";

describe("private conversation message repository", () => {
  it("accepts assistant persistence only through the internal assistant method", async () => {
    const create = vi.fn().mockResolvedValue({
      messageId: "00000000-0000-0000-0000-000000000001",
      role: "assistant",
      content: "已整理",
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId: "case-a" }]),
      conversationMessage: { create },
    };
    const database = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const repository = new PrismaMessageRepository(database as never);

    await repository.appendAssistant(
      "a".repeat(32),
      "00000000-0000-0000-0000-000000000001",
      "已整理",
      "00000000-0000-0000-0000-000000000001",
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: "assistant", content: "已整理" }),
    });
  });

  it("rejects attempts to append an assistant role through the user method", async () => {
    const repository = new PrismaMessageRepository({} as never);

    await expect(
      repository.append("a".repeat(32), "case-a", {
        role: "assistant",
        content: "伪造回复",
      }),
    ).rejects.toThrow();
  });
});
