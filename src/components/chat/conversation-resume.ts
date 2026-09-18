import type { CasePatch, CaseRecord } from "@/domain/case-record";

export interface ConversationResumeMessage {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  turnId?: string;
}

export interface ConversationResumeTurn {
  turnId: string;
  operation: "send" | "retry";
  status: "reserved" | "processing" | "result_ready" | "completed" | "conflict" | "failed" | "cancelled";
  sourceUserMessageId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  caseVersionAfter: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationInitialData {
  caseId: string;
  caseVersion: number;
  draftPatch: CasePatch;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    persistedMessageId?: string;
    turnId?: string;
  }>;
  turns?: readonly ConversationResumeTurn[];
}

export interface ConversationResumePayload {
  case: CaseRecord;
  messages: readonly ConversationResumeMessage[];
  turns?: readonly ConversationResumeTurn[];
}

function caseToDraftPatch(record: CaseRecord): CasePatch {
  return {
    jurisdiction: record.jurisdiction,
    facts: record.facts,
    timeline: record.timeline,
    iloIndicators: record.iloIndicators,
    elements: record.elements,
    evidenceCoverage: record.evidenceCoverage,
    legalNavigation: record.legalNavigation,
    referrals: record.referrals,
    safetyFlags: record.safetyFlags,
    sourceTrace: record.sourceTrace,
    consent: record.consent,
    lifecycle: record.lifecycle,
    ...(record.aiReviewStatus ? { aiReviewStatus: record.aiReviewStatus } : {}),
  };
}

export function createConversationInitialData(
  payload: ConversationResumePayload,
): ConversationInitialData {
  return {
    caseId: payload.case.caseId,
    caseVersion: payload.case.version,
    draftPatch: caseToDraftPatch(payload.case),
    messages: payload.messages.map((message) => ({
      id: message.messageId,
      role: message.role,
      content: message.content,
      ...(message.role === "user" ? { persistedMessageId: message.messageId } : {}),
      ...(message.turnId ? { turnId: message.turnId } : {}),
    })),
    ...(payload.turns ? { turns: payload.turns } : {}),
  };
}
