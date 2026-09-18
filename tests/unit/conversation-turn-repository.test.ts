import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  PrismaConversationTurnRepository,
  type ReserveTurnInput,
} from "@/server/repositories/conversation-turn-repository";

const accountId = "a".repeat(32);
const caseId = "00000000-0000-4000-8000-000000000001";
const turnId = "00000000-0000-4000-8000-000000000010";
const userMessageId = "00000000-0000-4000-8000-000000000011";

function turnRow(overrides: Record<string, unknown> = {}) {
  return {
    turnId,
    accountId,
    caseId,
    operation: "send" as const,
    status: "processing" as const,
    sourceUserMessageId: null,
    userMessageId,
    baseCaseVersion: 1,
    requestHash: "1".repeat(64),
    resultSnapshot: null,
    responseSnapshot: null,
    assistantMessageId: null,
    caseVersionAfter: null,
    attempts: 1,
    leaseUntil: null,
    createdAt: new Date("2026-09-18T00:00:00.000Z"),
    updatedAt: new Date("2026-09-18T00:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

function input(overrides: Partial<ReserveTurnInput> = {}): ReserveTurnInput {
  return {
    accountId,
    caseId,
    turnId,
    operation: "send",
    requestHash: "1".repeat(64),
    baseCaseVersion: 1,
    message: "用户陈述",
    ...overrides,
  };
}

function databaseFor(transaction: Record<string, unknown>) {
  return { $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction)) } as unknown as PrismaClient;
}

describe("conversation turn repository", () => {
  it("reserves an ordinary turn and user message in one case-locked transaction", async () => {
    const createTurn = vi.fn().mockResolvedValue(turnRow());
    const createMessage = vi.fn().mockResolvedValue({ messageId: userMessageId, role: "user", content: "用户陈述" });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique: vi.fn().mockResolvedValue(null), create: createTurn },
      conversationMessage: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: createMessage,
      },
    };

    const result = await new PrismaConversationTurnRepository(databaseFor(transaction)).reserve(input());

    expect(result.kind).toBe("owner");
    expect(createTurn).toHaveBeenCalledOnce();
    expect(createMessage).toHaveBeenCalledOnce();
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ turnId, accountId, caseId, role: "user", content: "用户陈述" }),
    }));
  });

  it("replays a completed turn with the same hash without claiming or creating a user", async () => {
    const existing = turnRow({ status: "completed", responseSnapshot: { status: "completed" } });
    const findUnique = vi.fn().mockResolvedValue(existing);
    const create = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique, create },
      conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    };

    const result = await new PrismaConversationTurnRepository(databaseFor(transaction)).reserve(input());

    expect(result).toMatchObject({ kind: "replay", turn: existing });
    expect(create).not.toHaveBeenCalled();
    expect(transaction.conversationMessage.create).not.toHaveBeenCalled();
  });

  it("returns in-flight for a duplicate processing request and never calls a second owner", async () => {
    const existing = turnRow({ status: "processing", leaseUntil: new Date("2099-01-01T00:00:00.000Z") });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn() },
      conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    };

    await expect(new PrismaConversationTurnRepository(databaseFor(transaction)).reserve(input())).resolves.toMatchObject({
      kind: "in_flight",
      turn: existing,
    });
    expect(transaction.conversationTurn.create).not.toHaveBeenCalled();
  });

  it("expires an abandoned processing turn and returns a replayable failure", async () => {
    const now = new Date("2026-09-18T00:10:00.000Z");
    const existing = turnRow({
      leaseUntil: new Date("2026-09-18T00:09:00.000Z"),
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(turnRow({
        status: "failed",
        leaseUntil: null,
        responseSnapshot: {
          statusCode: 503,
          error: { code: "TURN_EXPIRED", message: "本轮处理已超时，请重新提交。" },
        },
      }));
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique, updateMany, create: vi.fn() },
      conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    };

    const result = await new PrismaConversationTurnRepository(databaseFor(transaction), undefined, {
      now: () => now,
    }).reserve(input());

    expect(result.kind).toBe("replay");
    expect(result.turn.status).toBe("failed");
    expect(result.turn.responseSnapshot).toEqual({
      statusCode: 503,
      error: { code: "TURN_EXPIRED", message: "本轮处理已超时，请重新提交。" },
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["processing", "reserved"] },
        leaseUntil: { lte: now },
      }),
      data: expect.objectContaining({ status: "failed", leaseUntil: null }),
    }));
    expect(transaction.conversationTurn.create).not.toHaveBeenCalled();
  });

  it("returns result_ready when a provider wins the expiry race", async () => {
    const now = new Date("2026-09-18T00:10:00.000Z");
    const existing = turnRow({ leaseUntil: new Date("2026-09-18T00:09:00.000Z") });
    const ready = turnRow({
      status: "result_ready",
      leaseUntil: null,
      resultSnapshot: {
        assistant: {
          state: "FACT_GATHERING",
          message: "已准备结果",
          questions: [],
          actions: [],
          disclaimerIds: ["ai-assessment"],
          degraded: false,
        },
      },
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: {
        findUnique: vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce(ready),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(),
      },
      conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    };

    const result = await new PrismaConversationTurnRepository(databaseFor(transaction), undefined, {
      now: () => now,
    }).reserve(input());

    expect(result).toMatchObject({ kind: "result_ready", turn: ready });
    expect(transaction.conversationTurn.create).not.toHaveBeenCalled();
  });

  it("recovers an active turn whose lease is unexpectedly null", async () => {
    const now = new Date("2026-09-18T00:10:00.000Z");
    const existing = turnRow({ leaseUntil: null });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const failed = turnRow({
      status: "failed",
      responseSnapshot: {
        statusCode: 503,
        error: { code: "TURN_EXPIRED", message: "本轮处理已超时，请重新提交。" },
      },
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: {
        findUnique: vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce(failed),
        updateMany,
        create: vi.fn(),
      },
      conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    };

    const result = await new PrismaConversationTurnRepository(databaseFor(transaction), undefined, {
      now: () => now,
    }).reserve(input());

    expect(result).toMatchObject({ kind: "replay", turn: failed });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ leaseUntil: null }),
    }));
  });

  it("rejects a reused turn ID with a different request hash before any message write", async () => {
    const existing = turnRow();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn() },
      conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    };

    const result = await new PrismaConversationTurnRepository(databaseFor(transaction)).reserve(input({ requestHash: "2".repeat(64) }));

    expect(result).toMatchObject({ kind: "idempotency_conflict" });
    expect(transaction.conversationMessage.create).not.toHaveBeenCalled();
  });

  it("binds retry turns to the latest stored user without appending another user", async () => {
    const retryTurnId = "00000000-0000-4000-8000-000000000012";
    const source = { messageId: userMessageId, role: "user", content: "数据库原文", messageSequence: 4 };
    const createTurn = vi.fn().mockResolvedValue(turnRow({ turnId: retryTurnId, operation: "retry", sourceUserMessageId: userMessageId, userMessageId }));
    const createMessage = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique: vi.fn().mockResolvedValue(null), create: createTurn },
      conversationMessage: { findFirst: vi.fn().mockResolvedValue(source), create: createMessage },
    };

    const result = await new PrismaConversationTurnRepository(databaseFor(transaction)).reserve(input({
      turnId: retryTurnId,
      operation: "retry",
      sourceUserMessageId: userMessageId,
      message: "客户端可能被篡改的内容",
    }));

    expect(result.kind).toBe("owner");
    expect(createTurn).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ operation: "retry", sourceUserMessageId: userMessageId, userMessageId }),
    }));
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("marks a processing turn as a safe terminal failure and makes it replayable", async () => {
    const existing = turnRow();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue(
      turnRow({
        status: "failed",
        responseSnapshot: {
          statusCode: 503,
          error: { code: "DEGRADED", message: "对话服务暂时不可用。" },
        },
      }),
    );
    const database = {
      conversationTurn: { updateMany, findUnique },
    } as unknown as PrismaClient;

    const result = await new PrismaConversationTurnRepository(database).markFailure(
      accountId,
      caseId,
      turnId,
      existing.requestHash,
      "failed",
      { code: "DEGRADED", message: "对话服务暂时不可用。", statusCode: 503 },
    );

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        accountId,
        caseId,
        turnId,
        requestHash: existing.requestHash,
        status: { in: ["processing", "reserved"] },
      }),
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(result.status).toBe("failed");
    expect(result.responseSnapshot).toEqual({
      statusCode: 503,
      error: { code: "DEGRADED", message: "对话服务暂时不可用。" },
    });
  });

  it("does not mark a turn failed after its processing lease expires", async () => {
    const now = new Date("2026-09-18T00:10:00.000Z");
    const existing = turnRow({ leaseUntil: new Date("2026-09-18T00:09:00.000Z") });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const database = {
      conversationTurn: { updateMany, findUnique: vi.fn().mockResolvedValue(existing) },
    } as unknown as PrismaClient;

    const result = await new PrismaConversationTurnRepository(database, undefined, {
      now: () => now,
    }).markFailure(
      accountId,
      caseId,
      turnId,
      existing.requestHash,
      "failed",
      { code: "TURN_FAILED", message: "已过期", statusCode: 503 },
    );

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ leaseUntil: { gt: now } }),
    }));
    expect(result).toBe(existing);
  });

  it("does not overwrite a result-ready snapshot when a late result writer retries", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const existing = turnRow({
      status: "result_ready",
      resultSnapshot: {
        assistant: {
          state: "FACT_GATHERING",
          message: "已保存",
          questions: [],
          actions: [],
          disclaimerIds: ["ai-assessment"],
          degraded: false,
        },
      },
    });
    const database = {
      conversationTurn: { updateMany, findUnique: vi.fn().mockResolvedValue(existing) },
    } as unknown as PrismaClient;

    const result = await new PrismaConversationTurnRepository(database).recordResult(
      accountId,
      caseId,
      turnId,
      existing.requestHash,
      existing.resultSnapshot,
    );

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["processing", "reserved"] } }),
    }));
    expect(result).toBe(existing);
  });

  it("does not accept a provider result after the processing lease expires", async () => {
    const now = new Date("2026-09-18T00:10:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const existing = turnRow({
      leaseUntil: new Date("2026-09-18T00:09:00.000Z"),
    });
    const database = {
      conversationTurn: { updateMany, findUnique: vi.fn().mockResolvedValue(existing) },
    } as unknown as PrismaClient;

    const result = await new PrismaConversationTurnRepository(database, undefined, {
      now: () => now,
    }).recordResult(
      accountId,
      caseId,
      turnId,
      existing.requestHash,
      {
        assistant: {
          state: "FACT_GATHERING",
          message: "迟到结果",
          questions: [],
          actions: [],
          disclaimerIds: ["ai-assessment"],
          degraded: false,
        },
      },
    );

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["processing", "reserved"] },
        leaseUntil: { gt: now },
      }),
    }));
    expect(result).toBe(existing);
  });
});
