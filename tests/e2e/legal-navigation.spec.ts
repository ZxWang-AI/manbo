import { expect, test, type Page } from "@playwright/test";

async function stubConversation(page: Page, patch: Record<string, unknown>) {
  await page.route("**/api/accounts", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ alias: "quiet-river-legal", recoverySecret: "one-time-secret" }),
    });
  });
  await page.route("**/api/cases", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ case: { caseId: "case-legal", version: 1 } }),
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
          actions: [],
          disclaimerIds: ["ai-assessment", "user-decision"],
          degraded: false,
          draftPatch: patch,
        },
        caseVersion: 2,
      }),
    });
  });
}

test("does not show specific legal provisions before a jurisdiction is confirmed", async ({ page }) => {
  await stubConversation(page, {
    jurisdiction: {},
    facts: [],
    timeline: [],
    iloIndicators: [],
    evidenceCoverage: [],
    legalNavigation: [{
      jurisdiction: "美国",
      sourceId: "kb-us-criminal",
      status: "needs_review",
      premise: "18 U.S.C. § 1589 可供参考",
      lastVerified: "2026-08-31",
      stale: false,
    }],
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("请整理这段经历");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("确认法域后再显示具体法律来源。", { exact: true })).toBeVisible();
  await expect(page.getByText("18 U.S.C. § 1589 可供参考", { exact: true })).toHaveCount(0);
});

test("shows source date and recheck status for a jurisdiction-scoped legal source", async ({ page }) => {
  await stubConversation(page, {
    jurisdiction: { incidentCountry: "美国" },
    facts: [],
    timeline: [],
    iloIndicators: [],
    evidenceCoverage: [],
    legalNavigation: [{
      jurisdiction: "美国",
      sourceId: "kb-us-criminal",
      status: "needs_review",
      premise: "仅作信息导航，不替代法律意见",
      lastVerified: "2026-08-31",
      stale: true,
    }],
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("请整理这段经历");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("仅作信息导航，不替代法律意见", { exact: true })).toBeVisible();
  await expect(page.getByText("来源：kb-us-criminal · 核实日期：2026-08-31", { exact: true })).toBeVisible();
  await expect(page.getByText("信息可能已过期", { exact: true })).toBeVisible();
});
