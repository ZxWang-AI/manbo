import { expect, test } from "@playwright/test";

test("bootstraps a private case before sending and keeps recovery secret one-time", async ({ page }) => {
  let accountCreates = 0;
  let caseCreates = 0;
  const conversationBodies: Record<string, unknown>[] = [];

  await page.route("**/api/accounts", async (route) => {
    accountCreates += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ alias: "quiet-river-abcd", recoverySecret: "once-only-secret" }),
    });
  });
  await page.route("**/api/cases", async (route) => {
    caseCreates += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ case: { caseId: "case-123" } }),
    });
  });
  await page.route("**/api/conversation", async (route) => {
    conversationBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: {
          message: "我已把这轮内容整理为可核对的档案草稿。",
          draftPatch: {
            facts: [],
            iloIndicators: [],
            evidenceCoverage: [],
          },
        },
      }),
    });
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("我被扣留护照");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByTestId("recovery-secret")).toHaveText("once-only-secret");
  expect(accountCreates).toBe(1);
  expect(caseCreates).toBe(1);
  expect(conversationBodies).toHaveLength(1);
  expect(conversationBodies[0]).toMatchObject({ caseId: "case-123", message: "我被扣留护照" });
  expect(conversationBodies[0]).not.toHaveProperty("recoverySecret");

  await page.getByRole("button", { name: "我已安全保存" }).click();
  await expect(page.getByTestId("recovery-secret")).toHaveCount(0);
  await page.getByRole("button", { name: "保存为私密档案" }).click();
  await expect(page.getByText("已保存为私密档案，仅本人可见。")).toBeVisible();
  expect(accountCreates).toBe(1);
  expect(caseCreates).toBe(1);
});

test("promotes a preview conversation to one private case when saving later succeeds", async ({ page }) => {
  let accountCreates = 0;
  let caseCreates = 0;
  const conversationBodies: Record<string, unknown>[] = [];

  await page.route("**/api/accounts", async (route) => {
    accountCreates += 1;
    if (accountCreates === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "DEGRADED" }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ alias: "quiet-river-abcd", recoverySecret: "promoted-once-only-secret" }),
    });
  });
  await page.route("**/api/cases", async (route) => {
    caseCreates += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ case: { caseId: "case-promoted" } }),
    });
  });
  await page.route("**/api/conversation", async (route) => {
    conversationBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: {
          message: "我已把这轮内容整理为可核对的档案草稿。",
          draftPatch: { facts: [], iloIndicators: [], evidenceCoverage: [] },
        },
      }),
    });
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("第一段经历");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("button", { name: "保存为私密档案" })).toBeVisible();

  await page.getByRole("button", { name: "保存为私密档案" }).click();
  await expect(page.getByTestId("recovery-secret")).toHaveText("promoted-once-only-secret");

  await page.getByRole("textbox", { name: "描述你的经历" }).fill("第二段经历");
  await page.getByRole("button", { name: "发送" }).click();

  expect(accountCreates).toBe(2);
  expect(caseCreates).toBe(1);
  expect(conversationBodies).toHaveLength(2);
  expect(conversationBodies[1]).toMatchObject({ caseId: "case-promoted", message: "第二段经历" });
  expect(conversationBodies[1]).not.toHaveProperty("recoverySecret");
});
