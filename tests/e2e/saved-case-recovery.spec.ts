import { expect, test } from "@playwright/test";

function savedCase() {
  return {
    schemaVersion: "1.0",
    caseId: "case-a",
    accountId: "account-a",
    visibility: "private",
    lifecycle: "draft",
    version: 2,
    jurisdiction: {},
    facts: [],
    timeline: [],
    iloIndicators: [],
    elements: {
      workOrService: { status: "unknown", basis: [], missing: ["待补充"] },
      involuntary: { status: "unknown", basis: [], missing: ["待补充"] },
      penaltyOrThreat: { status: "unknown", basis: [], missing: ["待补充"] },
    },
    evidenceCoverage: [],
    legalNavigation: [],
    referrals: [],
    safetyFlags: [],
    sourceTrace: [],
    consent: { version: "v1", saveCase: true, externalSharing: false, confirmedFieldPaths: [] },
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T01:00:00.000Z",
  };
}

test("owner can open a saved case and continue the persisted conversation", async ({ page }) => {
  await page.route("**/api/cases", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cases: [{
        caseId: "case-a",
        lifecycle: "draft",
        version: 2,
        aiReviewStatus: "needs_more_information",
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T01:00:00.000Z",
        materialCount: 1,
      }] }),
    });
  });
  await page.route("**/api/cases/case-a/conversation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        case: savedCase(),
        messages: [{ messageId: "m-1", role: "user", content: "我想继续补充", createdAt: "2026-09-14T01:00:00.000Z" }],
      }),
    });
  });

  await page.goto("/cases");
  await expect(page.getByText("案件 casea")).toBeVisible();
  await page.getByRole("link", { name: "继续对话" }).click();
  await expect(page).toHaveURL(/\/cases\/case-a\/conversation$/);
  await expect(page.getByText("我想继续补充")).toBeVisible();
  await expect(page.getByText("档案草稿")).toBeVisible();
});

test("recovery form establishes a session and returns to the saved case list", async ({ page }) => {
  await page.route("**/api/accounts/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "会话已恢复。" }),
    });
  });
  await page.route("**/api/cases", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cases: [] }) });
  });

  await page.goto("/recover");
  await page.getByLabel("化名").fill("quiet-river-abcd");
  await page.getByLabel("恢复密钥").fill("secret-once");
  await page.getByRole("button", { name: "恢复访问" }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByText("还没有保存的私密档案。")).toBeVisible();
});
