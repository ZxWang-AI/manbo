// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SavedCasesWorkbench } from "@/components/case/saved-cases-workbench";

describe("saved cases workbench", () => {
  it("shows safe case summaries with a continue link and recovery path", () => {
    const html = renderToStaticMarkup(createElement(SavedCasesWorkbench, { initialCases: [{
      caseId: "case-a",
      lifecycle: "draft",
      version: 2,
      aiReviewStatus: "needs_more_information",
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T01:00:00.000Z",
      materialCount: 1,
    }] }));

    expect(html).toContain("继续对话");
    expect(html).toContain("/cases/case-a/conversation");
    expect(html).toContain("恢复访问");
    expect(html).not.toContain("accountId");
  });
});
