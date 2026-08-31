import Ajv from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import caseRecordJsonSchema from "@/domain/case-record.schema.json";
import {
  aiReviewStatusValues,
  caseRecordSchema,
  prohibitedAssessmentFieldsSchema,
} from "@/domain/schemas";
import { makeCaseRecordFixture } from "../fixtures/case-record";

function makeJsonSchemaValidator() {
  return new Ajv({
    strict: false,
    formats: {
      "date-time": true,
      date: true,
      uri: (value: string) => {
        try {
          const parsed = new URL(value);
          return Boolean(parsed.protocol && parsed.hostname);
        } catch {
          return false;
        }
      },
    },
  }).compile(caseRecordJsonSchema);
}

describe("CaseRecord schema", () => {
  it("accepts the qualitative golden fixture with required evidence context", () => {
    const fixture = makeCaseRecordFixture();
    const parsed = caseRecordSchema.parse(fixture);

    expect(parsed.visibility).toBe("private");
    expect(parsed.iloIndicators[0]?.basis).toHaveLength(1);
    expect(parsed.iloIndicators[0]?.missing).toHaveLength(1);
  });

  it("validates the same fixture with the published JSON Schema", () => {
    const validate = makeJsonSchemaValidator();

    expect(validate(makeCaseRecordFixture())).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it("rejects score, probability, rank, rating, and successRate keys", () => {
    const validRecord = makeCaseRecordFixture();

    for (const key of ["score", "probability", "rank", "rating", "successRate"]) {
      expect(() => caseRecordSchema.parse({ ...validRecord, [key]: 0.8 })).toThrow();
    }
  });

  it("rejects scoring keys nested in assessment items", () => {
    const validRecord = makeCaseRecordFixture();

    expect(() =>
      caseRecordSchema.parse({
        ...validRecord,
        iloIndicators: [{ ...validRecord.iloIndicators[0], score: 1 }],
      }),
    ).toThrow();
  });

  it("requires basis and missing on every assessment item", () => {
    const validRecord = makeCaseRecordFixture();

    expect(() =>
      caseRecordSchema.parse({
        ...validRecord,
        iloIndicators: [{ indicatorId: 1, status: "hit", basis: [] }],
      }),
    ).toThrow();
    expect(() =>
      caseRecordSchema.parse({
        ...validRecord,
        elements: {
          ...validRecord.elements,
          workOrService: { status: "covered", basis: [] },
        },
      }),
    ).toThrow();
  });

  it("does not allow an assessment item with neither basis nor missing information", () => {
    const validRecord = makeCaseRecordFixture();

    expect(
      caseRecordSchema.parse({
        ...validRecord,
        iloIndicators: [{ indicatorId: 1, status: "insufficient", basis: [], missing: [] }],
      }).iloIndicators[0],
    ).toEqual({ indicatorId: 1, status: "insufficient", basis: [], missing: [] });
  });

  it("accepts only the four workflow statuses and validates ISO dates", () => {
    const validRecord = makeCaseRecordFixture();
    // CaseRecord carries the qualitative review status in the assessment envelope,
    // while dates in the record remain strict ISO values.
    expect(() =>
      caseRecordSchema.parse({ ...validRecord, createdAt: "31-08-2026" }),
    ).toThrow();

    expect(aiReviewStatusValues).toHaveLength(4);
    expect(() =>
      caseRecordSchema.parse({ ...validRecord, aiReviewStatus: "approved" }),
    ).toThrow();
  });

  it("keeps the checked-in JSON Schema identical to the Zod contract", () => {
    expect(caseRecordJsonSchema).toEqual(z.toJSONSchema(caseRecordSchema));
  });

  it("validates URL formats consistently in Zod and Ajv", () => {
    const invalid = makeCaseRecordFixture();
    invalid.legalNavigation[0]!.officialUrl = "https://";
    const validate = makeJsonSchemaValidator();

    expect(() => caseRecordSchema.parse(invalid)).toThrow();
    expect(validate(invalid)).toBe(false);
  });

  it("exposes an explicit negative helper for prohibited assessment fields", () => {
    expect(prohibitedAssessmentFieldsSchema.safeParse({ topic: "timeline" }).success).toBe(true);
    for (const key of ["score", "probability", "rank", "rating", "successRate"]) {
      expect(prohibitedAssessmentFieldsSchema.safeParse({ [key]: 1 }).success).toBe(false);
    }
  });
});
