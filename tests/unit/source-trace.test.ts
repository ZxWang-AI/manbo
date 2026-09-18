import { describe, expect, it } from "vitest";

import type { CasePatch } from "@/domain/case-record";
import {
  collectCaseSourceTraces,
  describeSourceTrace,
} from "@/components/case-review/source-trace";

describe("human-readable source trace presentation", () => {
  it("collects and de-duplicates traces across structured sections", () => {
    const patch: CasePatch = {
      sourceTrace: [{ kind: "conversation", id: "message-1" }],
      facts: [{
        id: "fact-1",
        field: "工资",
        value: "按月支付",
        sourceMessageIds: [],
        sourceQuote: "按月支付",
        sourceTrace: [{ kind: "material", id: "derived/pay-slip-v1" }],
        certainty: "uncertain",
      }],
      iloIndicators: [{
        indicatorId: 7,
        status: "insufficient",
        basis: [
          { kind: "material", id: "derived/pay-slip-v1" },
          { kind: "knowledge", id: "kb-ilo" },
        ],
        missing: [],
      }],
      evidenceCoverage: [{
        topic: "pay_hours",
        status: "partial",
        explanation: "部分材料",
        sourceMessageIds: [],
        sourceTrace: [{ kind: "conversation", id: "message-1" }],
        safeOptions: ["仅在安全情况下补充"],
      }],
    };

    expect(collectCaseSourceTraces(patch)).toEqual([
      { kind: "conversation", id: "message-1" },
      { kind: "material", id: "derived/pay-slip-v1" },
      { kind: "knowledge", id: "kb-ilo" },
    ]);
  });

  it("uses a friendly material label without exposing its opaque reference", () => {
    const description = describeSourceTrace(
      { kind: "material", id: "derived/pay-slip-v1" },
      new Map([["derived/pay-slip-v1", { name: "pay-slip.pdf", state: "parsed" }]]),
    );

    expect(description).toEqual("材料：pay-slip.pdf（已安全解析）");
    expect(description).not.toContain("derived/pay-slip-v1");
  });
});
