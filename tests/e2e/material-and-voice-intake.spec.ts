import { expect, test } from "@playwright/test";

test("local material preview is visible but never presented as a saved upload", async ({ page }) => {
  await page.goto("/start");
  await page.getByLabel("添加材料").setInputFiles("tests/fixtures/materials/sample.pdf");
  await expect(page.getByText("本地预览，尚未上传")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  await expect(page.getByText("已保存、尚未读取")).not.toBeVisible();
});

test("a saved material refreshes its safe processing state and can request a retry", async ({ page }) => {
  await page.route("**/api/accounts", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ alias: "quiet-river", recoverySecret: "once-only-secret" }),
    });
  });
  await page.route("**/api/cases", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ case: { caseId: "case-materials", version: 1 } }),
    });
  });
  await page.route("**/api/conversation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assistant: { message: "可以继续补充材料。", actions: [] } }),
    });
  });
  await page.route("**/api/cases/case-materials/materials", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        materials: [{
          materialId: "material-scan-failed",
          originalFilename: "sample.pdf",
          declaredBytes: 27,
          declaredMime: "application/pdf",
          processingState: "scan_failed",
          eligibleForAi: false,
          createdAt: "2026-09-04T00:00:00.000Z",
        }],
      }),
    });
  });
  let retries = 0;
  await page.route("**/api/cases/case-materials/materials/material-scan-failed/process", async (route) => {
    retries += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ processing: { jobId: "job-safe-retry", status: "pending", materialId: "material-scan-failed" } }),
    });
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("先保存案件，再添加材料");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText("扫描未完成，可安全重试")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新处理材料" })).toBeVisible();
  await page.getByRole("button", { name: "重新处理材料" }).click();
  await expect(page.getByText("已请求重新处理")).toBeVisible();
  expect(retries).toBe(1);
});
