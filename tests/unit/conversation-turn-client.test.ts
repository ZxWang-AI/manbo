import { describe, expect, it } from "vitest";

import {
  resolveTurnAttempt,
  shouldRetainPendingTurn,
} from "@/components/chat/conversation-turn-client";

describe("persistent conversation client turn identity", () => {
  it("creates one stable key for a new send and reuses it after a network failure", () => {
    const first = resolveTurnAttempt({ persistent: true, content: "同一段描述" });
    const retry = resolveTurnAttempt({
      persistent: true,
      content: "同一段描述",
      pending: { turnId: first.turnId!, content: "同一段描述" },
    });

    expect(first.turnId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(retry.turnId).toBe(first.turnId);
    expect(retry.reuseUserBubble).toBe(true);
  });

  it("creates a new key for edited content and explicit retry", () => {
    const first = resolveTurnAttempt({ persistent: true, content: "原始描述" });
    const edited = resolveTurnAttempt({
      persistent: true,
      content: "编辑后的描述",
      pending: { turnId: first.turnId!, content: "原始描述" },
    });
    const retry = resolveTurnAttempt({
      persistent: true,
      content: "原始描述",
      retryUserMessageId: "user-1",
      pending: { turnId: first.turnId!, content: "原始描述" },
    });

    expect(edited.turnId).not.toBe(first.turnId);
    expect(edited.reuseUserBubble).toBe(false);
    expect(retry.turnId).not.toBe(first.turnId);
    expect(retry.reuseUserBubble).toBe(false);
  });

  it("does not attach persistent keys to preview requests", () => {
    const result = resolveTurnAttempt({ persistent: false, content: "预览" });
    expect(result.turnId).toBeUndefined();
    expect(result.reuseUserBubble).toBe(false);
  });

  it("starts a new key when selected material references change", () => {
    const first = resolveTurnAttempt({ persistent: true, content: "材料", contentRefs: ["ref-a"] });
    const changed = resolveTurnAttempt({
      persistent: true,
      content: "材料",
      contentRefs: ["ref-b"],
      pending: { turnId: first.turnId!, content: "材料", contentRefs: ["ref-a"] },
    });

    expect(changed.turnId).not.toBe(first.turnId);
    expect(changed.reuseUserBubble).toBe(false);
  });

  it("drops a failed turn after an explicit terminal response", () => {
    expect(shouldRetainPendingTurn({ code: "TURN_FAILED", status: 503 })).toBe(false);
    expect(shouldRetainPendingTurn({ code: "INVALID_INPUT", status: 400 })).toBe(false);
    expect(shouldRetainPendingTurn({ code: "CANCELLED", status: 499 })).toBe(false);
    expect(shouldRetainPendingTurn({ status: 503, error: { code: "TURN_FAILED" } })).toBe(false);
  });

  it("keeps the turn for an in-flight or ambiguous degraded response", () => {
    expect(shouldRetainPendingTurn({ code: "TURN_IN_PROGRESS", status: 202 })).toBe(true);
    expect(shouldRetainPendingTurn({ code: "DEGRADED", status: 503 })).toBe(true);
    expect(shouldRetainPendingTurn({ status: 503 })).toBe(true);
    expect(shouldRetainPendingTurn()).toBe(true);
  });

  it("drops the turn for other terminal request failures", () => {
    expect(shouldRetainPendingTurn({ code: "VERSION_CONFLICT", status: 409 })).toBe(false);
    expect(shouldRetainPendingTurn({ code: "IDEMPOTENCY_CONFLICT", status: 409 })).toBe(false);
    expect(shouldRetainPendingTurn({ code: "TURN_EXPIRED", status: 503 })).toBe(false);
    expect(shouldRetainPendingTurn({ code: "UNAUTHENTICATED", status: 401 })).toBe(false);
    expect(shouldRetainPendingTurn({ code: "NOT_FOUND", status: 404 })).toBe(false);
  });
});
