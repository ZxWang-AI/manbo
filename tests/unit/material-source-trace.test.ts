import { describe, expect, it } from "vitest";

import {
  validateEvidenceCoverage,
  validateFactExtraction,
} from "@/ai/output-contract";

const scope = {
  conversationMessageIds: ["message-1"],
  materialContentRefs: ["derived/material-a-v1"],
};

describe("material source traces in structured outputs", () => {
  it("accepts material traces on facts and evidence coverage", () => {
    const factResult = validateFactExtraction({
      facts: [{
        id: "fact-material",
        field: "工资记录",
        value: "工资按月支付",
        sourceMessageIds: [],
        sourceQuote: "工资按月支付",
        sourceTrace: [{
          kind: "material",
          id: "derived/material-a-v1",
          quote: "工资按月支付",
        }],
        certainty: "uncertain",
      }],
      timeline: [],
      jurisdictionPatch: {},
    }, scope);
    const coverageResult = validateEvidenceCoverage([{
      topic: "pay_hours",
      status: "partial",
      explanation: "材料包含部分工资记录。",
      sourceMessageIds: [],
      sourceTrace: [{ kind: "material", id: "derived/material-a-v1" }],
      safeOptions: ["只在安全情况下补充"],
    }], scope);

    expect(factResult.facts[0]?.sourceTrace?.[0]?.id).toBe("derived/material-a-v1");
    expect(coverageResult[0]?.sourceTrace?.[0]?.kind).toBe("material");
  });

  it("rejects a material trace that is not in the server-resolved context", () => {
    expect(() => validateFactExtraction({
      facts: [{
        id: "fact-unknown-material",
        field: "工资记录",
        value: "未知",
        sourceMessageIds: [],
        sourceQuote: "未知",
        sourceTrace: [{ kind: "material", id: "derived/not-selected" }],
        certainty: "uncertain",
      }],
      timeline: [],
      jurisdictionPatch: {},
    }, scope)).toThrow(/unknown material content ref/u);

    expect(() => validateEvidenceCoverage([{
      topic: "supporting_material",
      status: "covered",
      explanation: "未知材料",
      sourceMessageIds: [],
      sourceTrace: [{ kind: "material", id: "derived/not-selected" }],
      safeOptions: ["不适用"],
    }], scope)).toThrow(/unknown material content ref/u);
  });
});
