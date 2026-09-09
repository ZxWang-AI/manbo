import { expect, test } from "@playwright/test";

test("crisis language stops normal intake and exposes static safety resources", async ({ page }) => {
  await page.route("**/api/accounts", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ alias: "quiet-river-crisis", recoverySecret: "one-time-secret" }),
    });
  });
  await page.route("**/api/cases", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ case: { caseId: "case-crisis" } }),
    });
  });
  await page.route("**/api/conversation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: {
          state: "SAFETY_ESCALATION",
          message: "你的安全比继续整理材料更重要。",
          questions: [],
          actions: ["show_emergency_resources", "pause", "exit"],
          disclaimerIds: ["ai-assessment", "user-decision"],
          degraded: false,
        },
      }),
    });
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("我被锁起来，不能离开工作地点");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByTestId("emergency-resources")).toBeVisible();
  await expect(page.getByText("不要为了取证让自己暴露风险。", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "暂停对话" })).toBeVisible();
  await expect(page.getByRole("button", { name: "退出对话" })).toBeVisible();
  await expect(page.getByText("ILO 指标矩阵")).toHaveCount(0);
});
