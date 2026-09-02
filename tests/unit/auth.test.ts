import { Buffer } from "node:buffer";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  RECOVERY_SECRET_WARNING,
  buildSessionCookie,
  createPseudonymousCredentials,
  hashOpaqueToken,
} from "@/server/auth";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";

describe("pseudonymous credentials", () => {
  it("uses the required cryptographic entropy without collecting contact details", () => {
    const first = createPseudonymousCredentials();
    const second = createPseudonymousCredentials();

    expect(first.accountId).toMatch(/^[a-f0-9]{32}$/);
    expect(Buffer.from(first.recoverySecret, "base64url")).toHaveLength(32);
    expect(first.alias).toMatch(/^[a-z]+-[a-z]+-[a-z2-9]{4}$/);
    expect(second).not.toEqual(first);
    expect(first).not.toHaveProperty("email");
    expect(first).not.toHaveProperty("phone");
  });

  it("hashes opaque tokens deterministically before persistence", () => {
    const token = "opaque-session-value";

    expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    expect(hashOpaqueToken(token)).not.toContain(token);
  });

  it("builds a short-lived hardened production session cookie", () => {
    const cookie = buildSessionCookie("session-value", "production");

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=1800");
    expect(buildSessionCookie("session-value", "development")).not.toContain("; Secure");
  });

  it("states that a lost recovery secret cannot be recovered", () => {
    expect(RECOVERY_SECRET_WARNING).toContain("无法恢复");
  });
});

describe("opaque session lifecycle", () => {
  it("refreshes inactivity without exposing the stored hash or exceeding the absolute limit", async () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    const absoluteExpiresAt = new Date("2026-08-31T12:10:00.000Z");
    const findUnique = vi.fn().mockResolvedValue({
      accountId: "a".repeat(32),
      sessionIdHash: hashOpaqueToken("raw-session"),
      createdAt: new Date("2026-08-31T00:00:00.000Z"),
      lastSeenAt: new Date("2026-08-31T11:45:00.000Z"),
      idleExpiresAt: new Date("2026-08-31T12:05:00.000Z"),
      absoluteExpiresAt,
      revokedAt: null,
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = { authSession: { findUnique, updateMany } } as unknown as PrismaClient;
    const repository = new PrismaAccountRepository(database, () => now);

    const session = await repository.resumeSession("raw-session");

    expect(findUnique).toHaveBeenCalledWith({
      where: { sessionIdHash: hashOpaqueToken("raw-session") },
    });
    expect(session?.expiresAt).toBe(absoluteExpiresAt.toISOString());
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain("raw-session");
  });

  it("rejects an expired session without writing", async () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    const updateMany = vi.fn();
    const database = {
      authSession: {
        findUnique: vi.fn().mockResolvedValue({
          accountId: "a".repeat(32),
          idleExpiresAt: now,
          absoluteExpiresAt: new Date("2026-09-01T00:00:00.000Z"),
          revokedAt: null,
        }),
        updateMany,
      },
    } as unknown as PrismaClient;
    const repository = new PrismaAccountRepository(database, () => now);

    await expect(repository.resumeSession("expired-session")).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("revokes sessions by hash", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = { authSession: { updateMany } } as unknown as PrismaClient;
    const repository = new PrismaAccountRepository(database);

    await repository.revokeSession("raw-session");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sessionIdHash: hashOpaqueToken("raw-session") }),
      }),
    );
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain("raw-session");
  });
});
