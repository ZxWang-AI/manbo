import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("active product documentation", () => {
  it("describes the方案 A persistent private archive instead of the retired session assumption", () => {
    const framework = readFileSync("docs/analysis-framework.md", "utf8");

    expect(framework).toContain("长期私密档案");
    expect(framework).not.toContain("无状态或短期会话");
  });
});
