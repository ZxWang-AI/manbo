import { expect, test, type Page } from "@playwright/test";

async function installPrivateCaseMocks(page: Page) {
  await page.route("**/api/accounts", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ alias: "quiet-river", recoverySecret: "one-time-secret" }),
    });
  });
  await page.route("**/api/cases", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ case: { caseId: "case-controls", version: 1 } }),
    });
  });
}

test("stops an in-flight generation request without dropping the user message", async ({ page }) => {
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("先停一下");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page.getByRole("button", { name: "停止生成" }).click();

  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await expect(page.getByText("先停一下", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "AI 正在整理……" })).toHaveCount(0);
});

test("edits a previous user turn and retries the latest assistant turn", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    const index = requests.length;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assistant: { message: `回复 ${index}`, actions: [] } }),
    });
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("原始描述");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("回复 1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "编辑消息" }).first().click();
  await expect(page.getByRole("textbox", { name: "描述你的经历" })).toHaveValue("原始描述");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("修订描述");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("回复 2", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "重试" }).last().click();
  await expect(page.getByText("回复 3", { exact: true })).toBeVisible();

  expect(requests.map((request) => request.message)).toEqual(["原始描述", "修订描述", "修订描述"]);
});
