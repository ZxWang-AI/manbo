import { describe, expect, it } from "vitest";
import { z } from "zod";

import { makeCaseRecordFixture } from "../fixtures/case-record";
import type { AuthSession } from "@/server/repositories/account-repository";
import {
  ConcurrencyConflict,
  type CaseRepository,
} from "@/server/repositories/case-repository";
import { createCasesPostHandler } from "@/app/api/cases/route";
import { createCaseRouteHandlers } from "@/app/api/cases/[caseId]/route";

function session(): AuthSession {
  return {
    accountId: "a".repeat(32),
    sessionId: "opaque-session",
    expiresAt: "2026-09-02T12:30:00.000Z",
  };
}

function request(body: unknown, cookie = "manbo_session=opaque-session") {
  return new Request("http://localhost/api/cases", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
}

function draft() {
  const record = makeCaseRecordFixture();
  const { caseId, accountId, createdAt, updatedAt, deletedAt, version, ...value } = record;
  void caseId;
  void accountId;
  void createdAt;
  void updatedAt;
  void deletedAt;
  void version;
  return value;
}

describe("POST /api/cases", () => {
  it("creates a private draft from the authenticated session", async () => {
    const record = makeCaseRecordFixture();
    const accounts = { resumeSession: async () => session() };
    const cases: Pick<CaseRepository, "createDraft"> = {
      createDraft: async (accountId, value) => {
        expect(accountId).toBe(session().accountId);
        expect(value).toEqual(draft());
        return record;
      },
    };

    const response = await createCasesPostHandler({
      accounts,
      cases,
      isPersistenceAvailable: true,
    })(request({ draft: draft() }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ case: record });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not accept an account id from the request body", async () => {
    const accounts = { resumeSession: async () => session() };
    const cases: Pick<CaseRepository, "createDraft"> = {
      createDraft: async () => {
        throw new Error("must not be called");
      },
    };

    const response = await createCasesPostHandler({
      accounts,
      cases,
      isPersistenceAvailable: true,
    })(request({ accountId: session().accountId, draft: draft() }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("maps a malformed domain draft to INVALID_INPUT", async () => {
    const accounts = { resumeSession: async () => session() };
    const cases: Pick<CaseRepository, "createDraft"> = {
      createDraft: async () => {
        throw new z.ZodError([]);
      },
    };
    const response = await createCasesPostHandler({
      accounts,
      cases,
      isPersistenceAvailable: true,
    })(request({ draft: { lifecycle: "draft" } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns the same unauthenticated error when the cookie is absent or expired", async () => {
    const accounts = { resumeSession: async () => null };
    const cases: Pick<CaseRepository, "createDraft"> = {
      createDraft: async () => {
        throw new Error("must not be called");
      },
    };
    const handler = createCasesPostHandler({
      accounts,
      cases,
      isPersistenceAvailable: true,
    });

    const absent = await handler(request({ draft: draft() }, ""));
    const expired = await handler(request({ draft: draft() }));

    expect(absent.status).toBe(401);
    expect(expired.status).toBe(401);
    await expect(absent.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(expired.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("/api/cases/[caseId]", () => {
  it("maps a stale patch to VERSION_CONFLICT and keeps the request bounded", async () => {
    const accounts = { resumeSession: async () => session() };
    const cases: Pick<CaseRepository, "getPrivate" | "updatePrivate" | "markDeleted"> = {
      getPrivate: async () => null,
      updatePrivate: async () => {
        throw new ConcurrencyConflict();
      },
      markDeleted: async () => undefined,
    };
    const handlers = createCaseRouteHandlers({
      accounts,
      cases,
      isPersistenceAvailable: true,
    });

    const response = await handlers.PATCH(
      new Request("http://localhost/api/cases/case-a", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: "manbo_session=opaque-session",
        },
        body: JSON.stringify({ expectedVersion: 1, patch: { jurisdiction: {} } }),
      }),
      { params: Promise.resolve({ caseId: "case-a" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("returns 404 for a missing or differently owned private case", async () => {
    const accounts = { resumeSession: async () => session() };
    const cases: Pick<CaseRepository, "getPrivate" | "updatePrivate" | "markDeleted"> = {
      getPrivate: async () => null,
      updatePrivate: async () => makeCaseRecordFixture(),
      markDeleted: async () => undefined,
    };
    const handlers = createCaseRouteHandlers({
      accounts,
      cases,
      isPersistenceAvailable: true,
    });

    const response = await handlers.GET(
      new Request("http://localhost/api/cases/case-a", {
        headers: { cookie: "manbo_session=opaque-session" },
      }),
      { params: Promise.resolve({ caseId: "case-a" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
  });
});
