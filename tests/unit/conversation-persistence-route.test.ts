import { describe, expect, it, vi } from "vitest";

import { createConversationPostHandler } from "@/app/api/conversation/route";
import { makeCaseRecordFixture } from "../fixtures/case-record";

function makeRequest(body: unknown, cookie = "manbo_session=opaque-session") {
  return new Request("http://localhost/api/conversation", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("persistent conversation route", () => {
  it("authenticates, appends both turns, and updates the private case", async () => {
    const record = makeCaseRecordFixture();
    const append = vi.fn().mockResolvedValue({
      messageId: "00000000-0000-0000-0000-000000000010",
      role: "user",
      content: "我被扣留护照",
    });
    const appendAssistant = vi.fn().mockResolvedValue({
      messageId: "00000000-0000-0000-0000-000000000011",
      role: "assistant",
      content: "我已把这轮内容整理为可核对的档案草稿。",
    });
    const updatePrivate = vi.fn().mockResolvedValue({ ...record, version: 2 });
    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "opaque-session", expiresAt: "2026-09-02T12:30:00.000Z" }) },
      cases: { getPrivate: async () => record, updatePrivate },
      messages: { append, appendAssistant, listPrivate: async () => [] },
      isPersistenceAvailable: true,
      providerFactory: () => undefined,
    })(makeRequest({ sessionId: "client-session", caseId: record.caseId, message: "我被扣留护照" }));

    expect(response.status).toBe(200);
    expect(append).toHaveBeenCalledWith(record.accountId, record.caseId, expect.objectContaining({ role: "user" }), expect.any(String));
    expect(appendAssistant).toHaveBeenCalledWith(record.accountId, record.caseId, expect.any(String), expect.any(String));
    expect(updatePrivate).toHaveBeenCalledWith(record.accountId, record.caseId, expect.any(Object), record.version);
    await expect(response.json()).resolves.toMatchObject({
      persistence: { messageSaved: true, caseUpdated: true },
      caseVersion: 2,
    });
  });

  it("does not write anything when a persistent request has no valid session", async () => {
    const append = vi.fn();
    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => null },
      cases: { getPrivate: async () => null, updatePrivate: async () => makeCaseRecordFixture() },
      messages: { append, appendAssistant: vi.fn(), listPrivate: async () => [] },
      isPersistenceAvailable: true,
      providerFactory: () => undefined,
    })(makeRequest({ sessionId: "client-session", caseId: "case-a", message: "普通描述" }, ""));

    expect(response.status).toBe(401);
    expect(append).not.toHaveBeenCalled();
  });

  it("does not persist an assistant turn or case patch after the client cancels", async () => {
    const record = makeCaseRecordFixture();
    const appendAssistant = vi.fn();
    const updatePrivate = vi.fn();
    const audit = vi.fn();
    const controller = new AbortController();
    const responsePromise = createConversationPostHandler({
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "opaque-session", expiresAt: "2026-09-02T12:30:00.000Z" }) },
      cases: { getPrivate: async () => record, updatePrivate },
      messages: {
        append: async () => ({
          messageId: "message-cancelled",
          caseId: record.caseId,
          accountId: record.accountId,
          role: "user" as const,
          content: "普通描述",
          createdAt: new Date("2026-09-03T00:00:00.000Z"),
        }),
        appendAssistant,
        listPrivate: async () => [],
      },
      providerFactory: () => ({
        async detectSafety(_input, signal) {
          await new Promise<void>((_resolve, reject) =>
            signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }),
          );
          return [];
        },
        async extractFacts() { return { facts: [], timeline: [], jurisdictionPatch: {} }; },
        async mapIndicators() { return []; },
        async summarizeCoverage() { return []; },
      }),
      audit,
      isPersistenceAvailable: true,
    })(new Request("http://localhost/api/conversation", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "manbo_session=opaque-session" },
      body: JSON.stringify({ sessionId: "client-session", caseId: record.caseId, message: "普通描述" }),
      signal: controller.signal,
    }));

    controller.abort();
    const response = await responsePromise;

    expect(response.status).toBe(499);
    expect(appendAssistant).not.toHaveBeenCalled();
    expect(updatePrivate).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("does not start a later write when cancellation is observed during an earlier write", async () => {
    const record = makeCaseRecordFixture();
    const controller = new AbortController();
    const appendAssistant = vi.fn().mockResolvedValue({
      messageId: "message-after-fence",
      caseId: record.caseId,
      accountId: record.accountId,
      role: "assistant" as const,
      content: "我已把这轮内容整理为可核对的档案草稿。",
      createdAt: new Date("2026-09-03T00:00:00.000Z"),
    });
    const updatePrivate = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { ...record, version: 2 };
    });

    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "opaque-session", expiresAt: "2026-09-02T12:30:00.000Z" }) },
      cases: { getPrivate: async () => record, updatePrivate },
      messages: {
        append: async () => ({
          messageId: "message-user",
          caseId: record.caseId,
          accountId: record.accountId,
          role: "user" as const,
          content: "普通描述",
          createdAt: new Date("2026-09-03T00:00:00.000Z"),
        }),
        appendAssistant,
        listPrivate: async () => [],
      },
      providerFactory: () => ({
        async detectSafety() { return []; },
        async extractFacts() { return { facts: [], timeline: [], jurisdictionPatch: {} }; },
        async mapIndicators() { return []; },
        async summarizeCoverage() { return []; },
      }),
      isPersistenceAvailable: true,
    })(new Request("http://localhost/api/conversation", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "manbo_session=opaque-session" },
      body: JSON.stringify({ sessionId: "client-session", caseId: record.caseId, message: "普通描述" }),
      signal: controller.signal,
    }));

    expect(response.status).toBe(499);
    expect(updatePrivate).toHaveBeenCalledOnce();
    expect(appendAssistant).not.toHaveBeenCalled();
  });
});
