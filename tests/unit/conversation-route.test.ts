import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/conversation/route";
import { createConversationPostHandler } from "@/app/api/conversation/route";

describe("conversation route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns a structured assistant turn without scoring fields", async () => {
    const response = await POST(
      new Request("http://localhost/api/conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "test-session", message: "我被扣留护照，无法自由离开工作地点" }),
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("assistant");
    expect(serialized).not.toMatch(/score|probability|rank|rating|successRate/iu);
  });

  it("rejects oversized messages before processing", async () => {
    const response = await POST(
      new Request("http://localhost/api/conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "test-session", message: "a".repeat(10_001) }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("fails closed in production until persistent services are connected", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_MODE", "normal");

    const response = await POST(
      new Request("http://localhost/api/conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "prod-session", message: "普通描述" }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "DEGRADED" });
  });

  it("does not expose a malformed gateway credential in the configuration response", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_MODE", "normal");
    vi.stubEnv("DATABASE_URL", "postgresql://manbo:test@127.0.0.1:55432/manbo");
    vi.stubEnv("SESSION_SECRET", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("AI_PROVIDER", "gateway");
    vi.stubEnv("AI_GATEWAY_URL", "https://gateway.example.test");
    vi.stubEnv("AI_GATEWAY_TOKEN", "short-test-token");
    vi.stubEnv("AI_MODEL_ALIAS", "review-model");
    vi.stubEnv("AI_REGION", "cn");
    vi.stubEnv("AI_RETENTION_POLICY_ID", "reviewed:no-training");

    const response = await POST(
      new Request("http://localhost/api/conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "prod-session", message: "普通描述" }),
      }),
    );

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("对话服务尚未完成安全配置");
    expect(body).not.toContain("short-test-token");
  });

  it("records a content-free model fallback when the AI turn degrades", async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const response = await createConversationPostHandler({
      accounts: { resumeSession: vi.fn().mockResolvedValue({ accountId: "acct-a" }) },
      cases: { getPrivate: vi.fn().mockResolvedValue({ caseId: "case-a", accountId: "acct-a", jurisdiction: {}, facts: [], timeline: [], version: 1 }) as never, updatePrivate: vi.fn() },
      messages: {
        append: vi.fn().mockResolvedValue({ messageId: "message-a" }),
        listPrivate: vi.fn().mockResolvedValue([]),
        appendAssistant: vi.fn(),
      },
      providerFactory: () => ({
        detectSafety: vi.fn().mockRejectedValue(new Error("gateway down")),
        extractFacts: vi.fn(), mapIndicators: vi.fn(), summarizeCoverage: vi.fn(),
      }),
      audit,
      isPersistenceAvailable: true,
    })(new Request("http://localhost/api/conversation", {
      method: "POST", headers: { "content-type": "application/json", cookie: "manbo_session=session-a" },
      body: JSON.stringify({ sessionId: "session-a", caseId: "case-a", message: "普通描述" }),
    }));

    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "model_fallback", accountId: "acct-a", caseId: "case-a", metadata: expect.objectContaining({ reasonCode: "AI_DEGRADED" }) }));
  });

  it("returns 499 when a static conversation is cancelled", async () => {
    const controller = new AbortController();
    const responsePromise = createConversationPostHandler({
      accounts: { resumeSession: vi.fn() },
      cases: { getPrivate: vi.fn(), updatePrivate: vi.fn() },
      messages: { append: vi.fn(), listPrivate: vi.fn(), appendAssistant: vi.fn() },
      providerFactory: () => ({
        detectSafety: async (_input, signal) => {
          await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
          return [];
        },
        extractFacts: async () => ({ facts: [], timeline: [], jurisdictionPatch: {} }),
        mapIndicators: async () => [],
        summarizeCoverage: async () => [],
      }),
      isPersistenceAvailable: false,
    })(new Request("http://localhost/api/conversation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "static-session", message: "普通描述" }),
      signal: controller.signal,
    }));

    controller.abort();
    const response = await responsePromise;

    expect(response.status).toBe(499);
  });
});
