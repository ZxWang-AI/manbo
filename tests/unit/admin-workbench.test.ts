// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { AdminCasesWorkbench } from "@/components/admin/admin-cases-workbench";
import { AdminCaseReviewWorkbench } from "@/components/admin/admin-case-review";
import { makeCaseRecordFixture } from "../fixtures/case-record";

describe("administrator workbench", () => {
  it("renders a non-tracking review queue without public report language", () => {
    const html = renderToStaticMarkup(createElement(AdminCasesWorkbench, { cases: [{
      caseId: "case-a",
      lifecycle: "draft",
      aiReviewStatus: "needs_more_information",
      updatedAt: "2026-09-02T10:00:00.000Z",
      materialCount: 2,
    }] }));

    expect(html).toContain("管理员审核工作台");
    expect(html).toContain("无需说明查看理由");
    expect(html).toContain("2 份材料");
    expect(html).not.toContain("访问历史");
    expect(html).not.toContain("公开举报");
  });

  it("renders independent review labels and leaves user material submission available", () => {
    const html = renderToStaticMarkup(createElement(AdminCaseReviewWorkbench, { caseView: {
        record: { ...makeCaseRecordFixture(), caseId: "case-a" },
        materials: [{
          materialId: "material-a",
          originalFilename: "contract.pdf",
          declaredBytes: 1_024,
          declaredMime: "application/pdf",
          processingState: "parsed",
          eligibleForAi: true,
          createdAt: "2026-09-02T10:00:00.000Z",
        }],
      } }));

    expect(html).toContain("独立审核标注");
    expect(html).toContain("材料仍可继续补充");
    expect(html).toContain("需继续补充");
    expect(html).toContain("审核不会覆盖用户原始陈述或 AI 初审版本");
    expect(html).toContain("播放");
    expect(html).toContain("下载");
    expect(html).toContain("提交审核标注");
    expect(html).toContain("/api/admin/cases/case-a/materials/material-a?mode=play");
    expect(html).toContain("案件维护");
    expect(html).toContain("软删除案件");
    expect(html).toContain("管理员变更历史");
  });
});
