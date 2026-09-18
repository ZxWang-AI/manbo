import { describe, expect, it } from "vitest";

import { buildCaseDeleteUrl } from "@/components/case/case-detail";

describe("case detail deletion contract", () => {
  it("targets the deletion endpoint that returns a verifiable receipt", () => {
    expect(buildCaseDeleteUrl("case/a"))
      .toBe("/api/cases/case%2Fa/delete");
  });
});
