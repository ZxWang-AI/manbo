import { describe, expect, it, vi } from "vitest";

import { createConversationPostHandler } from "@/app/api/conversation/route";
import type { PrismaConversationTurnRepository } from "@/server/repositories/conversation-turn-repository";
import { RetrySourceSuperseded } from "@/server/repositories/message-repository";
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
    const appendAssistantForLatestUser = vi.fn();
    const updatePrivate = vi.fn().mockResolvedValue({ ...record, version: 2 });
    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "opaque-session", expiresAt: "2026-09-02T12:30:00.000Z" }) },
      cases: { getPrivate: async () => record, updatePrivate },
      messages: {
        append,
        appendAssistant,
        appendAssistantForLatestUser,
        findPrivateUser: vi.fn(),
        listPrivate: async () => [],
      },
      isPersistenceAvailable: true,
      providerFactory: () => undefined,
    })(makeRequest({ sessionId: "client-session", caseId: record.caseId, message: "我被扣留护照" }));

    expect(response.status).toBe(200);
    expect(append).toHaveBeenCalledWith(record.accountId, record.caseId, expect.objectContaining({ role: "user" }), expect.any(String));
    expect(appendAssistant).toHaveBeenCalledWith(record.accountId, record.caseId, expect.any(String), expect.any(String));
    expect(appendAssistantForLatestUser).not.toHaveBeenCalled();
    expect(updatePrivate).toHaveBeenCalledWith(record.accountId, record.caseId, expect.any(Object), record.version);
    await expect(response.json()).resolves.toMatchObject({
      persistence: {
        messageSaved: true,
        userMessageCreated: true,
        userMessageId: "00000000-0000-0000-0000-000000000010",
        caseUpdated: true,
      },
      caseVersion: 2,
    });
  });

  it("reuses stored user content for retry without appending another user message", async () => {
    const record = makeCaseRecordFixture();
    const storedUser = {
      messageId: "11111111-1111-4111-8111-111111111120",
      accountId: record.accountId,
      caseId: record.caseId,
      messageSequence: 1,
      role: "user" as const,
      content: "数据库中的原文",
      createdAt: new Date("2026-09-17T00:00:00.000Z"),
    };
    const append = vi.fn();
    const appendAssistant = vi.fn().mockResolvedValue({
      ...storedUser,
      messageId: "11111111-1111-4111-8111-111111111121",
      messageSequence: 2,
      role: "assistant" as const,
      content: "新的回复版本",
    });
    const appendAssistantForLatestUser = vi.fn().mockResolvedValue({
      ...storedUser,
      messageId: "11111111-1111-4111-8111-111111111121",
      messageSequence: 2,
      role: "assistant" as const,
      content: "新的回复版本",
    });
    const updatePrivate = vi.fn().mockResolvedValue({ ...record, version: 2 });
    const provider = {
      detectSafety: vi.fn().mockResolvedValue([]),
      extractFacts: vi.fn().mockResolvedValue({ facts: [], timeline: [], jurisdictionPatch: {} }),
      mapIndicators: vi.fn().mockResolvedValue([]),
      summarizeCoverage: vi.fn().mockResolvedValue([]),
    };
    const providerFactory = vi.fn(() => provider);
    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "opaque-session", expiresAt: "2026-09-18T00:00:00.000Z" }) },
      cases: { getPrivate: async () => record, updatePrivate },
      messages: {
        append,
        appendAssistant,
        appendAssistantForLatestUser,
        findPrivateUser: vi.fn().mockResolvedValue(storedUser),
        listPrivate: async () => [storedUser],
      },
      isPersistenceAvailable: true,
      providerFactory,
    })(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "客户端篡改后的文字",
      retryUserMessageId: storedUser.messageId,
    }));

    expect(response.status).toBe(200);
    expect(append).not.toHaveBeenCalled();
    expect(providerFactory).toHaveBeenCalledWith(storedUser.messageId, storedUser.content);
    expect(provider.detectSafety).toHaveBeenCalledWith(storedUser.content, expect.any(AbortSignal));
    expect(provider.extractFacts).toHaveBeenCalledWith(
      storedUser.content,
      expect.any(Object),
      expect.any(AbortSignal),
    );
    expect(appendAssistant).not.toHaveBeenCalled();
    expect(appendAssistantForLatestUser).toHaveBeenCalledWith(
      record.accountId,
      record.caseId,
      storedUser.messageId,
      expect.any(String),
      expect.any(String),
    );
    await expect(response.json()).resolves.toMatchObject({
      persistence: {
        messageSaved: true,
        userMessageCreated: false,
        userMessageId: storedUser.messageId,
      },
    });
  });

  it("returns a version conflict when the retry source is superseded before assistant persistence", async () => {
    const record = makeCaseRecordFixture();
    const storedUser = {
      messageId: "11111111-1111-4111-8111-111111111140",
      accountId: record.accountId,
      caseId: record.caseId,
      messageSequence: 1,
      role: "user" as const,
      content: "数据库中的原文",
      createdAt: new Date("2026-09-17T00:00:00.000Z"),
    };
    const appendAssistant = vi.fn();
    const appendAssistantForLatestUser = vi.fn().mockRejectedValue(new RetrySourceSuperseded());
    const updatePrivate = vi.fn().mockResolvedValue({ ...record, version: 2 });
    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "opaque-session", expiresAt: "2026-09-18T00:00:00.000Z" }) },
      cases: { getPrivate: async () => record, updatePrivate },
      messages: {
        append: vi.fn(),
        appendAssistant,
        appendAssistantForLatestUser,
        findPrivateUser: vi.fn().mockResolvedValue(storedUser),
        listPrivate: vi.fn().mockResolvedValue([storedUser]),
      },
      isPersistenceAvailable: true,
      providerFactory: () => undefined,
    })(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "客户端文字",
      retryUserMessageId: storedUser.messageId,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "VERSION_CONFLICT",
      message: "案件已出现更新，请刷新后再重试。",
    });
    expect(appendAssistant).not.toHaveBeenCalled();
    expect(appendAssistantForLatestUser).toHaveBeenCalledWith(
      record.accountId,
      record.caseId,
      storedUser.messageId,
      expect.any(String),
      expect.any(String),
    );
  });

  it("rejects a malformed retry id before authentication or persistence", async () => {
    const resumeSession = vi.fn();
    const findPrivateUser = vi.fn();
    const response = await createConversationPostHandler({
      accounts: { resumeSession },
      cases: { getPrivate: vi.fn(), updatePrivate: vi.fn() },
      messages: {
        append: vi.fn(),
        appendAssistant: vi.fn(),
        appendAssistantForLatestUser: vi.fn(),
        findPrivateUser,
        listPrivate: vi.fn(),
      },
      isPersistenceAvailable: true,
      providerFactory: vi.fn(),
    })(makeRequest({
      sessionId: "client-session",
      caseId: "case-a",
      message: "不应被使用",
      retryUserMessageId: "not-a-uuid",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INPUT" });
    expect(resumeSession).not.toHaveBeenCalled();
    expect(findPrivateUser).not.toHaveBeenCalled();
  });

  it("rejects retrying an older user turn before resolving materials or calling AI", async () => {
    const record = makeCaseRecordFixture();
    const olderUser = {
      messageId: "11111111-1111-4111-8111-111111111130",
      accountId: record.accountId,
      caseId: record.caseId,
      messageSequence: 1,
      role: "user" as const,
      content: "较早的原文",
      createdAt: new Date("2026-09-17T00:00:00.000Z"),
    };
    const latestUser = {
      ...olderUser,
      messageId: "11111111-1111-4111-8111-111111111131",
      messageSequence: 2,
      content: "最新的原文",
      createdAt: new Date("2026-09-17T00:01:00.000Z"),
    };
    const append = vi.fn();
    const appendAssistant = vi.fn();
    const updatePrivate = vi.fn();
    const resolveAiContext = vi.fn().mockResolvedValue([]);
    const providerFactory = vi.fn();
    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "opaque-session", expiresAt: "2026-09-18T00:00:00.000Z" }) },
      cases: { getPrivate: async () => record, updatePrivate },
      messages: {
        append,
        appendAssistant,
        appendAssistantForLatestUser: vi.fn(),
        findPrivateUser: vi.fn().mockResolvedValue(olderUser),
        listPrivate: vi.fn().mockResolvedValue([olderUser, latestUser]),
      },
      materials: { resolveAiContext },
      isPersistenceAvailable: true,
      providerFactory,
    })(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "客户端文字",
      retryUserMessageId: olderUser.messageId,
      contentRefs: ["derived/material-a-v1"],
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
    expect(resolveAiContext).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(appendAssistant).not.toHaveBeenCalled();
    expect(updatePrivate).not.toHaveBeenCalled();
  });

  it("rejects an unavailable retry target before AI or any write", async () => {
    const record = makeCaseRecordFixture();
    const append = vi.fn();
    const appendAssistant = vi.fn();
    const updatePrivate = vi.fn();
    const providerFactory = vi.fn(() => undefined);
    const audit = vi.fn();
    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "opaque-session", expiresAt: "2026-09-18T00:00:00.000Z" }) },
      cases: { getPrivate: async () => record, updatePrivate },
      messages: {
        append,
        appendAssistant,
        appendAssistantForLatestUser: vi.fn(),
        findPrivateUser: vi.fn().mockResolvedValue(null),
        listPrivate: vi.fn(),
      },
      isPersistenceAvailable: true,
      providerFactory,
      audit,
    })(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "不应被使用",
      retryUserMessageId: "11111111-1111-4111-8111-111111111199",
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
    expect(append).not.toHaveBeenCalled();
    expect(appendAssistant).not.toHaveBeenCalled();
    expect(updatePrivate).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("does not inspect retry sources or write anything without a valid session", async () => {
    const append = vi.fn();
    const appendAssistant = vi.fn();
    const appendAssistantForLatestUser = vi.fn();
    const findPrivateUser = vi.fn();
    const listPrivate = vi.fn();
    const getPrivate = vi.fn();
    const updatePrivate = vi.fn();
    const providerFactory = vi.fn();
    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => null },
      cases: { getPrivate, updatePrivate },
      messages: {
        append,
        appendAssistant,
        appendAssistantForLatestUser,
        findPrivateUser,
        listPrivate,
      },
      isPersistenceAvailable: true,
      providerFactory,
    })(makeRequest({
      sessionId: "client-session",
      caseId: "case-a",
      message: "不应被使用",
      retryUserMessageId: "11111111-1111-4111-8111-111111111198",
    }, ""));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(getPrivate).not.toHaveBeenCalled();
    expect(findPrivateUser).not.toHaveBeenCalled();
    expect(listPrivate).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(appendAssistant).not.toHaveBeenCalled();
    expect(appendAssistantForLatestUser).not.toHaveBeenCalled();
    expect(updatePrivate).not.toHaveBeenCalled();
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
          messageSequence: 1,
          role: "user" as const,
          content: "普通描述",
          createdAt: new Date("2026-09-03T00:00:00.000Z"),
        }),
        appendAssistant,
        appendAssistantForLatestUser: vi.fn(),
        findPrivateUser: vi.fn(),
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
      messageSequence: 2,
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
          messageSequence: 1,
          role: "user" as const,
          content: "普通描述",
          createdAt: new Date("2026-09-03T00:00:00.000Z"),
        }),
        appendAssistant,
        appendAssistantForLatestUser: vi.fn(),
        findPrivateUser: vi.fn(),
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

describe("conversation turn idempotency contract", () => {
  function baseOptions(
    record: ReturnType<typeof makeCaseRecordFixture>,
    overrides: Partial<Pick<PrismaConversationTurnRepository, "reserve" | "recordResult" | "get" | "markFailure">>,
  ) {
    const turns = {
      reserve: vi.fn(),
      recordResult: vi.fn(),
      get: vi.fn().mockResolvedValue(null),
      markFailure: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    return {
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "opaque-session", expiresAt: "2026-09-18T00:00:00.000Z" }) },
      cases: { getPrivate: async () => record, updatePrivate: vi.fn() },
      messages: {
        append: vi.fn(),
        appendAssistant: vi.fn(),
        appendAssistantForLatestUser: vi.fn(),
        findPrivateUser: vi.fn(),
        listPrivate: vi.fn().mockResolvedValue([]),
      },
      turns,
      finalizer: { finalize: vi.fn() },
      isPersistenceAvailable: true,
      providerFactory: vi.fn(),
    };
  }

  it("requires a persistent turnId when the turn ledger is enabled", async () => {
    const record = makeCaseRecordFixture();
    const options = baseOptions(record, { reserve: vi.fn() });
    const response = await createConversationPostHandler(options)(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "需要稳定幂等键",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "TURN_ID_REQUIRED" });
    expect(options.turns.reserve).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only messages before touching the persistent ledger", async () => {
    const record = makeCaseRecordFixture();
    const options = baseOptions(record, { reserve: vi.fn() });

    const response = await createConversationPostHandler(options)(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: " \u00a0 ",
      turnId: "00000000-0000-4000-8000-000000000010",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INPUT" });
    expect(options.turns.reserve).not.toHaveBeenCalled();
    expect(options.providerFactory).not.toHaveBeenCalled();
  });

  it("uses normalized message and material references for the hash and AI call", async () => {
    const record = makeCaseRecordFixture();
    const userMessageId = "00000000-0000-0000-0000-000000000011";
    const reserve = vi.fn().mockResolvedValue({
      kind: "owner",
      userMessageId,
      turn: { requestHash: "1".repeat(64), baseCaseVersion: record.version },
    });
    const recordResult = vi.fn().mockResolvedValue(undefined);
    const finalizer = vi.fn().mockResolvedValue({
      kind: "completed",
      responseSnapshot: {
        assistant: {
          state: "FACT_GATHERING",
          message: "已整理。",
          questions: [],
          actions: [],
          disclaimerIds: ["ai-assessment"],
          degraded: false,
        },
        caseVersion: 1,
        statusCode: 200,
      },
    });
    const providerFactory = vi.fn(() => ({
      detectSafety: vi.fn().mockResolvedValue([]),
      extractFacts: vi.fn().mockResolvedValue({ facts: [], timeline: [], jurisdictionPatch: {} }),
      mapIndicators: vi.fn().mockResolvedValue([]),
      summarizeCoverage: vi.fn().mockResolvedValue([]),
    }));
    const resolveAiContext = vi.fn().mockResolvedValue([]);
    const options = {
      ...baseOptions(record, { reserve, recordResult }),
      materials: { resolveAiContext },
    };
    options.finalizer.finalize = finalizer;
    options.providerFactory = providerFactory;

    const response = await createConversationPostHandler(options)(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "  e\u0301  ",
      contentRefs: [" ref-b ", "ref-a", "ref-a"],
      turnId: "00000000-0000-4000-8000-000000000010",
    }));

    expect(response.status).toBe(200);
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({
      message: "é",
    }));
    expect(resolveAiContext).toHaveBeenCalledWith(record.accountId, record.caseId, ["ref-a", "ref-b"]);
    expect(providerFactory).toHaveBeenCalledWith(userMessageId, "é");
  });

  it("replays a completed turn without resolving materials, calling AI, or writing", async () => {
    const record = makeCaseRecordFixture();
    const responseSnapshot = {
      assistant: {
        state: "FACT_GATHERING",
        message: "已保存的回复",
        questions: [],
        actions: [],
        disclaimerIds: ["ai-assessment"],
        degraded: false,
      },
      caseVersion: 2,
      persistence: { messageSaved: true, userMessageCreated: true, userMessageId: "user-1", assistantMessageId: "assistant-1", caseUpdated: true },
      statusCode: 200,
    };
    const reserve = vi.fn().mockResolvedValue({ kind: "replay", turn: { responseSnapshot, requestHash: "1".repeat(64) } });
    const providerFactory = vi.fn();
    const options = { ...baseOptions(record, { reserve }), providerFactory };
    const response = await createConversationPostHandler(options)(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "重复请求",
      turnId: "00000000-0000-4000-8000-000000000010",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(responseSnapshot);
    expect(providerFactory).not.toHaveBeenCalled();
    expect(options.messages.append).not.toHaveBeenCalled();
    expect(options.cases.updatePrivate).not.toHaveBeenCalled();
  });

  it("returns 202 for a duplicate in-flight turn", async () => {
    const record = makeCaseRecordFixture();
    const reserve = vi.fn().mockResolvedValue({ kind: "in_flight", turn: { requestHash: "1".repeat(64) } });
    const options = baseOptions(record, { reserve });
    const response = await createConversationPostHandler(options)(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "处理中",
      turnId: "00000000-0000-4000-8000-000000000010",
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ code: "TURN_IN_PROGRESS" });
    expect(options.providerFactory).not.toHaveBeenCalled();
  });

  it("fails closed when a replay snapshot is malformed", async () => {
    const record = makeCaseRecordFixture();
    const reserve = vi.fn().mockResolvedValue({
      kind: "replay",
      turn: { responseSnapshot: { leakedRaw: "不应直接返回" }, requestHash: "1".repeat(64) },
    });
    const options = baseOptions(record, { reserve });

    const response = await createConversationPostHandler(options)(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "重复请求",
      turnId: "00000000-0000-4000-8000-000000000010",
    }));

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('"code":"DEGRADED"');
    expect(body).not.toContain("不应直接返回");
  });

  it("records an AI result before finalization and does not use legacy independent writes", async () => {
    const record = makeCaseRecordFixture();
    const userMessageId = "00000000-0000-4000-8000-000000000011";
    const assistant = {
      state: "FACT_GATHERING" as const,
      message: "已整理本轮事实。",
      questions: [],
      actions: [] as const,
      disclaimerIds: ["ai-assessment"] as const,
      degraded: false,
      draftPatch: { facts: [] },
    };
    const reserve = vi.fn().mockResolvedValue({
      kind: "owner",
      userMessageId,
      turn: { requestHash: "1".repeat(64), baseCaseVersion: record.version },
    });
    const recordResult = vi.fn().mockResolvedValue(undefined);
    const finalizer = vi.fn().mockResolvedValue({
      kind: "completed",
      responseSnapshot: {
        assistant,
        caseVersion: 2,
        persistence: { messageSaved: true, userMessageCreated: true, userMessageId, caseUpdated: true },
        statusCode: 200,
      },
    });
    const providerFactory = vi.fn(() => ({
      detectSafety: vi.fn().mockResolvedValue([]),
      extractFacts: vi.fn().mockResolvedValue({ facts: [], timeline: [], jurisdictionPatch: {} }),
      mapIndicators: vi.fn().mockResolvedValue([]),
      summarizeCoverage: vi.fn().mockResolvedValue([]),
    }));
    const options = baseOptions(record, { reserve, recordResult });
    options.finalizer.finalize = finalizer;
    options.providerFactory = providerFactory;
    options.messages.listPrivate.mockResolvedValue([{
      messageId: userMessageId,
      accountId: record.accountId,
      caseId: record.caseId,
      messageSequence: 1,
      role: "user",
      content: "本轮描述",
      createdAt: new Date("2026-09-18T00:00:00.000Z"),
    }]);

    const response = await createConversationPostHandler(options)(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "本轮描述",
      turnId: "00000000-0000-4000-8000-000000000010",
    }));

    expect(response.status).toBe(200);
    expect(recordResult).toHaveBeenCalledOnce();
    expect(finalizer).toHaveBeenCalledOnce();
    expect(options.messages.append).not.toHaveBeenCalled();
    expect(options.messages.appendAssistant).not.toHaveBeenCalled();
    expect(options.cases.updatePrivate).not.toHaveBeenCalled();
  });

  it("does not include messages appended after this turn was reserved in AI context", async () => {
    const record = makeCaseRecordFixture();
    const currentUserMessageId = "00000000-0000-4000-8000-000000000201";
    const futureUserMessageId = "00000000-0000-4000-8000-000000000202";
    const currentUser = {
      messageId: currentUserMessageId,
      accountId: record.accountId,
      caseId: record.caseId,
      messageSequence: 1,
      role: "user" as const,
      content: "本轮描述",
      createdAt: new Date("2026-09-18T00:00:00.000Z"),
    };
    const futureUser = {
      ...currentUser,
      messageId: futureUserMessageId,
      messageSequence: 2,
      content: "下一轮描述，不应进入本轮上下文",
      createdAt: new Date("2026-09-18T00:00:01.000Z"),
    };
    const provider = {
      detectSafety: vi.fn().mockResolvedValue([]),
      extractFacts: vi.fn().mockResolvedValue({ facts: [], timeline: [], jurisdictionPatch: {} }),
      mapIndicators: vi.fn().mockResolvedValue([]),
      summarizeCoverage: vi.fn().mockResolvedValue([]),
    };
    const reserve = vi.fn().mockResolvedValue({
      kind: "owner",
      userMessageId: currentUserMessageId,
      turn: { requestHash: "1".repeat(64), baseCaseVersion: record.version },
    });
    const recordResult = vi.fn().mockResolvedValue(undefined);
    const finalizer = vi.fn().mockResolvedValue({
      kind: "completed",
      responseSnapshot: {
        assistant: {
          state: "FACT_GATHERING",
          message: "已整理。",
          questions: [],
          actions: [],
          disclaimerIds: ["ai-assessment"],
          degraded: false,
        },
        caseVersion: record.version,
        statusCode: 200,
      },
    });
    const options = baseOptions(record, { reserve, recordResult });
    options.finalizer.finalize = finalizer;
    options.providerFactory = vi.fn(() => provider);
    options.messages.listPrivate.mockResolvedValue([currentUser, futureUser]);

    const response = await createConversationPostHandler(options)(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: currentUser.content,
      turnId: "00000000-0000-4000-8000-000000000203",
    }));

    expect(response.status).toBe(200);
    expect(provider.extractFacts).toHaveBeenCalledWith(
      currentUser.content,
      expect.objectContaining({ sourceMessageIds: [currentUserMessageId] }),
      expect.any(AbortSignal),
    );
  });

  it("marks a provider failure terminal so the same turn cannot remain in-flight forever", async () => {
    const record = makeCaseRecordFixture();
    const turnId = "00000000-0000-4000-8000-000000000099";
    const reserve = vi.fn().mockResolvedValue({
      kind: "owner",
      userMessageId: "00000000-0000-4000-8000-000000000100",
      turn: { requestHash: "1".repeat(64), baseCaseVersion: record.version },
    });
    const markFailure = vi.fn().mockResolvedValue({ status: "failed" });
    const options = baseOptions(record, { reserve, markFailure });
    options.providerFactory = vi.fn(() => ({
      detectSafety: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      extractFacts: vi.fn(),
      mapIndicators: vi.fn(),
      summarizeCoverage: vi.fn(),
    }));

    const response = await createConversationPostHandler(options)(makeRequest({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "服务暂时不可用",
      turnId,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "TURN_FAILED" });
    expect(markFailure).toHaveBeenCalledWith(
      record.accountId,
      record.caseId,
      turnId,
      expect.any(String),
      "failed",
      expect.objectContaining({ code: "TURN_FAILED", statusCode: 503 }),
    );
  });
});
