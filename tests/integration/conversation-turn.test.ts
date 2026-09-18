import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import { PrismaCaseRepository } from "@/server/repositories/case-repository";
import { PrismaMessageRepository } from "@/server/repositories/message-repository";
import {
  ConversationTurnUnavailable,
  PrismaConversationTurnRepository,
} from "@/server/repositories/conversation-turn-repository";
import {
  PrismaConversationTurnFinalizer,
  FinalizeTurnUnavailable,
} from "@/server/services/conversation-turn-finalizer";
import { hashTurnIdentity } from "@/server/services/conversation-turn-contract";
import { AesGcmConversationTurnSnapshotCipher } from "@/server/services/conversation-turn-snapshot-cipher";
import { makeCaseRecordFixture } from "../fixtures/case-record";

function makeDraft() {
  const fixture = makeCaseRecordFixture();
  const { accountId, caseId, createdAt, deletedAt, updatedAt, version, ...draft } = fixture;
  void accountId;
  void caseId;
  void createdAt;
  void deletedAt;
  void updatedAt;
  void version;
  return { ...draft, lifecycle: "draft" as const };
}

const accounts = new PrismaAccountRepository(prisma);
const cases = new PrismaCaseRepository(prisma);
const messages = new PrismaMessageRepository(prisma);
const turns = new PrismaConversationTurnRepository(prisma);
const finalizer = new PrismaConversationTurnFinalizer(prisma);

type OwnedCase = {
  accountId: string;
  caseId: string;
  version: number;
};

async function createOwnedCase(): Promise<OwnedCase> {
  const account = await accounts.createPseudonymous();
  const record = await cases.createDraft(account.accountId, makeDraft());
  return { accountId: account.accountId, caseId: record.caseId, version: record.version };
}

function sendInput(
  owner: OwnedCase,
  overrides: Partial<{
    turnId: string;
    message: string;
    baseCaseVersion: number;
    requestHash: string;
  }> = {},
) {
  const turnId = overrides.turnId ?? randomUUID();
  const message = overrides.message ?? "用户陈述";
  const baseCaseVersion = overrides.baseCaseVersion ?? owner.version;
  return {
    accountId: owner.accountId,
    caseId: owner.caseId,
    turnId,
    operation: "send" as const,
    requestHash: overrides.requestHash ?? hashTurnIdentity({
      operation: "send",
      caseId: owner.caseId,
      message,
      contentRefs: [],
      baseCaseVersion,
    }),
    baseCaseVersion,
    message,
  };
}

function retryInput(
  owner: OwnedCase,
  sourceUserMessageId: string,
  overrides: Partial<{ turnId: string; baseCaseVersion: number }> = {},
) {
  const turnId = overrides.turnId ?? randomUUID();
  const baseCaseVersion = overrides.baseCaseVersion ?? owner.version;
  const message = "数据库中的原文";
  return {
    accountId: owner.accountId,
    caseId: owner.caseId,
    turnId,
    operation: "retry" as const,
    sourceUserMessageId,
    userMessageId: sourceUserMessageId,
    requestHash: hashTurnIdentity({
      operation: "retry",
      caseId: owner.caseId,
      sourceUserMessageId,
      message,
      contentRefs: [],
      baseCaseVersion,
    }),
    baseCaseVersion,
    message,
  };
}

function resultSnapshot(message = "已整理本轮事实。", withPatch = false) {
  return {
    assistant: {
      state: "FACT_GATHERING" as const,
      message,
      questions: [],
      actions: ["pause" as const],
      disclaimerIds: ["ai-assessment" as const],
      degraded: false,
      ...(withPatch ? { draftPatch: { facts: [] } } : {}),
    },
  };
}

async function reserveAndRecord(
  owner: OwnedCase,
  options: { withPatch?: boolean; message?: string } = {},
) {
  const input = sendInput(owner, options.message === undefined ? {} : { message: options.message });
  const reserved = await turns.reserve(input);
  expect(reserved.kind).toBe("owner");
  if (reserved.kind !== "owner") throw new Error("turn was not reserved by test");
  await turns.recordResult(
    owner.accountId,
    owner.caseId,
    input.turnId,
    input.requestHash,
    resultSnapshot(options.message ? `回复：${options.message}` : undefined, options.withPatch ?? false),
  );
  return { input, userMessageId: reserved.userMessageId };
}

const failureTriggerName = "manbo_test_turn_finalize_failure_trigger";
const failureFunctionName = "manbo_test_turn_finalize_failure";

async function dropFailureTrigger() {
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS "${failureTriggerName}" ON "case_records"`,
  );
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS "${failureTriggerName}" ON "case_record_revisions"`,
  );
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS "${failureTriggerName}" ON "audit_events"`,
  );
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS "${failureTriggerName}" ON "conversation_messages"`,
  );
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS "${failureTriggerName}" ON "conversation_turns"`,
  );
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${failureFunctionName}"()`);
}

async function installFailureTrigger(
  table: "case_records" | "case_record_revisions" | "audit_events" | "conversation_messages" | "conversation_turns",
) {
  await dropFailureTrigger();
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${failureFunctionName}"()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'TEST_FINALIZER_FAILURE';
    END;
    $$ LANGUAGE plpgsql
  `);

  const event = table === "case_records" || table === "conversation_turns" ? "BEFORE UPDATE" : "BEFORE INSERT";
  const condition = table === "audit_events"
    ? ` WHEN (NEW."action" = 'update'::"AuditAction")`
    : table === "conversation_messages"
      ? ` WHEN (NEW."role" = 'assistant'::"MessageRole")`
      : table === "conversation_turns"
        ? ` WHEN (NEW."status" = 'completed'::"ConversationTurnStatus")`
        : "";

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${failureTriggerName}"
    ${event} ON "${table}"
    FOR EACH ROW${condition}
    EXECUTE FUNCTION "${failureFunctionName}"()
  `);
}

const pauseFunctionName = "manbo_test_turn_pause_child_insert";
const pauseTriggerName = "manbo_test_turn_pause_child_insert_trigger";

async function installPauseTrigger() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "${pauseFunctionName}"()
    RETURNS trigger AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(27182, 81829);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${pauseTriggerName}"
    BEFORE INSERT ON "conversation_messages"
    FOR EACH ROW EXECUTE FUNCTION "${pauseFunctionName}"()
  `);
}

async function beginPause() {
  let acquiredResolve: () => void = () => undefined;
  let releaseResolve: () => void = () => undefined;
  const acquired = new Promise<void>((resolve) => { acquiredResolve = resolve; });
  const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
  const holder = prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`
      DO $$
      BEGIN
        PERFORM pg_advisory_xact_lock(27182, 81829);
      END
      $$;
    `);
    acquiredResolve();
    await release;
  });
  await acquired;
  return { holder, release: releaseResolve };
}

async function waitForPause() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT COUNT(*) AS "waiting"
      FROM pg_locks
      WHERE locktype = 'advisory' AND granted = false
    `;
    if (row && Number(row.waiting) > 0) return;
    await delay(20);
  }
  throw new Error("Timed out waiting for conversation child insert barrier");
}

async function dropPauseTrigger() {
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS "${pauseTriggerName}" ON "conversation_messages"`,
  );
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${pauseFunctionName}"()`);
}

afterEach(async () => {
  await dropFailureTrigger();
  await dropPauseTrigger();
});

describe("conversation turn PostgreSQL integration", () => {
  it("allows one owner for concurrent reservations of the same turn and one user row", async () => {
    const owner = await createOwnedCase();
    const input = sendInput(owner);

    const results = await Promise.all([
      turns.reserve(input),
      turns.reserve(input),
    ]);

    expect(results.filter((result) => result.kind === "owner")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "in_flight" || result.kind === "replay")).toHaveLength(1);
    await expect(prisma.conversationTurn.count({ where: { accountId: owner.accountId, caseId: owner.caseId } })).resolves.toBe(1);
    await expect(prisma.conversationMessage.count({ where: { accountId: owner.accountId, caseId: owner.caseId, role: "user" } })).resolves.toBe(1);
  });

  it("turns an abandoned expired processing lease into a replayable failure", async () => {
    const owner = await createOwnedCase();
    const now = new Date("2026-09-18T00:10:00.000Z");
    const leasedTurns = new PrismaConversationTurnRepository(prisma, undefined, { now: () => now });
    const input = sendInput(owner);

    await expect(leasedTurns.reserve(input)).resolves.toMatchObject({ kind: "owner" });
    await prisma.conversationTurn.update({
      where: { turnId: input.turnId },
      data: { leaseUntil: new Date(now.getTime() - 1_000) },
    });

    const replay = await leasedTurns.reserve(input);
    expect(replay.kind).toBe("replay");
    if (replay.kind === "replay") {
      expect(replay.turn.status).toBe("failed");
      expect(replay.turn.responseSnapshot).toEqual({
        statusCode: 503,
        error: { code: "TURN_EXPIRED", message: "本轮处理已超时，请重新提交。" },
      });
    }
    await expect(prisma.conversationMessage.count({ where: { accountId: owner.accountId, caseId: owner.caseId, role: "user" } })).resolves.toBe(1);
  });

  it("finalizes the same turn concurrently into one assistant and one case revision", async () => {
    const owner = await createOwnedCase();
    const { input, userMessageId } = await reserveAndRecord(owner, { withPatch: true });

    const [first, second] = await Promise.all([
      finalizer.finalize({ accountId: owner.accountId, caseId: owner.caseId, turnId: input.turnId, requestHash: input.requestHash }),
      finalizer.finalize({ accountId: owner.accountId, caseId: owner.caseId, turnId: input.turnId, requestHash: input.requestHash }),
    ]);

    expect(new Set([first.kind, second.kind])).toEqual(new Set(["completed", "replay"]));
    const persistedMessages = await prisma.conversationMessage.findMany({
      where: { accountId: owner.accountId, caseId: owner.caseId },
      orderBy: { messageSequence: "asc" },
      select: { messageId: true, role: true, turnId: true, messageSequence: true },
    });
    expect(persistedMessages).toHaveLength(2);
    expect(persistedMessages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(persistedMessages[0]).toMatchObject({ messageId: userMessageId, role: "user", turnId: input.turnId, messageSequence: 1 });
    expect(persistedMessages[1]).toMatchObject({ role: "assistant", turnId: input.turnId, messageSequence: 2 });
    await expect(prisma.caseRecordRevision.count({ where: { accountId: owner.accountId, caseId: owner.caseId } })).resolves.toBe(2);
    await expect(prisma.auditEvent.count({ where: { accountId: owner.accountId, caseId: owner.caseId, action: "update" } })).resolves.toBe(1);
    await expect(prisma.conversationTurn.count({ where: { accountId: owner.accountId, caseId: owner.caseId, status: "completed" } })).resolves.toBe(1);
  });

  it("serializes different turns on one case and keeps message sequences unique", async () => {
    const owner = await createOwnedCase();
    const first = await reserveAndRecord(owner, { message: "第一轮" });
    const second = await reserveAndRecord(owner, { message: "第二轮" });

    const results = await Promise.all([
      finalizer.finalize({ accountId: owner.accountId, caseId: owner.caseId, turnId: first.input.turnId, requestHash: first.input.requestHash }),
      finalizer.finalize({ accountId: owner.accountId, caseId: owner.caseId, turnId: second.input.turnId, requestHash: second.input.requestHash }),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(["completed", "completed"]);
    const rows = await prisma.conversationMessage.findMany({
      where: { accountId: owner.accountId, caseId: owner.caseId },
      orderBy: { messageSequence: "asc" },
      select: { messageSequence: true, role: true },
    });
    expect(rows).toEqual([
      { messageSequence: 1, role: "user" },
      { messageSequence: 2, role: "user" },
      { messageSequence: 3, role: "assistant" },
      { messageSequence: 4, role: "assistant" },
    ]);
  });

  it.each([
    "case_records",
    "case_record_revisions",
    "audit_events",
    "conversation_messages",
    "conversation_turns",
  ] as const)("rolls back every finalization write when %s fails", async (table) => {
    const owner = await createOwnedCase();
    const { input } = await reserveAndRecord(owner, { withPatch: true });
    await installFailureTrigger(table);

    await expect(finalizer.finalize({
      accountId: owner.accountId,
      caseId: owner.caseId,
      turnId: input.turnId,
      requestHash: input.requestHash,
    })).rejects.toThrow("TEST_FINALIZER_FAILURE");

    await expect(prisma.caseRecord.findUniqueOrThrow({ where: { caseId: owner.caseId } })).resolves.toMatchObject({ version: 1, lifecycle: "draft" });
    await expect(prisma.caseRecordRevision.count({ where: { accountId: owner.accountId, caseId: owner.caseId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { accountId: owner.accountId, caseId: owner.caseId, action: "update" } })).resolves.toBe(0);
    await expect(prisma.conversationMessage.count({ where: { accountId: owner.accountId, caseId: owner.caseId, role: "assistant" } })).resolves.toBe(0);
    await expect(prisma.conversationTurn.findUniqueOrThrow({ where: { turnId: input.turnId } })).resolves.toMatchObject({ status: "result_ready", assistantMessageId: null, caseVersionAfter: null });
  });

  it("marks a retry as a durable conflict when a newer user commits before finalization", async () => {
    const owner = await createOwnedCase();
    const original = await reserveAndRecord(owner, { message: "原始消息" });
    await expect(finalizer.finalize({
      accountId: owner.accountId,
      caseId: owner.caseId,
      turnId: original.input.turnId,
      requestHash: original.input.requestHash,
    })).resolves.toMatchObject({ kind: "completed" });
    const retry = retryInput(owner, original.userMessageId);
    const retryReservation = await turns.reserve(retry);
    expect(retryReservation.kind).toBe("owner");
    await turns.recordResult(owner.accountId, owner.caseId, retry.turnId, retry.requestHash, resultSnapshot("重试回复", true));

    await installPauseTrigger();
    const pause = await beginPause();
    try {
      const appendNewUser = messages.append(owner.accountId, owner.caseId, { role: "user", content: "更新后的消息" });
      await waitForPause();
      let settled = false;
      const finalizeRetry = finalizer.finalize({
        accountId: owner.accountId,
        caseId: owner.caseId,
        turnId: retry.turnId,
        requestHash: retry.requestHash,
      }).finally(() => { settled = true; });

      await delay(100);
      expect(settled).toBe(false);
      pause.release();
      await expect(appendNewUser).resolves.toBeDefined();
      await expect(finalizeRetry).resolves.toMatchObject({ kind: "conflict" });
    } finally {
      pause.release();
      await pause.holder;
    }

    await expect(prisma.conversationMessage.count({ where: { accountId: owner.accountId, caseId: owner.caseId, role: "assistant" } })).resolves.toBe(1);
    await expect(prisma.conversationTurn.findUniqueOrThrow({ where: { turnId: retry.turnId } })).resolves.toMatchObject({ status: "conflict" });
  });

  it("fails closed after a private case is soft-deleted", async () => {
    const owner = await createOwnedCase();
    const { input } = await reserveAndRecord(owner, { withPatch: true });
    await cases.markDeleted(owner.accountId, owner.caseId);

    await expect(finalizer.finalize({
      accountId: owner.accountId,
      caseId: owner.caseId,
      turnId: input.turnId,
      requestHash: input.requestHash,
    })).rejects.toBeInstanceOf(FinalizeTurnUnavailable);
    await expect(turns.reserve(sendInput(owner, { turnId: randomUUID() }))).rejects.toBeInstanceOf(ConversationTurnUnavailable);
    await expect(prisma.conversationMessage.count({ where: { accountId: owner.accountId, caseId: owner.caseId, role: "assistant" } })).resolves.toBe(0);
    await expect(prisma.caseRecord.findUniqueOrThrow({ where: { caseId: owner.caseId } })).resolves.toMatchObject({ lifecycle: "deleted", version: 2 });
  });

  it("does not expose or reuse a globally claimed turn UUID across another case", async () => {
    const first = await createOwnedCase();
    const second = await createOwnedCase();
    const turnId = randomUUID();
    const firstInput = sendInput(first, { turnId });
    await expect(turns.reserve(firstInput)).resolves.toMatchObject({ kind: "owner" });

    await expect(turns.get(second.accountId, second.caseId, turnId)).resolves.toBeNull();
    const secondInput = sendInput(second, { turnId: randomUUID() });
    await expect(turns.reserve(secondInput)).resolves.toMatchObject({ kind: "owner" });
    await expect(turns.get(first.accountId, first.caseId, secondInput.turnId)).resolves.toBeNull();
    await expect(prisma.conversationTurn.count({ where: { accountId: first.accountId, caseId: first.caseId } })).resolves.toBe(1);
    await expect(prisma.conversationTurn.count({ where: { accountId: second.accountId, caseId: second.caseId } })).resolves.toBe(1);
    await expect(turns.reserve(sendInput(second, { turnId }))).rejects.toThrow();
    await expect(prisma.conversationMessage.count({ where: { accountId: second.accountId, caseId: second.caseId } })).resolves.toBe(1);
  });

  it("stores result and response snapshots as authenticated ciphertext when configured", async () => {
    const owner = await createOwnedCase();
    const cipher = new AesGcmConversationTurnSnapshotCipher({
      key: Buffer.alloc(32, 0x2a),
      keyVersion: "turn-v1",
    });
    const encryptedTurns = new PrismaConversationTurnRepository(prisma, cipher);
    const encryptedFinalizer = new PrismaConversationTurnFinalizer(prisma, () => new Date(), cipher);
    const input = sendInput(owner, { message: "只应在受控快照中解密" });
    const reserved = await encryptedTurns.reserve(input);
    expect(reserved.kind).toBe("owner");
    await encryptedTurns.recordResult(
      owner.accountId,
      owner.caseId,
      input.turnId,
      input.requestHash,
      resultSnapshot("只应在受控快照中解密"),
    );

    const storedResult = await prisma.conversationTurn.findUniqueOrThrow({ where: { turnId: input.turnId } });
    expect(storedResult.resultSnapshot).toMatchObject({ scheme: "AES-256-GCM", keyVersion: "turn-v1" });
    expect(JSON.stringify(storedResult.resultSnapshot)).not.toContain("只应在受控快照中解密");

    const finalized = await encryptedFinalizer.finalize({
      accountId: owner.accountId,
      caseId: owner.caseId,
      turnId: input.turnId,
      requestHash: input.requestHash,
    });
    expect(finalized.kind).toBe("completed");
    const storedResponse = await prisma.conversationTurn.findUniqueOrThrow({ where: { turnId: input.turnId } });
    expect(storedResponse.responseSnapshot).toMatchObject({ scheme: "AES-256-GCM", keyVersion: "turn-v1" });
    expect(JSON.stringify(storedResponse.responseSnapshot)).not.toContain("只应在受控快照中解密");

    await expect(encryptedFinalizer.finalize({
      accountId: owner.accountId,
      caseId: owner.caseId,
      turnId: input.turnId,
      requestHash: input.requestHash,
    })).resolves.toMatchObject({
      kind: "replay",
      responseSnapshot: { assistant: { message: "只应在受控快照中解密" } },
    });
  });
});
