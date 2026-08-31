import { expect, test } from "@playwright/test";

test("shows the private preparation workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "私密举报材料准备工具" })).toBeVisible();
  await expect(page.getByText("不会公开发布", { exact: false })).toBeVisible();
  await expect(page.getByText("未经确认，不会替你对外提交", { exact: false })).toBeVisible();
});
