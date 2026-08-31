import { z } from "zod";

import {
  evidenceCoverageItemSchema,
  indicatorAssessmentSchema,
  safetyFlagSchema,
  sourceTraceSchema,
  type EvidenceCoverageItem,
  type IndicatorAssessment,
  type SafetyFlag,
  type SourceTrace,
} from "@/domain/assessment";
import {
  factItemSchema,
  jurisdictionContextSchema,
  timelineItemSchema,
} from "@/domain/case-record";
import type { FactExtraction } from "@/ai/provider";

const prohibitedFieldName = /^(score|probability|rank|rating|successRate)$/iu;
const prohibitedConclusion =
  /((?:(?:这|该行为|这种做法)?(?:是|就是|属于|涉嫌|构成)|(?:可|可以)认定为)强迫劳动|(?:这|该行为|这种做法)?(?:是|已经)?违法(?:的)?|足以证明违法|举报成功率|(?:is|amounts? to|constitutes?) forced labou?r|is illegal|violates? (?:the )?law)/iu;

const factExtractionSchema = z.strictObject({
  facts: z.array(factItemSchema),
  timeline: z.array(timelineItemSchema),
  jurisdictionPatch: jurisdictionContextSchema.partial(),
});

export interface OutputValidationScope {
  conversationMessageIds: readonly string[];
  knowledgeSourceIds?: readonly string[];
}

function assertNoProhibitedOutput(value: unknown, path = "output"): void {
  if (typeof value === "string") {
    if (prohibitedConclusion.test(value.normalize("NFKC"))) {
      throw new Error(`Provider output contains a prohibited legal conclusion at ${path}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoProhibitedOutput(item, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (prohibitedFieldName.test(key)) {
        throw new Error(`Provider output contains prohibited field ${path}.${key}`);
      }
      assertNoProhibitedOutput(item, `${path}.${key}`);
    }
  }
}

function assertConversationIds(ids: readonly string[], allowed: ReadonlySet<string>): void {
  for (const id of ids) {
    if (!allowed.has(id)) {
      throw new Error(`Provider output references unknown conversation message id: ${id}`);
    }
  }
}

function assertSourceTraces(
  traces: readonly SourceTrace[],
  messageIds: ReadonlySet<string>,
  knowledgeIds: ReadonlySet<string>,
): void {
  for (const trace of traces) {
    if (trace.kind === "conversation" && !messageIds.has(trace.id)) {
      throw new Error(`Provider output references unknown conversation message id: ${trace.id}`);
    }
    if (trace.kind === "knowledge" && !knowledgeIds.has(trace.id)) {
      throw new Error(`Provider output references unknown knowledge source id: ${trace.id}`);
    }
  }
}

function makeScope(scope: OutputValidationScope) {
  return {
    messageIds: new Set(scope.conversationMessageIds),
    knowledgeIds: new Set(scope.knowledgeSourceIds ?? []),
  };
}

export function validateSafetyFlags(value: unknown): SafetyFlag[] {
  assertNoProhibitedOutput(value);
  return z.array(safetyFlagSchema).parse(value);
}

export function validateFactExtraction(
  value: unknown,
  scope: OutputValidationScope,
): FactExtraction {
  assertNoProhibitedOutput(value);
  const parsed = factExtractionSchema.parse(value);
  const { messageIds } = makeScope(scope);

  for (const fact of parsed.facts) {
    assertConversationIds(fact.sourceMessageIds, messageIds);
  }
  for (const item of parsed.timeline) {
    assertConversationIds(item.sourceMessageIds, messageIds);
  }

  return parsed;
}

export function validateIndicatorAssessments(
  value: unknown,
  scope: OutputValidationScope,
): IndicatorAssessment[] {
  assertNoProhibitedOutput(value);
  const parsed = z.array(indicatorAssessmentSchema).min(1).parse(value);
  const { messageIds, knowledgeIds } = makeScope(scope);

  for (const item of parsed) {
    assertSourceTraces(item.basis, messageIds, knowledgeIds);
  }

  return parsed;
}

export function validateEvidenceCoverage(
  value: unknown,
  scope: OutputValidationScope,
): EvidenceCoverageItem[] {
  assertNoProhibitedOutput(value);
  const parsed = z.array(evidenceCoverageItemSchema).min(1).parse(value);
  const { messageIds } = makeScope(scope);

  for (const item of parsed) {
    assertConversationIds(item.sourceMessageIds, messageIds);
  }

  return parsed;
}

export function validateSourceTrace(value: unknown): SourceTrace {
  assertNoProhibitedOutput(value);
  return sourceTraceSchema.parse(value);
}
