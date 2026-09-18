import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaMessageRepository } from "@/server/repositories/message-repository";

describe("private conversation message repository", () => {
  it("finds a retry source only inside the owner's private case and user role", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      messageId: "message-a",
      accountId: "account-a",
      caseId: "case-a",
      role: "user",
      content: "数据库中的原文",
    });
    const repository = new PrismaMessageRepository({
      conversationMessage: { findFirst },
    } as never);

    await expect(
      repository.findPrivateUser("account-a", "case-a", "message-a"),
    ).resolves.toMatchObject({ role: "user", content: "数据库中的原文" });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        accountId: "account-a",
        caseId: "case-a",
        messageId: "message-a",
        role: "user",
        case: {
          is: {
            accountId: "account-a",
            caseId: "case-a",
            visibility: "private",
            deletedAt: null,
          },
        },
      },
    });
  });

  it("lists a private conversation in its locked append sequence", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaMessageRepository({
      conversationMessage: { findMany },
    } as never);

    await expect(repository.listPrivate("account-a", "case-a")).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        accountId: "account-a",
        caseId: "case-a",
        case: {
          is: {
            accountId: "account-a",
            caseId: "case-a",
            visibility: "private",
            deletedAt: null,
          },
        },
      },
      orderBy: { messageSequence: "asc" },
    });
  });

  it("accepts assistant persistence only through the internal assistant method", async () => {
    const findFirst = vi.fn().mockResolvedValue({ messageSequence: 6 });
    const create = vi.fn().mockResolvedValue({
      messageId: "00000000-0000-0000-0000-000000000001",
      messageSequence: 7,
      role: "assistant",
      content: "已整理",
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId: "case-a" }]),
      conversationMessage: { findFirst, create },
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
      data: expect.objectContaining({
        role: "assistant",
        content: "已整理",
        messageSequence: 7,
      }),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        accountId: "a".repeat(32),
        caseId: "00000000-0000-0000-0000-000000000001",
      },
      orderBy: { messageSequence: "desc" },
      select: { messageSequence: true },
    });
    expect(database.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  });

  it("checks the latest user after locking the private case and appends the retry response in that transaction", async () => {
    const accountId = "a".repeat(32);
    const caseId = "00000000-0000-4000-8000-000000000001";
    const expectedUserMessageId = "00000000-0000-4000-8000-000000000002";
    const assistantMessageId = "00000000-0000-4000-8000-000000000003";
    const events: string[] = [];
    const findFirst = vi.fn()
      .mockImplementationOnce(async () => {
        events.push("latest-user");
        return { messageId: expectedUserMessageId };
      })
      .mockImplementationOnce(async () => {
        events.push("latest-message");
        return { messageSequence: 4 };
      });
    const create = vi.fn().mockImplementation(async ({ data }) => {
      events.push("assistant-create");
      return data;
    });
    const transaction = {
      $queryRaw: vi.fn().mockImplementation(async () => {
        events.push("case-lock");
        return [{ caseId }];
      }),
      conversationMessage: { findFirst, create },
    };
    const database = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const repository = new PrismaMessageRepository(database as never);

    await expect(repository.appendAssistantForLatestUser(
      accountId,
      caseId,
      expectedUserMessageId,
      "新的回复版本",
      assistantMessageId,
    )).resolves.toMatchObject({
      messageId: assistantMessageId,
      role: "assistant",
      content: "新的回复版本",
    });

    expect(events).toEqual(["case-lock", "latest-user", "latest-message", "assistant-create"]);
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { accountId, caseId, role: "user" },
      orderBy: { messageSequence: "desc" },
      select: { messageId: true },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: { accountId, caseId },
      orderBy: { messageSequence: "desc" },
      select: { messageSequence: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        messageId: assistantMessageId,
        accountId,
        caseId,
        messageSequence: 5,
        role: "assistant",
        content: "新的回复版本",
      },
    });
    expect(database.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  });

  it("rejects the retry response when the expected user is no longer latest", async () => {
    const accountId = "a".repeat(32);
    const caseId = "00000000-0000-4000-8000-000000000011";
    const expectedUserMessageId = "00000000-0000-4000-8000-000000000012";
    const create = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationMessage: {
        findFirst: vi.fn().mockResolvedValueOnce({
          messageId: "00000000-0000-4000-8000-000000000013",
        }),
        create,
      },
    };
    const database = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const repository = new PrismaMessageRepository(database as never);

    await expect(repository.appendAssistantForLatestUser(
      accountId,
      caseId,
      expectedUserMessageId,
      "不应写入的旧轮次回复",
    )).rejects.toMatchObject({ name: "RetrySourceSuperseded" });
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.conversationMessage.findFirst).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
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
