import { setTimeout as delay } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import {
  ConcurrencyConflict,
  PrismaCaseRepository,
} from "@/server/repositories/case-repository";
import { PrismaConsentRepository } from "@/server/repositories/consent-repository";
import {
  PrismaMessageRepository,
  PrivateCaseUnavailable,
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
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(27182, 81828)`;
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
      where: { accountId: created.accountId },
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
