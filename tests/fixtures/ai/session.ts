import type {
  ConversationContext,
  ConversationSession,
  FactExtraction,
} from "@/ai/provider";

export function makeConversationContext(): ConversationContext {
  return {
    jurisdiction: {},
    facts: [],
    timeline: [],
    sourceMessageIds: ["msg-current"],
  };
}

export function makeOrdinarySession(): ConversationSession {
  return {
    sessionId: "session-test-001",
    state: "FACT_GATHERING",
    context: makeConversationContext(),
  };
}

export function makeFactExtraction(
  overrides: Partial<FactExtraction> = {},
): FactExtraction {
  return {
    facts: [
      {
        id: "fact-test-001",
        field: "working_hours",
        value: "用户表示被要求长期加班。",
        sourceMessageIds: ["msg-current"],
        sourceQuote: "我被要求长期加班",
        certainty: "user_stated",
      },
    ],
    timeline: [],
    jurisdictionPatch: {},
    ...overrides,
  };
}
