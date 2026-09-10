import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("active product documentation", () => {
  it("describes the方案 A persistent private archive instead of the retired session assumption", () => {
    const framework = readFileSync("docs/analysis-framework.md", "utf8");

    expect(framework).toContain("长期私密档案");
    expect(framework).not.toContain("无状态或短期会话");
  });

  it("keeps the unconfigured Vercel deployment manual and documents the active deployment boundary", () => {
    const workflow = readFileSync(".github/workflows/deploy-vercel.yml", "utf8");
    const deployment = readFileSync("docs/deployment.md", "utf8");
    const readme = readFileSync("README.md", "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+push:\s*$/m);
    expect(deployment).toContain("Vercel 是可选的手动部署流程");
    expect(deployment).toContain("当前没有配置自动部署目标");
    expect(readme).toContain("合并到 `main` 会自动运行 CI，但当前不会自动部署");
  });
});
