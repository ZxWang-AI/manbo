import { describe, expect, it } from "vitest";

import { createConversationOrchestrator } from "@/ai/orchestrator";
import { runAiQualityGates, type AiQualityGateCheck } from "@/ai/quality-gates";
import type {
  AiProvider,
  FactExtraction,
  ModelInputPolicy,
} from "@/ai/provider";
import type { EvidenceCoverageItem, IndicatorAssessment, SafetyFlag } from "@/domain/assessment";
import { makeFactExtraction, makeOrdinarySession } from "../fixtures/ai/session";

class RecordingPolicy implements ModelInputPolicy {
  calls = 0;

  async prepare(input: string) {
    this.calls += 1;
    return { kind: "approved" as const, text: input, basis: "no_hint" as const };
  }
}

class RecordingProvider implements AiProvider {
  calls = 0;

  constructor(
    private readonly results: {
      extraction?: FactExtraction;
      indicators?: IndicatorAssessment[];
    } = {},
  ) {}

  async detectSafety(): Promise<SafetyFlag[]> {
    this.calls += 1;
    return [];
  }

  async extractFacts(): Promise<FactExtraction> {
    this.calls += 1;
    return this.results.extraction ?? makeFactExtraction();
  }

  async mapIndicators(): Promise<IndicatorAssessment[]> {
    this.calls += 1;
    return this.results.indicators ?? [];
  }

  async summarizeCoverage(): Promise<EvidenceCoverageItem[]> {
    this.calls += 1;
    return [];
  }
}

describe("AI quality gates", () => {
  it("fails the aggregate when any internal check fails", () => {
    const checks: AiQualityGateCheck[] = [
      { id: "crisis-precedence", passed: true, evidence: "provider not called" },
      { id: "legal-overclaim", passed: false, evidence: "draft mutation observed" },
    ];

    expect(runAiQualityGates(checks)).toEqual({
      passed: false,
      checks,
    });
  });

  it("keeps crisis input ahead of policy and provider calls", async () => {
    const policy = new RecordingPolicy();
    const provider = new RecordingProvider();
    const turn = await createConversationOrchestrator({ provider, inputPolicy: policy }).handleMessage(
      "They locked me in and I cannot leave safely right now.",
      makeOrdinarySession(),
    );

    expect(turn.state).toBe("SAFETY_ESCALATION");
    expect(turn.actions).toContain("show_emergency_resources");
    expect(policy.calls).toBe(0);
    expect(provider.calls).toBe(0);
  });

  it("degrades without a draft when provider output contains a legal conclusion", async () => {
    const policy = new RecordingPolicy();
    const provider = new RecordingProvider({
      extraction: makeFactExtraction({
        facts: [
          {
            id: "fact-illegal",
            field: "summary",
            value: "这已经违法",
            sourceMessageIds: ["msg-current"],
            sourceQuote: "这已经违法",
            certainty: "user_stated",
          },
        ],
      }),
    });

    const turn = await createConversationOrchestrator({ provider, inputPolicy: policy }).handleMessage(
      "Please organise this account.",
      makeOrdinarySession(),
    );

    expect(turn.degraded).toBe(true);
    expect(turn.draftPatch).toBeUndefined();
  });

  it("degrades without a draft when provider output cites an unknown source", async () => {
    const policy = new RecordingPolicy();
    const provider = new RecordingProvider({
      indicators: [
        {
          indicatorId: 1,
          status: "insufficient",
          basis: [{ kind: "conversation", id: "message-invented" }],
          missing: ["需要更多直接经历描述"],
        },
      ],
    });

    const turn = await createConversationOrchestrator({ provider, inputPolicy: policy }).handleMessage(
      "I want to review the indicators.",
      { ...makeOrdinarySession(), state: "ILO_MAPPING" },
    );

    expect(turn.degraded).toBe(true);
    expect(turn.draftPatch).toBeUndefined();
  });
});
