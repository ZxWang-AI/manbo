import { createHash } from "node:crypto";

import { z } from "zod";

import {
  aiReviewStatusValues,
  coverageStatusValues,
  elementStatusValues,
  evidenceTopicValues,
  indicatorStatusValues,
  legalStatusValues,
  safetyFlagValues,
} from "@/domain/assessment";
import { lifecycleStatusValues } from "@/domain/case-record";

/** Operations that can reserve a persistent conversation turn. */
export type TurnOperation = "send" | "retry";

/**
 * The application-level input used to derive a stable request fingerprint.
 * Transport identifiers (session IDs and HTTP request IDs) deliberately do
 * not belong to this type and therefore cannot affect idempotency.
 */
export interface TurnRequestIdentity {
  operation: TurnOperation;
  caseId: string;
  sourceUserMessageId?: string;
  message: string;
  contentRefs: string[];
  baseCaseVersion: number;
}

const MAX_ID_LENGTH = 180;
const MAX_MESSAGE_LENGTH = 10_000;
const MAX_SNAPSHOT_TEXT_LENGTH = 10_000;
const MAX_SHORT_TEXT_LENGTH = 4_096;
const MAX_ARRAY_ITEMS = 128;
const MAX_SOURCE_IDS = 128;

const operationSchema = z.enum(["send", "retry"]);
const snapshotIdSchema = z.string().min(1).max(MAX_ID_LENGTH);
const snapshotTextSchema = z.string().min(1).max(MAX_SNAPSHOT_TEXT_LENGTH);
const shortTextSchema = z.string().min(1).max(MAX_SHORT_TEXT_LENGTH);
const boundedList = <T extends z.ZodType>(schema: T, max = MAX_ARRAY_ITEMS) =>
  z.array(schema).max(max);

/**
 * Normalize text before it participates in an idempotency key. NFC makes
 * canonically equivalent Unicode sequences equal, while trim removes
 * transport-level whitespace that is not part of the authoritative message.
 */
function normalizeIdentityText(value: string): string {
  return value.normalize("NFC").trim();
}

function assertIdentityInput(input: TurnRequestIdentity): void {
  if (!operationSchema.safeParse(input.operation).success) {
    throw new TypeError("turn operation must be send or retry");
  }
  if (typeof input.caseId !== "string" || normalizeIdentityText(input.caseId).length === 0) {
    throw new TypeError("caseId must be a non-empty string");
  }
  const normalizedMessage = typeof input.message === "string" ? normalizeIdentityText(input.message) : "";
  if (normalizedMessage.length === 0 || normalizedMessage.length > MAX_MESSAGE_LENGTH) {
    throw new TypeError("message must be a non-empty string");
  }
  if (!Array.isArray(input.contentRefs)) {
    throw new TypeError("contentRefs must be an array");
  }
  if (input.contentRefs.length > 32) {
    throw new TypeError("contentRefs cannot contain more than 32 references");
  }
  if (!Number.isSafeInteger(input.baseCaseVersion) || input.baseCaseVersion < 1) {
    throw new TypeError("baseCaseVersion must be a positive integer");
  }
  if (input.sourceUserMessageId !== undefined && typeof input.sourceUserMessageId !== "string") {
    throw new TypeError("sourceUserMessageId must be a string when provided");
  }
}

function normalizedContentRefs(contentRefs: readonly string[]): string[] {
  const normalized = contentRefs.map((ref) => {
    if (typeof ref !== "string") throw new TypeError("contentRefs must contain strings");
    return normalizeIdentityText(ref);
  });

  // Empty refs are not authoritative content references. Filtering them here
  // also makes `[]` and `['  ']` equivalent after upstream input validation.
  return [...new Set(normalized.filter((ref) => ref.length > 0))].sort();
}

/**
 * Serialize the only fields that are meaningful to a persistent turn. The
 * property order is explicit so the result is stable across runtimes.
 */
export function canonicalizeTurnIdentity(input: TurnRequestIdentity): string {
  assertIdentityInput(input);
  return JSON.stringify({
    operation: input.operation,
    caseId: normalizeIdentityText(input.caseId),
    sourceUserMessageId: normalizeIdentityText(input.sourceUserMessageId ?? ""),
    message: normalizeIdentityText(input.message),
    contentRefs: normalizedContentRefs(input.contentRefs),
    baseCaseVersion: input.baseCaseVersion,
  });
}

/** Return the lowercase SHA-256 digest of a canonical turn identity. */
export function hashTurnIdentity(input: TurnRequestIdentity): string {
  return createHash("sha256").update(canonicalizeTurnIdentity(input), "utf8").digest("hex");
}

const safeSourceTraceSchema = z.strictObject({
  kind: z.enum(["conversation", "knowledge", "material"]),
  id: snapshotIdSchema,
  quote: shortTextSchema.optional(),
});

const boundedJurisdictionSchema = z.strictObject({
  incidentCountry: shortTextSchema.optional(),
  userCountry: shortTextSchema.optional(),
  productDestination: shortTextSchema.optional(),
});

const boundedFactSchema = z.strictObject({
  id: snapshotIdSchema,
  field: shortTextSchema,
  value: snapshotTextSchema,
  sourceMessageIds: boundedList(snapshotIdSchema, MAX_SOURCE_IDS),
  // This field is a schema-validated, user-confirmed provenance value. It is
  // bounded here; arbitrary raw input fields are still rejected by strict
  // objects and the surrounding snapshot envelope.
  sourceQuote: snapshotTextSchema,
  sourceTrace: boundedList(safeSourceTraceSchema, MAX_SOURCE_IDS).optional(),
  certainty: z.enum(["user_stated", "uncertain"]),
});

const boundedTimelineSchema = z.strictObject({
  id: snapshotIdSchema,
  occurredAt: z.iso.datetime().optional(),
  description: snapshotTextSchema,
  sourceMessageIds: boundedList(snapshotIdSchema, MAX_SOURCE_IDS),
  sourceTrace: boundedList(safeSourceTraceSchema, MAX_SOURCE_IDS).optional(),
});

const boundedIndicatorSchema = z.strictObject({
  indicatorId: z.number().int().min(1).max(11),
  status: z.enum(indicatorStatusValues),
  basis: boundedList(safeSourceTraceSchema, MAX_SOURCE_IDS),
  missing: boundedList(shortTextSchema),
});

const boundedElementItemSchema = z.strictObject({
  status: z.enum(elementStatusValues),
  basis: boundedList(safeSourceTraceSchema, MAX_SOURCE_IDS),
  missing: boundedList(shortTextSchema),
});

const boundedElementsSchema = z.strictObject({
  workOrService: boundedElementItemSchema,
  involuntary: boundedElementItemSchema,
  penaltyOrThreat: boundedElementItemSchema,
});

const boundedEvidenceCoverageSchema = z.strictObject({
  topic: z.enum(evidenceTopicValues),
  status: z.enum(coverageStatusValues),
  explanation: snapshotTextSchema,
  sourceMessageIds: boundedList(snapshotIdSchema, MAX_SOURCE_IDS),
  sourceTrace: boundedList(safeSourceTraceSchema, MAX_SOURCE_IDS).optional(),
  safeOptions: boundedList(shortTextSchema),
});

const boundedLegalNavigationSchema = z.strictObject({
  jurisdiction: shortTextSchema,
  sourceId: snapshotIdSchema,
  status: z.enum(legalStatusValues),
  premise: snapshotTextSchema,
  lastVerified: z.iso.date(),
  stale: z.boolean(),
  officialUrl: z
    .url()
    .and(z.string().regex(/^https:\/\//u, "officialUrl must use HTTPS"))
    .optional(),
});

const boundedReferralSchema = z.strictObject({
  sourceId: snapshotIdSchema,
  name: shortTextSchema,
  officialUrl: z
    .url()
    .and(z.string().regex(/^https:\/\//u, "officialUrl must use HTTPS")),
  anonymity: z.enum(["supported", "not_supported", "unknown"]),
  feedback: z.enum(["expected", "not_expected", "unknown"]),
  userSteps: boundedList(shortTextSchema),
});

const boundedConsentSchema = z.strictObject({
  version: shortTextSchema,
  saveCase: z.boolean(),
  externalSharing: z.boolean(),
  confirmedFieldPaths: boundedList(shortTextSchema),
});

/**
 * A bounded, strict version of the existing CasePatch shape. The domain
 * schemas intentionally remain the source of truth for field meaning; this
 * copy adds snapshot size limits and refuses fields outside that allowlist.
 */
export const boundedCasePatchSchema = z
  .strictObject({
    jurisdiction: boundedJurisdictionSchema,
    facts: boundedList(boundedFactSchema),
    timeline: boundedList(boundedTimelineSchema),
    iloIndicators: boundedList(boundedIndicatorSchema),
    elements: boundedElementsSchema,
    evidenceCoverage: boundedList(boundedEvidenceCoverageSchema),
    legalNavigation: boundedList(boundedLegalNavigationSchema),
    referrals: boundedList(boundedReferralSchema),
    safetyFlags: boundedList(z.enum(safetyFlagValues)),
    sourceTrace: boundedList(safeSourceTraceSchema, MAX_SOURCE_IDS),
    consent: boundedConsentSchema,
    lifecycle: z.enum(lifecycleStatusValues),
    aiReviewStatus: z.enum(aiReviewStatusValues),
  })
  .partial();

export type BoundedCasePatch = z.infer<typeof boundedCasePatchSchema>;

const conversationStateSchema = z.enum([
  "WELCOME",
  "SAFETY_CHECK",
  "JURISDICTION_CONTEXT",
  "FACT_GATHERING",
  "ILO_MAPPING",
  "EVIDENCE_COVERAGE",
  "LEGAL_NAVIGATION",
  "CHANNEL_OPTIONS",
  "USER_REVIEW",
  "SAVE_OR_EXPORT",
  "SAFETY_ESCALATION",
]);

const assistantActionSchema = z.enum(["pause", "skip", "exit", "show_emergency_resources"]);
const disclaimerIdSchema = z.enum(["ai-assessment", "legal-reference", "user-decision"]);

/** Safe, bounded representation of the existing AssistantTurn contract. */
export const assistantTurnSnapshotSchema = z
  .strictObject({
    state: conversationStateSchema,
    message: snapshotTextSchema,
    questions: boundedList(shortTextSchema, 32),
    actions: boundedList(assistantActionSchema, 8),
    disclaimerIds: boundedList(disclaimerIdSchema, 8),
    degraded: z.boolean(),
    draftPatch: boundedCasePatchSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.degraded && value.draftPatch !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["draftPatch"],
        message: "A degraded assistant turn cannot carry a case patch",
      });
    }
  });

export type AssistantTurnSnapshot = z.infer<typeof assistantTurnSnapshotSchema>;

/** Result persisted before finalization; no transport/request identifiers. */
export const turnResultSnapshotSchema = z.strictObject({
  assistant: assistantTurnSnapshotSchema,
});

export type TurnResultSnapshot = z.infer<typeof turnResultSnapshotSchema>;

const persistenceSnapshotSchema = z.strictObject({
  messageSaved: z.boolean().optional(),
  userMessageSaved: z.boolean().optional(),
  assistantMessageSaved: z.boolean().optional(),
  userMessageCreated: z.boolean().optional(),
  userMessageId: snapshotIdSchema.optional(),
  assistantMessageId: snapshotIdSchema.optional(),
  caseUpdated: z.boolean().optional(),
});

const safeErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u, "error code must be uppercase");
const safeErrorSchema = z.strictObject({
  code: safeErrorCodeSchema,
  message: shortTextSchema,
});

/**
 * The replayable HTTP response summary. Every field is explicit so a caller
 * cannot persist request IDs, cookies, raw input, or arbitrary provider JSON.
 */
export const turnResponseSnapshotSchema = z.strictObject({
  assistant: assistantTurnSnapshotSchema.optional(),
  caseVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  persistence: persistenceSnapshotSchema.optional(),
  // These top-level fields make the contract usable by a small finalizer and
  // remain equivalent to the nested persistence summary when both are used.
  userMessageId: snapshotIdSchema.optional(),
  assistantMessageId: snapshotIdSchema.optional(),
  messageSaved: z.boolean().optional(),
  userMessageSaved: z.boolean().optional(),
  assistantMessageSaved: z.boolean().optional(),
  userMessageCreated: z.boolean().optional(),
  caseUpdated: z.boolean().optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  error: safeErrorSchema.optional(),
});

export type TurnResponseSnapshot = z.infer<typeof turnResponseSnapshotSchema>;
