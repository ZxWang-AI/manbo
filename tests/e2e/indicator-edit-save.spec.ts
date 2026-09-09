import { expect, test } from "@playwright/test";

test("user edits a qualitative indicator and saves the patch with the current case version", async ({ page }) => {
  let patchRequest: { expectedVersion?: number; patch?: { iloIndicators?: Array<{ indicatorId: number; status: string }> } } | undefined;

  await page.route("**/api/accounts", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ alias: "quiet-river-edit", recoverySecret: "one-time-secret" }),
    });
  });
  await page.route("**/api/cases", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ case: { caseId: "case-edit", version: 1 } }),
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
          draftPatch: {
            jurisdiction: {},
            facts: [],
            timeline: [],
            iloIndicators: [{ indicatorId: 6, status: "insufficient", basis: [], missing: ["请核对"] }],
            evidenceCoverage: [],
            legalNavigation: [],
          },
        },
        caseVersion: 2,
      }),
    });
  });
  await page.route("**/api/cases/case-edit", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    patchRequest = route.request().postDataJSON() as typeof patchRequest;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ case: { caseId: "case-edit", version: 3 } }),
    });
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("请整理这段经历");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("heading", { name: "ILO 指标矩阵" })).toBeVisible();

  await page.getByLabel("指标 5状态").selectOption("not_hit");
  await page.getByRole("button", { name: "保存为私密档案" }).click();

  await expect(page.getByText("已保存为私密档案，仅本人可见。", { exact: true })).toBeVisible();
  expect(patchRequest).toMatchObject({
    expectedVersion: 2,
    patch: {
      iloIndicators: [
        { indicatorId: 6, status: "insufficient" },
        { indicatorId: 5, status: "not_hit" },
      ],
    },
  });
});
