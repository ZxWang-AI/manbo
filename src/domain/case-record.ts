import { z } from "zod";

import {
  aiReviewStatusSchema,
  elementAssessmentSchema,
  evidenceCoverageItemSchema,
  indicatorAssessmentSchema,
  legalNavigationItemSchema,
  referralOptionSchema,
  safetyFlagSchema,
  sourceTraceSchema,
} from "./assessment";
import { consentSnapshotSchema } from "./consent";

export const lifecycleStatusValues = ["draft", "confirmed", "exported", "deleted"] as const;
export const lifecycleStatusSchema = z.enum(lifecycleStatusValues);

export const jurisdictionContextSchema = z.strictObject({
  incidentCountry: z.string().min(1).optional(),
  userCountry: z.string().min(1).optional(),
  productDestination: z.string().min(1).optional(),
});

export const factItemSchema = z.strictObject({
  id: z.string().min(1),
  field: z.string().min(1),
  value: z.string().min(1),
  sourceMessageIds: z.array(z.string().min(1)),
  sourceQuote: z.string().min(1),
  certainty: z.enum(["user_stated", "uncertain"]),
});

export const timelineItemSchema = z.strictObject({
  id: z.string().min(1),
  occurredAt: z.iso.datetime().optional(),
  description: z.string().min(1),
  sourceMessageIds: z.array(z.string().min(1)),
});

export const caseRecordSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  caseId: z.string().min(1),
  accountId: z.string().min(1),
  visibility: z.literal("private"),
  lifecycle: lifecycleStatusSchema,
  version: z.number().int().positive(),
  jurisdiction: jurisdictionContextSchema,
  facts: z.array(factItemSchema),
  timeline: z.array(timelineItemSchema),
  iloIndicators: z.array(indicatorAssessmentSchema),
  elements: elementAssessmentSchema,
  evidenceCoverage: z.array(evidenceCoverageItemSchema),
  legalNavigation: z.array(legalNavigationItemSchema),
  referrals: z.array(referralOptionSchema),
  safetyFlags: z.array(safetyFlagSchema),
  sourceTrace: z.array(sourceTraceSchema),
  consent: consentSnapshotSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().optional(),
  /** Latest workflow hint is optional for records created before AI review. */
  aiReviewStatus: aiReviewStatusSchema.optional(),
});

export type LifecycleStatus = z.infer<typeof lifecycleStatusSchema>;
export type JurisdictionContext = z.infer<typeof jurisdictionContextSchema>;
export type FactItem = z.infer<typeof factItemSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type CaseRecord = z.infer<typeof caseRecordSchema>;
export type CaseDraft = Omit<
  CaseRecord,
  "caseId" | "accountId" | "createdAt" | "updatedAt" | "deletedAt" | "version"
>;
export type CasePatch = Partial<
  Pick<
    CaseRecord,
    | "jurisdiction"
    | "facts"
    | "timeline"
    | "iloIndicators"
    | "elements"
    | "evidenceCoverage"
    | "legalNavigation"
    | "referrals"
    | "safetyFlags"
    | "sourceTrace"
    | "consent"
    | "lifecycle"
    | "aiReviewStatus"
  >
>;
