import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { hashOpaqueToken } from "@/server/auth";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import {
  ConcurrencyConflict,
  PrismaCaseRepository,
} from "@/server/repositories/case-repository";
import { PrismaConsentRepository } from "@/server/repositories/consent-repository";
import {
  PrismaMessageRepository,
  PrivateCaseUnavailable,
  RetrySourceSuperseded,
} from "@/server/repositories/message-repository";
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

async function installPausedChildInsertTrigger(table: "conversation_messages" | "consent_events") {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION manbo_test_pause_child_insert()
    RETURNS trigger AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(27182, 81828);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER manbo_test_pause_child_insert_trigger
    BEFORE INSERT ON "${table}"
    FOR EACH ROW EXECUTE FUNCTION manbo_test_pause_child_insert()
  `);
}

async function beginChildInsertPause() {
  let announceAcquired: () => void = () => undefined;
  let releaseLock: () => void = () => undefined;
  const acquired = new Promise<void>((resolve) => {
    announceAcquired = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const holder = prisma.$transaction(async (transaction) => {
    // `pg_advisory_xact_lock` returns PostgreSQL's `void` type. Prisma cannot
    // deserialize a void column from `$queryRaw`, so acquire the lock inside a
    // DO block that returns no result set.
    await transaction.$executeRawUnsafe(`
      DO $$
      BEGIN
        PERFORM pg_advisory_xact_lock(27182, 81828);
      END
      $$;
    `);
    announceAcquired();
    await release;
  });
  await acquired;
  return { holder, release: releaseLock };
}

async function waitForPausedChildInsert(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT COUNT(*) AS "waiting"
      FROM pg_locks
      WHERE locktype = 'advisory' AND granted = false
    `;
    if (row && Number(row.waiting) > 0) {
      return;
    }
    await delay(20);
  }
  throw new Error("Timed out waiting for the child insert concurrency barrier");
}

async function removePausedChildInsertTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS manbo_test_pause_child_insert_trigger ON "conversation_messages"',
  );
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS manbo_test_pause_child_insert_trigger ON "consent_events"',
  );
  await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS manbo_test_pause_child_insert()" );
}

describe("private case persistence", () => {
  const accounts = new PrismaAccountRepository(prisma);
  const repository = new PrismaCaseRepository(prisma);
  const messages = new PrismaMessageRepository(prisma);
  const consents = new PrismaConsentRepository(prisma);

  beforeEach(async () => {
    await prisma.auditEvent.deleteMany();
    await prisma.caseRecord.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.recoveryThrottle.deleteMany();
    await prisma.account.deleteMany();
  });

  afterEach(async () => {
    await removePausedChildInsertTrigger();
  });

  it("does not allow another account to read or update a private case", async () => {
    const owner = await accounts.createPseudonymous();
    const other = await accounts.createPseudonymous();
    const record = await repository.createDraft(owner.accountId, makeDraft());

    await expect(repository.getPrivate(other.accountId, record.caseId)).resolves.toBeNull();
    await expect(
      repository.updatePrivate(other.accountId, record.caseId, { jurisdiction: {} }, 1),
    ).rejects.toBeInstanceOf(ConcurrencyConflict);
    await expect(repository.getPrivate(owner.accountId, record.caseId)).resolves.toMatchObject({
      accountId: owner.accountId,
      visibility: "private",
      version: 1,
    });
  });

  it("increments versions atomically and rejects stale updates", async () => {
    const account = await accounts.createPseudonymous();
    const record = await repository.createDraft(account.accountId, makeDraft());
    const updated = await repository.updatePrivate(
      account.accountId,
      record.caseId,
      { jurisdiction: { incidentCountry: "CN" } },
      1,
    );

    expect(updated.version).toBe(2);
    await expect(
      repository.updatePrivate(account.accountId, record.caseId, { jurisdiction: {} }, 1),
    ).rejects.toBeInstanceOf(ConcurrencyConflict);
    const audits = await prisma.auditEvent.findMany({
      where: { accountId: account.accountId, caseId: record.caseId },
      orderBy: { occurredAt: "asc" },
    });
    expect(audits.map((audit) => audit.metadata)).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
    expect(JSON.stringify(audits)).not.toMatch(
      /招聘过程详情|我被要求在工厂工作|manbo-constant-time-recovery-placeholder|device|ip/i,
    );
  });

  it("keeps immutable snapshots when a case advances to a new version", async () => {
    const account = await accounts.createPseudonymous();
    const original = await repository.createDraft(account.accountId, makeDraft());
    const updated = await repository.updatePrivate(
      account.accountId,
      original.caseId,
      { jurisdiction: { incidentCountry: "CN" } },
      original.version,
    );

    await expect(
      repository.getVersionPrivate(account.accountId, original.caseId, original.version),
    ).resolves.toEqual(original);
    await expect(
      repository.getVersionPrivate(account.accountId, original.caseId, updated.version),
    ).resolves.toEqual(updated);
  });

  it("soft deletion changes lifecycle, excludes reads, and records content-free audit data", async () => {
    const account = await accounts.createPseudonymous();
    const record = await repository.createDraft(account.accountId, makeDraft());

    await repository.markDeleted(account.accountId, record.caseId);

    await expect(repository.getPrivate(account.accountId, record.caseId)).resolves.toBeNull();
    await expect(
      prisma.caseRecord.findUniqueOrThrow({ where: { caseId: record.caseId } }),
    ).resolves.toMatchObject({ lifecycle: "deleted", version: 2 });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { accountId: account.accountId, caseId: record.caseId, action: "delete" },
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/narrative|quote|fact|device|ip/i);
  });

  it("returns recovery material once, stores only hashes, and issues an opaque session", async () => {
    const created = await accounts.createPseudonymous();
    const stored = await prisma.account.findUniqueOrThrow({ where: { accountId: created.accountId } });

    expect(stored.recoverySecretHash).not.toBe(created.recoverySecret);
    expect(stored).not.toHaveProperty("recoverySecret");
    await expect(accounts.recover(created.alias, "wrong-secret")).resolves.toBeNull();

    const session = await accounts.recover(created.alias, created.recoverySecret);
    expect(session).not.toBeNull();
    expect(session?.accountId).toBe(created.accountId);
    const persistedSession = await prisma.authSession.findFirstOrThrow({
      where: { sessionIdHash: hashOpaqueToken(session?.sessionId ?? "") },
    });
    expect(persistedSession.sessionIdHash).not.toBe(session?.sessionId);
    expect(persistedSession.idleExpiresAt.toISOString()).toBe(session?.expiresAt);
    expect(
      persistedSession.absoluteExpiresAt.getTime() - persistedSession.createdAt.getTime(),
    ).toBe(12 * 60 * 60 * 1000);
  });

  it("checks case ownership before storing messages or consent events", async () => {
    const owner = await accounts.createPseudonymous();
    const other = await accounts.createPseudonymous();
    const record = await repository.createDraft(owner.accountId, makeDraft());

    await messages.append(owner.accountId, record.caseId, {
      role: "user",
      content: "A user-controlled statement",
    });
    await consents.record(owner.accountId, record.caseId, makeDraft().consent, record.version);

    await expect(messages.listPrivate(owner.accountId, record.caseId)).resolves.toHaveLength(1);
    await expect(messages.listPrivate(other.accountId, record.caseId)).resolves.toEqual([]);
    await expect(consents.listPrivate(other.accountId, record.caseId)).resolves.toEqual([]);
    await expect(
      messages.append(other.accountId, record.caseId, { role: "user", content: "not owned" }),
    ).rejects.toBeInstanceOf(PrivateCaseUnavailable);
    await expect(
      consents.record(other.accountId, record.caseId, makeDraft().consent, record.version),
    ).rejects.toBeInstanceOf(PrivateCaseUnavailable);
  });

  it("preserves append order when timestamps and UUID order disagree", async () => {
    const account = await accounts.createPseudonymous();
    const record = await repository.createDraft(account.accountId, makeDraft());
    const firstMessageId = "00000000-0000-4000-8000-000000000032";
    const secondMessageId = "00000000-0000-4000-8000-000000000031";
    await messages.append(
      account.accountId,
      record.caseId,
      { role: "user", content: "先写入" },
      firstMessageId,
    );
    await messages.append(
      account.accountId,
      record.caseId,
      { role: "user", content: "后写入" },
      secondMessageId,
    );
    await prisma.conversationMessage.updateMany({
      where: { accountId: account.accountId, caseId: record.caseId },
      data: { createdAt: new Date("2026-09-17T00:00:00.000Z") },
    });

    const listed = await messages.listPrivate(account.accountId, record.caseId);
    expect(listed.map((message) => message.messageId)).toEqual([
      firstMessageId,
      secondMessageId,
    ]);
    expect(listed.map((message) => message.messageSequence)).toEqual([1, 2]);
  });

  it("serializes concurrent old and new application writes into unique sequences", async () => {
    const account = await accounts.createPseudonymous();
    const record = await repository.createDraft(account.accountId, makeDraft());
    const firstMessageId = "00000000-0000-4000-8000-000000000043";
    const newApplicationMessageId = "00000000-0000-4000-8000-000000000042";
    const legacyMessageId = "00000000-0000-4000-8000-000000000041";

    await messages.append(
      account.accountId,
      record.caseId,
      { role: "user", content: "新应用写入的第一条消息" },
      firstMessageId,
    );
    const [legacyInsertCount, newApplicationMessage] = await Promise.all([
      prisma.$executeRaw`
        INSERT INTO "conversation_messages" (
          "message_id",
          "case_id",
          "account_id",
          "role",
          "content"
        ) VALUES (
          ${legacyMessageId}::uuid,
          ${record.caseId}::uuid,
          ${account.accountId},
          'user'::"MessageRole",
          ${"旧应用省略 message_sequence 写入的消息"}
        )
      `,
      messages.appendAssistant(
        account.accountId,
        record.caseId,
        "新应用显式分配 message_sequence 写入的消息",
        newApplicationMessageId,
      ),
    ]);

    expect(legacyInsertCount).toBe(1);
    expect(newApplicationMessage.messageId).toBe(newApplicationMessageId);

    const listed = await messages.listPrivate(account.accountId, record.caseId);
    expect(listed.map((message) => message.messageSequence)).toEqual([1, 2, 3]);
    expect(listed[0]?.messageId).toBe(firstMessageId);
    expect(new Set(listed.slice(1).map((message) => message.messageId))).toEqual(
      new Set([legacyMessageId, newApplicationMessageId]),
    );
    const assignedSequences = await prisma.conversationMessage.findMany({
      where: {
        accountId: account.accountId,
        caseId: record.caseId,
        messageId: { in: [legacyMessageId, newApplicationMessageId] },
      },
      orderBy: { messageSequence: "asc" },
      select: { messageId: true, messageSequence: true },
    });
    expect(assignedSequences.map((message) => message.messageSequence)).toEqual([2, 3]);
    expect(listed.map((message) => message.messageId)).toEqual([
      firstMessageId,
      ...assignedSequences.map((message) => message.messageId),
    ]);
  });

  it("rejects retry finalization after a concurrently locked user append commits", async () => {
    const account = await accounts.createPseudonymous();
    const record = await repository.createDraft(account.accountId, makeDraft());
    const originalUserMessageId = randomUUID();
    const newerUserMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    await messages.append(
      account.accountId,
      record.caseId,
      { role: "user", content: "原始用户消息" },
      originalUserMessageId,
    );
    await installPausedChildInsertTrigger("conversation_messages");
    const pause = await beginChildInsertPause();

    try {
      const appendNewUser = messages.append(
        account.accountId,
        record.caseId,
        { role: "user", content: "并发追加的新用户消息" },
        newerUserMessageId,
      );
      await waitForPausedChildInsert();

      let retrySettled = false;
      const retryResult = messages.appendAssistantForLatestUser(
        account.accountId,
        record.caseId,
        originalUserMessageId,
        "基于旧用户消息生成的回复",
        assistantMessageId,
      ).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      ).finally(() => {
        retrySettled = true;
      });

      await delay(200);
      expect(retrySettled).toBe(false);

      pause.release();
      await expect(appendNewUser).resolves.toMatchObject({ messageId: newerUserMessageId });
      const retry = await retryResult;
      expect(retry.status).toBe("rejected");
      if (retry.status === "rejected") {
        expect(retry.error).toBeInstanceOf(RetrySourceSuperseded);
      }
      const persisted = await prisma.conversationMessage.findMany({
        where: { accountId: account.accountId, caseId: record.caseId },
        select: { messageId: true, role: true },
      });
      expect(persisted).toHaveLength(2);
      expect(persisted.filter((message) => message.role === "assistant")).toEqual([]);
      expect(new Set(persisted.map((message) => message.messageId))).toEqual(
        new Set([originalUserMessageId, newerUserMessageId]),
      );
      await pause.holder;
    } finally {
      pause.release();
      await pause.holder;
    }
  });

  it("serializes a newer user append after retry finalization already holds the case lock", async () => {
    const account = await accounts.createPseudonymous();
    const record = await repository.createDraft(account.accountId, makeDraft());
    const originalUserMessageId = "00000000-0000-4000-8000-000000000023";
    const assistantMessageId = "00000000-0000-4000-8000-000000000022";
    const newerUserMessageId = "00000000-0000-4000-8000-000000000021";
    await messages.append(
      account.accountId,
      record.caseId,
      { role: "user", content: "原始用户消息" },
      originalUserMessageId,
    );
    await installPausedChildInsertTrigger("conversation_messages");
    const pause = await beginChildInsertPause();

    try {
      const appendRetryAssistant = messages.appendAssistantForLatestUser(
        account.accountId,
        record.caseId,
        originalUserMessageId,
        "基于当前最新用户消息生成的回复",
        assistantMessageId,
      );
      await waitForPausedChildInsert();

      let userAppendSettled = false;
      const appendNewUser = messages.append(
        account.accountId,
        record.caseId,
        { role: "user", content: "稍后追加的新用户消息" },
        newerUserMessageId,
      ).finally(() => {
        userAppendSettled = true;
      });

      await delay(200);
      expect(userAppendSettled).toBe(false);

      pause.release();
      await expect(appendRetryAssistant).resolves.toMatchObject({ messageId: assistantMessageId });
      await expect(appendNewUser).resolves.toMatchObject({ messageId: newerUserMessageId });
      const persisted = await prisma.conversationMessage.findMany({
        where: { accountId: account.accountId, caseId: record.caseId },
        orderBy: { messageSequence: "asc" },
        select: { messageId: true, messageSequence: true, role: true },
      });
      expect(persisted).toEqual([
        { messageId: originalUserMessageId, messageSequence: 1, role: "user" },
        { messageId: assistantMessageId, messageSequence: 2, role: "assistant" },
        { messageId: newerUserMessageId, messageSequence: 3, role: "user" },
      ]);
      expect(persisted.map((message) => message.messageSequence)).toEqual([1, 2, 3]);
      expect(
        [...persisted].sort((left, right) => left.messageId.localeCompare(right.messageId)),
      ).not.toEqual(persisted);
      await pause.holder;
    } finally {
      pause.release();
      await pause.holder;
    }
  });

  it("does not let deletion commit through an in-flight message append", async () => {
    const account = await accounts.createPseudonymous();
    const record = await repository.createDraft(account.accountId, makeDraft());
    await installPausedChildInsertTrigger("conversation_messages");
    const pause = await beginChildInsertPause();

    try {
      const append = messages.append(account.accountId, record.caseId, {
        role: "user",
        content: "A user-controlled statement",
      });
      await waitForPausedChildInsert();
      let deletionFinished = false;
      const deletion = repository.markDeleted(account.accountId, record.caseId).then(() => {
        deletionFinished = true;
      });
      await delay(200);
      expect(deletionFinished).toBe(false);

      pause.release();
      await Promise.all([append, deletion, pause.holder]);
    } finally {
      pause.release();
      await pause.holder;
    }
  });

  it("does not let deletion commit through an in-flight consent change", async () => {
    const account = await accounts.createPseudonymous();
    const record = await repository.createDraft(account.accountId, makeDraft());
    await installPausedChildInsertTrigger("consent_events");
    const pause = await beginChildInsertPause();

    try {
      const consentChange = consents.record(
        account.accountId,
        record.caseId,
        { ...record.consent, version: "v2", externalSharing: false },
        record.version,
      );
      await waitForPausedChildInsert();
      let deletionFinished = false;
      const deletion = repository.markDeleted(account.accountId, record.caseId).then(() => {
        deletionFinished = true;
      });
      await delay(200);
      expect(deletionFinished).toBe(false);

      pause.release();
      await Promise.all([consentChange, deletion, pause.holder]);
    } finally {
      pause.release();
      await pause.holder;
    }
  });

  it("updates the case consent and appends an auditable consent event atomically", async () => {
    const account = await accounts.createPseudonymous();
    const record = await repository.createDraft(account.accountId, makeDraft());
    const withdrawnConsent = {
      ...record.consent,
      version: "v2",
      externalSharing: false,
    };

    await consents.record(
      account.accountId,
      record.caseId,
      withdrawnConsent,
      record.version,
    );

    await expect(repository.getPrivate(account.accountId, record.caseId)).resolves.toMatchObject({
      consent: withdrawnConsent,
      version: record.version + 1,
    });
    await expect(
      prisma.consentEvent.findFirstOrThrow({ where: { caseId: record.caseId } }),
    ).resolves.toMatchObject({ snapshot: withdrawnConsent });
    await expect(
      prisma.auditEvent.findFirstOrThrow({
        where: { caseId: record.caseId, action: "consent_change" },
      }),
    ).resolves.toMatchObject({ metadata: { version: record.version + 1 } });
  });
});
