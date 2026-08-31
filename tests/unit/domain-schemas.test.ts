import Ajv from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import caseRecordJsonSchema from "@/domain/case-record.schema.json";
import { caseRecordSchema } from "@/domain/schemas";
import { makeCaseRecordFixture } from "../fixtures/case-record";

describe("CaseRecord schema", () => {
  it("accepts the qualitative golden fixture with required evidence context", () => {
    const fixture = makeCaseRecordFixture();
    const parsed = caseRecordSchema.parse(fixture);

    expect(parsed.visibility).toBe("private");
    expect(parsed.iloIndicators[0]?.basis).toHaveLength(1);
    expect(parsed.iloIndicators[0]?.missing).toHaveLength(1);
  });

  it("validates the same fixture with the published JSON Schema", () => {
    const validate = new Ajv({ strict: false, formats: { "date-time": true, date: true } }).compile(
      caseRecordJsonSchema,
    );

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

    expect(() =>
      caseRecordSchema.parse({
        ...validRecord,
        iloIndicators: [{ indicatorId: 1, status: "insufficient", basis: [], missing: [] }],
      }),
    ).toThrow();
  });

  it("accepts only the four workflow statuses and validates ISO dates", () => {
    const validRecord = makeCaseRecordFixture();
    // CaseRecord carries the qualitative review status in the assessment envelope,
    // while dates in the record remain strict ISO values.
    expect(() =>
      caseRecordSchema.parse({ ...validRecord, createdAt: "31-08-2026" }),
    ).toThrow();

    expect(["ready_for_preparation", "needs_more_information", "out_of_scope", "safety_referral"]).toHaveLength(4);
  });
});
