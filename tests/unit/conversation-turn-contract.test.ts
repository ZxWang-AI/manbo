import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalizeTurnIdentity,
  hashTurnIdentity,
  turnResponseSnapshotSchema,
  turnResultSnapshotSchema,
  type TurnRequestIdentity,
} from "@/server/services/conversation-turn-contract";

const baseIdentity: TurnRequestIdentity = {
  operation: "send",
  caseId: "case-1",
  message: "整理这段经历",
  contentRefs: ["derived/b", "derived/a"],
  baseCaseVersion: 3,
};

const assistant = {
  state: "FACT_GATHERING" as const,
  message: "我会把你确认的内容整理成可核对的档案草稿。",
  questions: ["事情大约发生在什么时候？"],
  actions: ["pause" as const],
  disclaimerIds: ["ai-assessment" as const],
  degraded: false,
  draftPatch: {
    jurisdiction: { incidentCountry: "中国" },
    facts: [
      {
        id: "fact-1",
        field: "工作安排",
        value: "被要求继续工作",
        sourceMessageIds: ["message-1"],
        sourceQuote: "用户确认的来源摘录",
        certainty: "user_stated" as const,
      },
    ],
  },
};

describe("conversation turn identity contract", () => {
  it("normalizes Unicode and whitespace, then deduplicates and sorts content refs", () => {
    const canonical = canonicalizeTurnIdentity({
      ...baseIdentity,
      message: "  e\u0301  ",
      contentRefs: [" z ", "a", "z", "e\u0301", "é"],
    });

    expect(canonical).toBe(
      JSON.stringify({
        operation: "send",
        caseId: "case-1",
        sourceUserMessageId: "",
        message: "é",
        contentRefs: ["a", "z", "é"],
        baseCaseVersion: 3,
      }),
    );
  });

  it("does not include session or request identifiers in the fingerprint", () => {
    const withTransportIds = {
      ...baseIdentity,
      sessionId: "session-a",
      requestId: "request-a",
    } as TurnRequestIdentity & { sessionId: string; requestId: string };
    const withOtherTransportIds = {
      ...baseIdentity,
      sessionId: "session-b",
      requestId: "request-b",
    } as TurnRequestIdentity & { sessionId: string; requestId: string };

    expect(canonicalizeTurnIdentity(withTransportIds)).toBe(canonicalizeTurnIdentity(withOtherTransportIds));
    expect(hashTurnIdentity(withTransportIds)).toBe(hashTurnIdentity(withOtherTransportIds));
  });

  it("changes meaningfully for operation, retry source, and base version", () => {
    const retry = { ...baseIdentity, operation: "retry" as const, sourceUserMessageId: "user-1" };
    const otherSource = { ...retry, sourceUserMessageId: "user-2" };
    const otherVersion = { ...retry, baseCaseVersion: 4 };

    expect(new Set([
      hashTurnIdentity(baseIdentity),
      hashTurnIdentity(retry),
      hashTurnIdentity(otherSource),
      hashTurnIdentity(otherVersion),
    ]).size).toBe(4);
  });

  it("uses deterministic SHA-256 over the canonical UTF-8 representation", () => {
    const canonical = canonicalizeTurnIdentity(baseIdentity);
    const expected = createHash("sha256").update(canonical, "utf8").digest("hex");

    expect(hashTurnIdentity(baseIdentity)).toBe(expected);
    expect(hashTurnIdentity(baseIdentity)).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("conversation turn snapshot contract", () => {
  it("accepts a bounded assistant result with a schema-validated CasePatch", () => {
    const parsed = turnResultSnapshotSchema.parse({ assistant });

    expect(parsed.assistant.message).toBe(assistant.message);
    expect(parsed.assistant.draftPatch?.facts?.[0]?.sourceQuote).toBe("用户确认的来源摘录");
  });

  it("accepts degraded results only without a draft patch", () => {
    const parsed = turnResultSnapshotSchema.parse({
      assistant: {
        state: "SAVE_OR_EXPORT",
        message: "AI 服务暂时不可用，本轮内容未写入档案。",
        questions: [],
        actions: ["pause", "exit"],
        disclaimerIds: ["ai-assessment", "legal-reference", "user-decision"],
        degraded: true,
      },
    });

    expect(parsed.assistant.degraded).toBe(true);
    expect(parsed.assistant.draftPatch).toBeUndefined();
  });

  it("rejects unbounded assistant fields and unknown snapshot fields", () => {
    expect(() => turnResultSnapshotSchema.parse({
      assistant: { ...assistant, message: "x".repeat(10_001) },
    })).toThrow();
    expect(() => turnResultSnapshotSchema.parse({
      assistant: { ...assistant, questions: Array.from({ length: 33 }, () => "问题") },
    })).toThrow();
    expect(() => turnResultSnapshotSchema.parse({
      assistant: { ...assistant },
      rawNarrative: "用户原始叙述",
    })).toThrow();
  });

  it("rejects raw transport, material, and token fields", () => {
    for (const field of ["rawNarrative", "materialText", "token", "requestId", "sessionId"]) {
      expect(() => turnResultSnapshotSchema.parse({
        assistant,
        [field]: "must-not-be-stored",
      })).toThrow(field);
    }
  });

  it("parses a replayable success response with stable IDs and persistence booleans", () => {
    const parsed = turnResponseSnapshotSchema.parse({
      assistant,
      caseVersion: 4,
      persistence: {
        messageSaved: true,
        userMessageCreated: true,
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
        caseUpdated: true,
      },
      statusCode: 200,
    });

    expect(parsed.caseVersion).toBe(4);
    expect(parsed.persistence?.assistantMessageId).toBe("assistant-1");
  });

  it("parses a bounded safe error response and rejects arbitrary JSON", () => {
    const parsed = turnResponseSnapshotSchema.parse({
      statusCode: 409,
      error: { code: "VERSION_CONFLICT", message: "案件已被更新，请刷新后重试。" },
    });

    expect(parsed.error?.code).toBe("VERSION_CONFLICT");
    expect(() => turnResponseSnapshotSchema.parse({
      statusCode: 503,
      error: { code: "DEGRADED", message: "稍后重试" },
      requestId: "request-secret",
    })).toThrow();
  });
});
