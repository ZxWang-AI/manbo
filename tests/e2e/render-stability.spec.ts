import { expect, test } from "@playwright/test";

test("conversation workspace does not enter a React update loop on initial render", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/start");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "从你愿意分享的部分开始" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-scroll-behavior", "smooth");

  expect(consoleErrors.filter((message) => message.includes("Maximum update depth exceeded"))).toEqual([]);
});
