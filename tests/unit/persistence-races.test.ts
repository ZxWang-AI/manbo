import type { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";

import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import { PrismaConsentRepository } from "@/server/repositories/consent-repository";
import {
  PrismaMessageRepository,
  PrivateCaseUnavailable,
} from "@/server/repositories/message-repository";
import { makeCaseRecordFixture } from "../fixtures/case-record";

function callbackDatabase(transaction: object): PrismaClient {
  return {
    $transaction: vi.fn(async (operation: unknown) => {
      if (typeof operation === "function") {
        return operation(transaction);
      }
      return Promise.all(operation as Promise<unknown>[]);
    }),
  } as unknown as PrismaClient;
}

describe("private case write races", () => {
  it("does not let the user-scoped append API forge assistant or system messages", async () => {
    const transaction = {
      $queryRaw: vi.fn(),
      conversationMessage: { create: vi.fn() },
    };
    const repository = new PrismaMessageRepository(callbackDatabase(transaction));

    await expect(
      repository.append("a".repeat(32), "36ee7b31-8590-4afe-995e-0e360714d647", {
        role: "assistant",
        content: "forged",
      }),
    ).rejects.toThrow();
    expect(transaction.conversationMessage.create).not.toHaveBeenCalled();
  });

  it("rejects a message when the locked case row is already deleted", async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      caseRecord: {
        findFirst: vi.fn().mockResolvedValue({ caseId: "36ee7b31-8590-4afe-995e-0e360714d647" }),
      },
      conversationMessage: {
        create: vi.fn().mockResolvedValue({ messageId: "68ae7962-d73c-4832-b736-c3dfe93b3d16" }),
      },
    };
    const repository = new PrismaMessageRepository(callbackDatabase(transaction));

    await expect(
      repository.append(
        "a".repeat(32),
        "36ee7b31-8590-4afe-995e-0e360714d647",
        { role: "user", content: "A user-controlled statement" },
      ),
    ).rejects.toBeInstanceOf(PrivateCaseUnavailable);
  });

  it("rejects a consent event when the locked case row is already deleted", async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      caseRecord: {
        findFirst: vi.fn().mockResolvedValue({ caseId: "36ee7b31-8590-4afe-995e-0e360714d647" }),
      },
      consentEvent: {
        create: vi.fn().mockResolvedValue({
          consentEventId: "d859a76b-b93b-4f47-9b83-8c94f05c4d72",
        }),
      },
    };
    const repository = new PrismaConsentRepository(callbackDatabase(transaction));

    await expect(
      repository.record(
        "a".repeat(32),
        "36ee7b31-8590-4afe-995e-0e360714d647",
        {
          version: "v1",
          saveCase: true,
          externalSharing: false,
          confirmedFieldPaths: [],
        },
        1,
      ),
    ).rejects.toBeInstanceOf(PrivateCaseUnavailable);
  });

  it("changes the current consent and appends its event in one versioned transaction", async () => {
    let persistedVersion = 1;
    let persistedConsent = {
      version: "v1",
      saveCase: true,
      externalSharing: true,
      confirmedFieldPaths: ["/facts"],
    };
    const fixture = makeCaseRecordFixture();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([
        { caseId: "36ee7b31-8590-4afe-995e-0e360714d647" },
      ]),
      caseRecord: {
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          if (where.version !== persistedVersion) {
            return { count: 0 };
          }
          persistedVersion += data.version.increment;
          persistedConsent = data.consent;
          return { count: 1 };
        }),
        findFirst: vi.fn().mockImplementation(async () => ({
          ...fixture,
          caseId: "36ee7b31-8590-4afe-995e-0e360714d647",
          accountId: "a".repeat(32),
          version: persistedVersion,
          consent: persistedConsent,
          createdAt: new Date(fixture.createdAt),
          updatedAt: new Date(fixture.updatedAt),
          deletedAt: null,
          aiReviewStatus: null,
        })),
      },
      caseRecordRevision: {
        create: vi.fn().mockImplementation(async ({ data }) => data),
      },
      consentEvent: {
        create: vi.fn().mockImplementation(async ({ data }) => data),
      },
      auditEvent: {
        create: vi.fn().mockImplementation(async ({ data }) => data),
      },
    };
    const repository = new PrismaConsentRepository(callbackDatabase(transaction));
    const withdrawnConsent = {
      version: "v2",
      saveCase: true,
      externalSharing: false,
      confirmedFieldPaths: ["/facts"],
    };

    await repository.record(
      "a".repeat(32),
      "36ee7b31-8590-4afe-995e-0e360714d647",
      withdrawnConsent,
      1,
    );

    expect({ version: persistedVersion, consent: persistedConsent }).toEqual({
      version: 2,
      consent: withdrawnConsent,
    });
  });
});

describe("recovery throttling races", () => {
  it("does not issue a session when a concurrent failure has activated the block", async () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    const recoverySecret = "correct-recovery-secret";
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([
        { blockedUntil: new Date("2026-08-31T12:15:00.000Z") },
      ]),
      recoveryThrottle: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      authSession: { create: vi.fn().mockResolvedValue({}) },
    };
    const database = callbackDatabase(transaction) as unknown as {
      account: { findUnique: ReturnType<typeof vi.fn> };
      recoveryThrottle: {
        findUnique: ReturnType<typeof vi.fn>;
        deleteMany: ReturnType<typeof vi.fn>;
      };
      authSession: { create: ReturnType<typeof vi.fn> };
      $transaction: PrismaClient["$transaction"];
    };
    database.account = {
      findUnique: vi.fn().mockResolvedValue({
        accountId: "a".repeat(32),
        recoverySecretHash: await argon2.hash(recoverySecret),
      }),
    };
    database.recoveryThrottle = {
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    database.authSession = { create: vi.fn().mockResolvedValue({}) };
    const repository = new PrismaAccountRepository(
      database as unknown as PrismaClient,
      () => now,
    );

    await expect(repository.recover("quiet-river-abcd", recoverySecret)).resolves.toBeNull();
  });

  it("does not persist throttle rows for aliases that have no account", async () => {
    const transaction = { $executeRaw: vi.fn() };
    const database = callbackDatabase(transaction) as unknown as {
      account: { findUnique: ReturnType<typeof vi.fn> };
      recoveryThrottle: { findUnique: ReturnType<typeof vi.fn> };
      $transaction: PrismaClient["$transaction"];
    };
    database.account = { findUnique: vi.fn().mockResolvedValue(null) };
    database.recoveryThrottle = { findUnique: vi.fn().mockResolvedValue(null) };
    const repository = new PrismaAccountRepository(database as unknown as PrismaClient);

    await expect(repository.recover("unknown-alias-abcd", "wrong-secret")).resolves.toBeNull();
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(transaction.$executeRaw).not.toHaveBeenCalled();
  });
});
