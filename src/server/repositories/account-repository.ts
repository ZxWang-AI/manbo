import { Prisma, type PrismaClient } from "@prisma/client";
import argon2 from "argon2";

import {
  SESSION_ABSOLUTE_MILLISECONDS,
  SESSION_IDLE_MILLISECONDS,
  createOpaqueSessionId,
  createPseudonymousCredentials,
  hashOpaqueToken,
  normalizeAlias,
} from "@/server/auth";

const recoveryHashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;
const recoveryWindowMilliseconds = 15 * 60 * 1000;
const recoveryMaximumFailures = 5;
let dummyRecoveryHash: Promise<string> | undefined;

export interface AuthSession {
  accountId: string;
  sessionId: string;
  expiresAt: string;
}

export interface AccountRepository {
  createPseudonymous(): Promise<{ accountId: string; alias: string; recoverySecret: string }>;
  recover(alias: string, recoverySecret: string): Promise<AuthSession | null>;
  resumeSession(sessionId: string): Promise<AuthSession | null>;
  revokeSession(sessionId: string): Promise<void>;
}

function getDummyRecoveryHash(): Promise<string> {
  dummyRecoveryHash ??= argon2.hash("manbo-constant-time-recovery-placeholder", recoveryHashOptions);
  return dummyRecoveryHash;
}

function earlierDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

export class PrismaAccountRepository implements AccountRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createPseudonymous() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const credentials = createPseudonymousCredentials();
      const recoverySecretHash = await argon2.hash(
        credentials.recoverySecret,
        recoveryHashOptions,
      );

      try {
        await this.database.account.create({
          data: {
            accountId: credentials.accountId,
            alias: credentials.alias,
            aliasHash: hashOpaqueToken(normalizeAlias(credentials.alias)),
            recoverySecretHash,
          },
        });
        return credentials;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
      }
    }

    throw new Error("Unable to allocate a unique pseudonymous account");
  }

  async recover(alias: string, recoverySecret: string): Promise<AuthSession | null> {
    const aliasHash = hashOpaqueToken(normalizeAlias(alias));
    const now = this.now();
    const [account, throttle, fallbackHash] = await Promise.all([
      this.database.account.findUnique({ where: { aliasHash } }),
      this.database.recoveryThrottle.findUnique({ where: { aliasHash } }),
      getDummyRecoveryHash(),
    ]);
    const validSecret = await argon2.verify(
      account?.recoverySecretHash ?? fallbackHash,
      recoverySecret,
    );

    if (throttle?.blockedUntil && throttle.blockedUntil > now) {
      return null;
    }

    if (!account) {
      return null;
    }

    if (!validSecret) {
      await this.recordRecoveryFailure(aliasHash, now);
      return null;
    }

    const sessionId = createOpaqueSessionId();
    const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MILLISECONDS);
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MILLISECONDS);

    return this.database.$transaction(
      async (transaction) => {
        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "recovery_throttles"
            ("alias_hash", "failed_count", "window_started_at", "blocked_until", "updated_at")
          VALUES (${aliasHash}, 0, ${now}, NULL, ${now})
          ON CONFLICT ("alias_hash") DO NOTHING
        `);
        const [lockedThrottle] = await transaction.$queryRaw<
          Array<{ blockedUntil: Date | null }>
        >(Prisma.sql`
          SELECT "blocked_until" AS "blockedUntil"
          FROM "recovery_throttles"
          WHERE "alias_hash" = ${aliasHash}
          FOR UPDATE
        `);

        if (lockedThrottle?.blockedUntil && lockedThrottle.blockedUntil > now) {
          return null;
        }

        await transaction.authSession.create({
          data: {
            sessionIdHash: hashOpaqueToken(sessionId),
            accountId: account.accountId,
            lastSeenAt: now,
            idleExpiresAt,
            absoluteExpiresAt,
          },
        });
        await transaction.recoveryThrottle.deleteMany({ where: { aliasHash } });

        return {
          accountId: account.accountId,
          sessionId,
          expiresAt: idleExpiresAt.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async resumeSession(sessionId: string): Promise<AuthSession | null> {
    const sessionIdHash = hashOpaqueToken(sessionId);
    const now = this.now();
    const session = await this.database.authSession.findUnique({ where: { sessionIdHash } });

    if (
      !session ||
      session.revokedAt ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now
    ) {
      return null;
    }

    const idleExpiresAt = earlierDate(
      new Date(now.getTime() + SESSION_IDLE_MILLISECONDS),
      session.absoluteExpiresAt,
    );
    const updated = await this.database.authSession.updateMany({
      where: {
        sessionIdHash,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      data: { lastSeenAt: now, idleExpiresAt },
    });

    return updated.count === 1
      ? { accountId: session.accountId, sessionId, expiresAt: idleExpiresAt.toISOString() }
      : null;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.database.authSession.updateMany({
      where: { sessionIdHash: hashOpaqueToken(sessionId), revokedAt: null },
      data: { revokedAt: this.now() },
    });
  }

  private async recordRecoveryFailure(
    aliasHash: string,
    now: Date,
  ): Promise<void> {
    const windowThreshold = new Date(now.getTime() - recoveryWindowMilliseconds);
    const blockedUntil = new Date(now.getTime() + recoveryWindowMilliseconds);

    await this.database.$executeRaw(Prisma.sql`
      INSERT INTO "recovery_throttles"
        ("alias_hash", "failed_count", "window_started_at", "blocked_until", "updated_at")
      VALUES (${aliasHash}, 1, ${now}, NULL, ${now})
      ON CONFLICT ("alias_hash") DO UPDATE SET
        "failed_count" = CASE
          WHEN "recovery_throttles"."window_started_at" <= ${windowThreshold} THEN 1
          ELSE "recovery_throttles"."failed_count" + 1
        END,
        "window_started_at" = CASE
          WHEN "recovery_throttles"."window_started_at" <= ${windowThreshold} THEN ${now}
          ELSE "recovery_throttles"."window_started_at"
        END,
        "blocked_until" = CASE
          WHEN "recovery_throttles"."window_started_at" <= ${windowThreshold} THEN NULL
          WHEN "recovery_throttles"."failed_count" + 1 >= ${recoveryMaximumFailures}
            THEN ${blockedUntil}
          ELSE "recovery_throttles"."blocked_until"
        END,
        "updated_at" = ${now}
    `);
  }
}
