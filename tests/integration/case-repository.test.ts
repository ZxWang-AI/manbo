import { beforeEach, describe, expect, it } from "vitest";

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
    await consents.record(owner.accountId, record.caseId, makeDraft().consent);

    await expect(messages.listPrivate(owner.accountId, record.caseId)).resolves.toHaveLength(1);
    await expect(messages.listPrivate(other.accountId, record.caseId)).resolves.toEqual([]);
    await expect(consents.listPrivate(other.accountId, record.caseId)).resolves.toEqual([]);
    await expect(
      messages.append(other.accountId, record.caseId, { role: "user", content: "not owned" }),
    ).rejects.toBeInstanceOf(PrivateCaseUnavailable);
    await expect(
      consents.record(other.accountId, record.caseId, makeDraft().consent),
    ).rejects.toBeInstanceOf(PrivateCaseUnavailable);
  });
});
