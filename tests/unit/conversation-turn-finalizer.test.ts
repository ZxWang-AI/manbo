import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaConversationTurnFinalizer } from "@/server/services/conversation-turn-finalizer";

const accountId = "a".repeat(32);
const caseId = "00000000-0000-4000-8000-000000000001";
const turnId = "00000000-0000-4000-8000-000000000010";
const userMessageId = "00000000-0000-4000-8000-000000000011";
const assistantMessageId = "00000000-0000-4000-8000-000000000012";
const requestHash = "1".repeat(64);

function caseRow(overrides: Record<string, unknown> = {}) {
  return {
    caseId,
    accountId,
    schemaVersion: "1.0",
    visibility: "private" as const,
    lifecycle: "draft" as const,
    version: 1,
    jurisdiction: {},
    facts: [],
    timeline: [],
    iloIndicators: [],
    elements: {
      workOrService: { status: "unknown", basis: [], missing: ["待补充"] },
      involuntary: { status: "unknown", basis: [], missing: ["待补充"] },
      penaltyOrThreat: { status: "unknown", basis: [], missing: ["待补充"] },
    },
    evidenceCoverage: [],
    legalNavigation: [],
    referrals: [],
    safetyFlags: [],
    sourceTrace: [],
    consent: { version: "v1", saveCase: true, externalSharing: false, confirmedFieldPaths: [] },
    aiReviewStatus: null,
    createdAt: new Date("2026-09-18T00:00:00.000Z"),
    updatedAt: new Date("2026-09-18T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function turnRow(overrides: Record<string, unknown> = {}) {
  return {
    turnId,
    accountId,
    caseId,
    operation: "send" as const,
    status: "result_ready" as const,
    sourceUserMessageId: null,
    userMessageId,
    baseCaseVersion: 1,
    requestHash,
    resultSnapshot: {
      assistant: {
        state: "FACT_GATHERING",
        message: "已整理本轮事实。",
        questions: [],
        actions: [],
        disclaimerIds: ["ai-assessment"],
        degraded: false,
        draftPatch: { facts: [] },
      },
    },
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

function databaseFor(transaction: Record<string, unknown>) {
  return { $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction)) } as unknown as PrismaClient;
}

describe("conversation turn finalizer", () => {
  it("writes case patch, revision, audit, assistant, and completed turn in one transaction", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique: vi.fn().mockResolvedValue(turnRow()), update: vi.fn().mockResolvedValue(turnRow({ status: "completed", assistantMessageId })) },
      caseRecord: {
        findFirst: vi.fn().mockResolvedValue(caseRow()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      caseRecordRevision: { create: vi.fn() },
      auditEvent: { create: vi.fn() },
      conversationMessage: {
        findFirst: vi.fn().mockResolvedValue({ messageId: userMessageId, role: "user", messageSequence: 1 }),
        create: vi.fn().mockResolvedValue({ messageId: assistantMessageId, messageSequence: 2, role: "assistant", content: "已整理本轮事实。" }),
      },
    };

    const result = await new PrismaConversationTurnFinalizer(databaseFor(tx)).finalize({ accountId, caseId, turnId, requestHash });

    expect(result.kind).toBe("completed");
    expect(tx.conversationTurn.findUnique).toHaveBeenCalledWith({
      where: { accountId_caseId_turnId: { accountId, caseId, turnId } },
    });
    expect(tx.caseRecord.updateMany).toHaveBeenCalledOnce();
    expect(tx.caseRecordRevision.create).toHaveBeenCalledOnce();
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
    expect(tx.conversationMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ turnId, role: "assistant", messageId: expect.any(String) }),
    }));
    expect(tx.conversationTurn.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { accountId_caseId_turnId: { accountId, caseId, turnId } },
      data: expect.objectContaining({ status: "completed", assistantMessageId: expect.any(String) }),
    }));
  });

  it("persists a version conflict without applying a patch or assistant message", async () => {
    const update = vi.fn().mockResolvedValue(turnRow({ status: "conflict" }));
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique: vi.fn().mockResolvedValue(turnRow()), update },
      caseRecord: { findFirst: vi.fn().mockResolvedValue(caseRow({ version: 2 }),), updateMany: vi.fn() },
      caseRecordRevision: { create: vi.fn() },
      auditEvent: { create: vi.fn() },
      conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    };

    const result = await new PrismaConversationTurnFinalizer(databaseFor(tx)).finalize({ accountId, caseId, turnId, requestHash });

    expect(result.kind).toBe("conflict");
    expect(tx.caseRecord.updateMany).not.toHaveBeenCalled();
    expect(tx.caseRecordRevision.create).not.toHaveBeenCalled();
    expect(tx.conversationMessage.create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { accountId_caseId_turnId: { accountId, caseId, turnId } },
      data: expect.objectContaining({ status: "conflict" }),
    }));
  });

  it("converts an optimistic patch race into a replayable conflict", async () => {
    const update = vi.fn().mockResolvedValue(turnRow({ status: "conflict" }));
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique: vi.fn().mockResolvedValue(turnRow()), update },
      caseRecord: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(caseRow({ version: 1 }))
          .mockResolvedValueOnce(caseRow({ version: 2 })),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      caseRecordRevision: { create: vi.fn() },
      auditEvent: { create: vi.fn() },
      conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    };

    const result = await new PrismaConversationTurnFinalizer(databaseFor(tx)).finalize({ accountId, caseId, turnId, requestHash });

    expect(result.kind).toBe("conflict");
    expect(tx.caseRecordRevision.create).not.toHaveBeenCalled();
    expect(tx.conversationMessage.create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "conflict", caseVersionAfter: 2 }),
    }));
  });

  it("replays an already completed response without touching case or messages", async () => {
    const responseSnapshot = { statusCode: 200, assistantMessageId, caseVersion: 2 };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique: vi.fn().mockResolvedValue(turnRow({ status: "completed", responseSnapshot })), update: vi.fn() },
      caseRecord: { findFirst: vi.fn(), updateMany: vi.fn() },
      caseRecordRevision: { create: vi.fn() },
      auditEvent: { create: vi.fn() },
      conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    };

    await expect(new PrismaConversationTurnFinalizer(databaseFor(tx)).finalize({ accountId, caseId, turnId, requestHash })).resolves.toMatchObject({
      kind: "replay",
      responseSnapshot,
    });
    expect(tx.caseRecord.updateMany).not.toHaveBeenCalled();
    expect(tx.conversationMessage.create).not.toHaveBeenCalled();
  });

  it("does not claim an assistant message was saved for a degraded turn", async () => {
    const degradedTurn = turnRow({
      resultSnapshot: {
        assistant: {
          state: "FACT_GATHERING",
          message: "当前无法安全完成 AI 整理，请稍后重试。",
          questions: [],
          actions: [],
          disclaimerIds: ["ai-assessment"],
          degraded: true,
        },
      },
    });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ caseId }]),
      conversationTurn: { findUnique: vi.fn().mockResolvedValue(degradedTurn), update: vi.fn().mockResolvedValue(degradedTurn) },
      caseRecord: { findFirst: vi.fn().mockResolvedValue(caseRow()), updateMany: vi.fn() },
      caseRecordRevision: { create: vi.fn() },
      auditEvent: { create: vi.fn() },
      conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    };

    const result = await new PrismaConversationTurnFinalizer(databaseFor(tx)).finalize({ accountId, caseId, turnId, requestHash });

    expect(result.kind).toBe("completed");
    if (result.kind === "completed") {
      expect(result.responseSnapshot.persistence).toMatchObject({
        userMessageSaved: true,
        assistantMessageSaved: false,
        messageSaved: false,
      });
    }
    expect(tx.conversationMessage.create).not.toHaveBeenCalled();
  });
});
