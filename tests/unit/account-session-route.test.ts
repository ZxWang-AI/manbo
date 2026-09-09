import { describe, expect, it, vi } from "vitest";

import { RECOVERY_SECRET_WARNING } from "@/server/auth";
import { createAccountRecoveryPostHandler, createAccountRevokeHandler } from "@/app/api/accounts/session/route";

describe("account session lifecycle routes", () => {
  it("recovers a session with alias and recovery secret without exposing account id", async () => {
    const recover = vi.fn().mockResolvedValue({
      accountId: "a".repeat(32),
      sessionId: "opaque-session",
      expiresAt: "2026-09-02T12:30:00.000Z",
    });
    const response = await createAccountRecoveryPostHandler({
      accounts: { recover },
      isPersistenceAvailable: true,
      nodeEnvironment: "test",
    })(new Request("http://localhost/api/accounts/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "Quiet-River-ABCD", recoverySecret: "secret" }),
    }));

    expect(response.status).toBe(200);
    expect(recover).toHaveBeenCalledWith("Quiet-River-ABCD", "secret");
    const body = await response.json();
    expect(body).toEqual({
      message: "会话已恢复。",
      warning: RECOVERY_SECRET_WARNING,
    });
    expect(response.headers.get("set-cookie")).toContain("manbo_session=opaque-session");
    expect(JSON.stringify(body)).not.toContain("accountId");
  });

  it("uses the same 401 response for unknown aliases and wrong secrets", async () => {
    const response = await createAccountRecoveryPostHandler({
      accounts: { recover: async () => null },
      isPersistenceAvailable: true,
      nodeEnvironment: "test",
    })(new Request("http://localhost/api/accounts/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "unknown", recoverySecret: "wrong" }),
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("revokes the opaque session and expires the cookie", async () => {
    const revokeSession = vi.fn().mockResolvedValue(undefined);
    const response = await createAccountRevokeHandler({
      accounts: { revokeSession },
      isPersistenceAvailable: true,
      nodeEnvironment: "test",
    })(new Request("http://localhost/api/accounts/session", {
      method: "DELETE",
      headers: { cookie: "manbo_session=opaque-session" },
    }));

    expect(response.status).toBe(204);
    expect(revokeSession).toHaveBeenCalledWith("opaque-session");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
