import { describe, expect, it } from "vitest";

import { RECOVERY_SECRET_WARNING } from "@/server/auth";
import type {
  AccountRepository,
  CreatedPseudonymousAccount,
} from "@/server/repositories/account-repository";
import { createAccountPostHandler } from "@/app/api/accounts/route";

function makeCreatedAccount(): CreatedPseudonymousAccount {
  return {
    accountId: "a".repeat(32),
    alias: "quiet-river-abcd",
    recoverySecret: "recovery-secret",
    session: {
      accountId: "a".repeat(32),
      sessionId: "opaque-session",
      expiresAt: "2026-09-02T12:30:00.000Z",
    },
  };
}

describe("POST /api/accounts", () => {
  it("creates a pseudonymous account and sets an opaque session cookie", async () => {
    const created = makeCreatedAccount();
    const repository: AccountRepository = {
      createPseudonymous: async () => created,
      recover: async () => null,
      resumeSession: async () => null,
      revokeSession: async () => undefined,
    };

    const response = await createAccountPostHandler({
      accounts: repository,
      isPersistenceAvailable: true,
      nodeEnvironment: "test",
    })(new Request("http://localhost/api/accounts", { method: "POST" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      alias: created.alias,
      recoverySecret: created.recoverySecret,
      warning: RECOVERY_SECRET_WARNING,
    });
    expect(response.headers.get("set-cookie")).toContain("manbo_session=opaque-session");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed when persistence is unavailable", async () => {
    const repository: AccountRepository = {
      createPseudonymous: async () => {
        throw new Error("must not be called");
      },
      recover: async () => null,
      resumeSession: async () => null,
      revokeSession: async () => undefined,
    };

    const response = await createAccountPostHandler({
      accounts: repository,
      isPersistenceAvailable: false,
      nodeEnvironment: "production",
    })(new Request("http://localhost/api/accounts", { method: "POST" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "DEGRADED",
    });
  });

  it("rejects unexpected request fields", async () => {
    const repository: AccountRepository = {
      createPseudonymous: async () => makeCreatedAccount(),
      recover: async () => null,
      resumeSession: async () => null,
      revokeSession: async () => undefined,
    };

    const response = await createAccountPostHandler({
      accounts: repository,
      isPersistenceAvailable: true,
      nodeEnvironment: "test",
    })(
      new Request("http://localhost/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: "client-selected" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INPUT" });
  });
});
