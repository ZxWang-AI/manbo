import { describe, expect, it, vi } from "vitest";

import { makeCaseRecordFixture } from "../fixtures/case-record";
import { createConversationBootstrapGetHandler } from "@/app/api/cases/[caseId]/conversation/route";

describe("GET /api/cases/[caseId]/conversation", () => {
  it("returns the owner-bound case and user-visible messages without system messages", async () => {
    const record = makeCaseRecordFixture();
    const listPrivate = vi.fn().mockResolvedValue([
      { messageId: "m-user", role: "user", content: "我想补充经过", createdAt: new Date("2026-09-14T01:00:00.000Z") },
      { messageId: "m-system", role: "system", content: "internal", createdAt: new Date("2026-09-14T01:01:00.000Z") },
      { messageId: "m-ai", role: "assistant", content: "我会整理", createdAt: new Date("2026-09-14T01:02:00.000Z") },
    ]);
    const response = await createConversationBootstrapGetHandler({
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "s", expiresAt: "2026-09-14T02:00:00.000Z" }) },
      cases: { getPrivate: async () => record },
      messages: { listPrivate },
      isPersistenceAvailable: true,
    })(new Request("http://localhost/api/cases/case-test-001/conversation", { headers: { cookie: "manbo_session=s" } }), { params: Promise.resolve({ caseId: record.caseId }) });

    expect(response.status).toBe(200);
    expect(listPrivate).toHaveBeenCalledWith(record.accountId, record.caseId);
    await expect(response.json()).resolves.toEqual({
      case: record,
      messages: [
        { messageId: "m-user", role: "user", content: "我想补充经过", createdAt: "2026-09-14T01:00:00.000Z" },
        { messageId: "m-ai", role: "assistant", content: "我会整理", createdAt: "2026-09-14T01:02:00.000Z" },
      ],
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 and does not load messages for another or missing case", async () => {
    const listPrivate = vi.fn();
    const response = await createConversationBootstrapGetHandler({
      accounts: { resumeSession: async () => ({ accountId: "a".repeat(32), sessionId: "s", expiresAt: "2026-09-14T02:00:00.000Z" }) },
      cases: { getPrivate: async () => null },
      messages: { listPrivate },
      isPersistenceAvailable: true,
    })(new Request("http://localhost/api/cases/case-other/conversation", { headers: { cookie: "manbo_session=s" } }), { params: Promise.resolve({ caseId: "case-other" }) });

    expect(response.status).toBe(404);
    expect(listPrivate).not.toHaveBeenCalled();
  });

  it("returns safe turn status and message associations without request hashes or snapshots", async () => {
    const record = makeCaseRecordFixture();
    const listPrivate = vi.fn().mockResolvedValue([
      { messageId: "m-user", role: "user", content: "补充", turnId: "turn-1", createdAt: new Date("2026-09-14T01:00:00.000Z") },
      { messageId: "m-ai", role: "assistant", content: "已整理", turnId: "turn-1", createdAt: new Date("2026-09-14T01:01:00.000Z") },
    ]);
    const listForCase = vi.fn().mockResolvedValue([{
      turnId: "turn-1",
      operation: "send",
      status: "completed",
      sourceUserMessageId: null,
      userMessageId: "m-user",
      assistantMessageId: "m-ai",
      caseVersionAfter: 2,
      createdAt: new Date("2026-09-14T01:00:00.000Z"),
      updatedAt: new Date("2026-09-14T01:01:00.000Z"),
    }]);
    const response = await createConversationBootstrapGetHandler({
      accounts: { resumeSession: async () => ({ accountId: record.accountId, sessionId: "s", expiresAt: "2026-09-14T02:00:00.000Z" }) },
      cases: { getPrivate: async () => record },
      messages: { listPrivate },
      turns: { listForCase },
      isPersistenceAvailable: true,
    })(new Request("http://localhost/api/cases/case-test-001/conversation", { headers: { cookie: "manbo_session=s" } }), { params: Promise.resolve({ caseId: record.caseId }) });

    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({
      messages: [
        { messageId: "m-user", turnId: "turn-1" },
        { messageId: "m-ai", turnId: "turn-1" },
      ],
      turns: [{ turnId: "turn-1", status: "completed", assistantMessageId: "m-ai" }],
    });
    expect(JSON.stringify(payload)).not.toContain("requestHash");
    expect(JSON.stringify(payload)).not.toContain("resultSnapshot");
  });
});
