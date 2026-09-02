import type {
  EvidenceCoverageItem,
  IndicatorAssessment,
  SafetyFlag,
} from "@/domain/assessment";
import type {
  CaseDraft,
  CasePatch,
  FactItem,
  JurisdictionContext,
  TimelineItem,
} from "@/domain/case-record";

export type ConversationState =
  | "WELCOME"
  | "SAFETY_CHECK"
  | "JURISDICTION_CONTEXT"
  | "FACT_GATHERING"
  | "ILO_MAPPING"
  | "EVIDENCE_COVERAGE"
  | "LEGAL_NAVIGATION"
  | "CHANNEL_OPTIONS"
  | "USER_REVIEW"
  | "SAVE_OR_EXPORT"
  | "SAFETY_ESCALATION";

export interface ConversationContext {
  jurisdiction: JurisdictionContext;
  facts: FactItem[];
  timeline: TimelineItem[];
  sourceMessageIds: string[];
}

export interface FactExtraction {
  facts: FactItem[];
  timeline: TimelineItem[];
  jurisdictionPatch: Partial<JurisdictionContext>;
}

export interface ConversationSession {
  sessionId: string;
  state: ConversationState;
  context: ConversationContext;
  draft?: CaseDraft;
}

export interface AssistantTurn {
  state: ConversationState;
  message: string;
  questions: string[];
  actions: Array<"pause" | "skip" | "exit" | "show_emergency_resources">;
  disclaimerIds: Array<"ai-assessment" | "legal-reference" | "user-decision">;
  degraded: boolean;
  draftPatch?: CasePatch;
}

export interface AiProvider {
  detectSafety(input: string): Promise<SafetyFlag[]>;
  extractFacts(input: string, context: ConversationContext): Promise<FactExtraction>;
  mapIndicators(
    input: string,
    context: ConversationContext,
  ): Promise<IndicatorAssessment[]>;
  summarizeCoverage(
    input: string,
    context: ConversationContext,
  ): Promise<EvidenceCoverageItem[]>;
}

export type GatewayOperation =
  | "detect_safety"
  | "extract_facts"
  | "map_indicators"
  | "summarize_coverage";

export interface GatewayTurnRequest {
  requestId: string;
  operation: GatewayOperation;
  schemaVersion: "1.0";
  locale: string;
  input: string;
  context: ConversationContext;
}

export interface GatewayTurnResponse {
  requestId: string;
  output: unknown;
}

export type ModelInputDecision =
  | { kind: "approved"; text: string; basis: "no_hint" | "redacted" | "user_confirmed" }
  | { kind: "confirmation_required"; hintIds: string[] };

export interface ModelInputPolicy {
  prepare(input: string): Promise<ModelInputDecision>;
}

export interface ConversationOrchestrator {
  handleMessage(input: string, session: ConversationSession): Promise<AssistantTurn>;
}

export class ModelInputConfirmationRequired extends Error {
  readonly hintIds: string[];

  constructor(hintIds: string[]) {
    super("Model input requires explicit user confirmation");
    this.name = "ModelInputConfirmationRequired";
    this.hintIds = [...hintIds];
  }
}
