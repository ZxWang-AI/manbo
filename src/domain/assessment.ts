import { z } from "zod";

/** Qualitative statuses used by the ILO and evidence review workflows. */
export const indicatorStatusValues = ["hit", "not_hit", "insufficient"] as const;
export const coverageStatusValues = ["covered", "partial", "gap"] as const;
export const elementStatusValues = ["covered", "partial", "unknown"] as const;
export const legalStatusValues = ["possible", "needs_review", "not_covered"] as const;
export const aiReviewStatusValues = [
  "ready_for_preparation",
  "needs_more_information",
  "out_of_scope",
  "safety_referral",
] as const;
export const safetyFlagValues = ["violence", "confinement", "self_harm", "minor", "trafficking"] as const;

export const indicatorStatusSchema = z.enum(indicatorStatusValues);
export const coverageStatusSchema = z.enum(coverageStatusValues);
export const elementStatusSchema = z.enum(elementStatusValues);
export const legalStatusSchema = z.enum(legalStatusValues);
export const aiReviewStatusSchema = z.enum(aiReviewStatusValues);
export const safetyFlagSchema = z.enum(safetyFlagValues);

export const sourceTraceSchema = z
  .strictObject({
    kind: z.enum(["conversation", "knowledge"]),
    id: z.string().min(1),
    quote: z.string().min(1).optional(),
  });

export const indicatorAssessmentSchema = z.strictObject({
  indicatorId: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
    z.literal(9),
    z.literal(10),
    z.literal(11),
  ]),
  status: indicatorStatusSchema,
  basis: z.array(sourceTraceSchema),
  missing: z.array(z.string().min(1)),
});

export const elementItemSchema = z.strictObject({
  status: elementStatusSchema,
  basis: z.array(sourceTraceSchema),
  missing: z.array(z.string().min(1)),
});

/** Negative-test helper; it accepts unrelated keys but explicitly forbids scoring keys. */
export const prohibitedAssessmentFieldsSchema = z
  .object({
    score: z.never().optional(),
    probability: z.never().optional(),
    rank: z.never().optional(),
    rating: z.never().optional(),
    successRate: z.never().optional(),
  })
  .passthrough();

export const elementAssessmentSchema = z.strictObject({
  workOrService: elementItemSchema,
  involuntary: elementItemSchema,
  penaltyOrThreat: elementItemSchema,
});

export const evidenceTopicValues = [
  "entity_facility",
  "timeline",
  "work_relationship",
  "coercive_conduct",
  "pay_hours",
  "product_flow",
  "supporting_material",
] as const;

export const evidenceCoverageItemSchema = z.strictObject({
  topic: z.enum(evidenceTopicValues),
  status: coverageStatusSchema,
  explanation: z.string().min(1),
  sourceMessageIds: z.array(z.string().min(1)),
  safeOptions: z.array(z.string().min(1)),
});

export const legalNavigationItemSchema = z.strictObject({
  jurisdiction: z.string().min(1),
  sourceId: z.string().min(1),
  status: legalStatusSchema,
  premise: z.string().min(1),
  lastVerified: z.iso.date(),
  stale: z.boolean(),
  officialUrl: z
    .url()
    .and(z.string().regex(/^https:\/\//, "officialUrl must use HTTPS"))
    .optional(),
});

export const referralOptionSchema = z.strictObject({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  officialUrl: z
    .url()
    .and(z.string().regex(/^https:\/\//, "officialUrl must use HTTPS")),
  anonymity: z.enum(["supported", "not_supported", "unknown"]),
  feedback: z.enum(["expected", "not_expected", "unknown"]),
  userSteps: z.array(z.string().min(1)),
});

export type IndicatorStatus = z.infer<typeof indicatorStatusSchema>;
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;
export type ElementStatus = z.infer<typeof elementStatusSchema>;
export type LegalStatus = z.infer<typeof legalStatusSchema>;
export type AiReviewStatus = z.infer<typeof aiReviewStatusSchema>;
export type SafetyFlag = z.infer<typeof safetyFlagSchema>;
export type SourceTrace = z.infer<typeof sourceTraceSchema>;
export type IndicatorAssessment = z.infer<typeof indicatorAssessmentSchema>;
export type ElementItem = z.infer<typeof elementItemSchema>;
export type ElementAssessment = z.infer<typeof elementAssessmentSchema>;
export type EvidenceCoverageItem = z.infer<typeof evidenceCoverageItemSchema>;
export type LegalNavigationItem = z.infer<typeof legalNavigationItemSchema>;
export type ReferralOption = z.infer<typeof referralOptionSchema>;
