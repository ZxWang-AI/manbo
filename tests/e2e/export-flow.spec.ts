import { expect, test } from "@playwright/test";

test("export requires a preview and a separate user confirmation", async ({ page }) => {
  await page.route("**/api/accounts", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ alias: "quiet-river-export", recoverySecret: "one-time-secret" }),
    });
  });
  await page.route("**/api/cases", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ case: { caseId: "case-export" } }),
    });
  });
  await page.route("**/api/conversation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: {
          state: "USER_REVIEW",
          message: "我已整理出一份可核对草稿。",
          questions: [],
          actions: ["pause", "skip", "exit"],
          disclaimerIds: ["ai-assessment", "user-decision"],
          degraded: false,
          draftPatch: {
            jurisdiction: {},
            facts: [{ id: "fact-1", field: "关键事实", value: "用户陈述", sourceMessageIds: ["m-1"], sourceQuote: "用户陈述", certainty: "user_stated" }],
            timeline: [],
            iloIndicators: [],
            evidenceCoverage: [],
            legalNavigation: [],
          },
        },
      }),
    });
  });
  await page.route("**/api/cases/case-export/export", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preview: {
          exportId: "export-1",
          caseId: "case-export",
          connectorId: "markdown",
          caseVersion: 1,
          fieldPaths: ["/facts"],
          consentEventId: "consent-1",
          mediaType: "text/markdown",
          text: "# 用户报告（未经独立核实）",
          disclaimerIds: ["ai-assessment", "user-decision"],
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    });
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("请整理这段经历");
  await page.getByRole("button", { name: "发送" }).click();
  await page.getByRole("button", { name: "保存为私密档案" }).click();
  await page.getByRole("button", { name: "预览导出" }).click();

  await expect(page.getByTestId("export-preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认并生成文件" })).toBeVisible();
  await expect(page.getByTestId("export-confirmed")).toHaveCount(0);
  await page.getByRole("button", { name: "确认并生成文件" }).click();
  await expect(page.getByTestId("export-confirmed")).toBeVisible();
});
