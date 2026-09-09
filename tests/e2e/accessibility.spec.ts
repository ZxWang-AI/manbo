import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("has no critical or serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "私密举报材料准备工具" })).toBeVisible();

  const scan = await new AxeBuilder({ page }).analyze();
  const releaseBlockingViolations = scan.violations.filter(
    ({ impact }) => impact === "critical" || impact === "serious",
  );

  expect(releaseBlockingViolations).toEqual([]);
});

test("conversation workspace has no critical or serious violations", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { name: "从你愿意分享的部分开始" })).toBeVisible();

  const scan = await new AxeBuilder({ page }).analyze();
  const releaseBlockingViolations = scan.violations.filter(
    ({ impact }) => impact === "critical" || impact === "serious",
  );

  expect(releaseBlockingViolations).toEqual([]);
});
