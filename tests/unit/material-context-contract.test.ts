import { describe, expect, it, vi } from "vitest";

import { createConversationPostHandler } from "@/app/api/conversation/route";
import type { ConversationContext } from "@/ai/provider";
import { makeCaseRecordFixture } from "../fixtures/case-record";

function request(body: unknown) {
  return new Request("http://localhost/api/conversation", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "manbo_session=opaque-session" },
    body: JSON.stringify(body),
  });
}

function session(accountId: string) {
  return {
    accountId,
    sessionId: "opaque-session",
    expiresAt: "2026-09-14T00:00:00.000Z",
  };
}

function userMessage(messageId: string, messageSequence = 1) {
  return {
    messageId,
    caseId: "case-a",
    accountId: "a".repeat(32),
    messageSequence,
    role: "user" as const,
    content: "用户消息",
    createdAt: new Date("2026-09-14T00:00:00.000Z"),
  };
}

describe("conversation material context", () => {
  it("resolves server-issued material refs before calling the provider", async () => {
    const record = makeCaseRecordFixture();
    const resolveAiContext = vi.fn().mockResolvedValue([
      {
        contentRef: "derived/material-a-v1",
        materialId: "material-a",
        text: "安全解析出的工资记录",
        sourceSpans: [{ start: 0, end: 8 }],
      },
    ]);
    let receivedContext: ConversationContext | undefined;
    const provider = {
      detectSafety: vi.fn().mockResolvedValue([]),
      extractFacts: vi.fn().mockImplementation(async (_input: string, context: ConversationContext) => {
        receivedContext = context;
        return { facts: [], timeline: [], jurisdictionPatch: {} };
      }),
      mapIndicators: vi.fn().mockResolvedValue([]),
      summarizeCoverage: vi.fn().mockResolvedValue([]),
    };

    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => session(record.accountId) },
      cases: { getPrivate: async () => record, updatePrivate: async () => record },
      messages: {
        append: async () => userMessage("message-user"),
        findPrivateUser: vi.fn(),
        listPrivate: async () => [],
        appendAssistant: async () => ({
          ...userMessage("message-assistant", 2),
          role: "assistant" as const,
        }),
        appendAssistantForLatestUser: vi.fn(),
      },
      materials: { resolveAiContext },
      providerFactory: () => provider,
      isPersistenceAvailable: true,
    })(request({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "请结合已确认材料整理",
      contentRefs: ["derived/material-a-v1"],
    }));

    expect(response.status).toBe(200);
    expect(resolveAiContext).toHaveBeenCalledWith(
      record.accountId,
      record.caseId,
      ["derived/material-a-v1"],
    );
    expect(receivedContext?.materials).toEqual([
      {
        contentRef: "derived/material-a-v1",
        materialId: "material-a",
        text: "安全解析出的工资记录",
        sourceSpans: [{ start: 0, end: 8 }],
      },
    ]);
  });

  it("does not call the provider when a material ref cannot be resolved", async () => {
    const record = makeCaseRecordFixture();
    const provider = {
      detectSafety: vi.fn(),
      extractFacts: vi.fn(),
      mapIndicators: vi.fn(),
      summarizeCoverage: vi.fn(),
    };
    const response = await createConversationPostHandler({
      accounts: { resumeSession: async () => session(record.accountId) },
      cases: { getPrivate: async () => record, updatePrivate: async () => record },
      messages: {
        append: async () => userMessage("message-user"),
        findPrivateUser: vi.fn(),
        listPrivate: async () => [],
        appendAssistant: async () => ({
          ...userMessage("message-assistant", 2),
          role: "assistant" as const,
        }),
        appendAssistantForLatestUser: vi.fn(),
      },
      materials: { resolveAiContext: vi.fn().mockRejectedValue(new Error("MATERIAL_CONTEXT_UNAVAILABLE")) },
      providerFactory: () => provider,
      isPersistenceAvailable: true,
    })(request({
      sessionId: "client-session",
      caseId: record.caseId,
      message: "请结合材料整理",
      contentRefs: ["derived/not-owned"],
    }));

    expect(response.status).toBe(400);
    expect(provider.detectSafety).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INPUT" });
  });
});
