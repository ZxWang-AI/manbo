import { expect, test } from "@playwright/test";

test("user can explicitly delete a private case and sees a deletion receipt", async ({ page }) => {
  let deleted = false;
  let deleteRequestUrl: string | undefined;
  await page.route("**/api/cases/case-delete", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: deleted ? 404 : 200,
      contentType: "application/json",
      body: JSON.stringify(deleted ? { code: "NOT_FOUND" } : { case: { caseId: "case-delete", lifecycle: "draft", version: 1 } }),
    });
  });
  await page.route("**/api/cases/case-delete/delete", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    deleteRequestUrl = route.request().url();
    deleted = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ receipt: { caseId: "case-delete", status: "queued", targets: ["primary_record", "object_store", "backup_queue"] } }),
    });
  });

  await page.goto("/cases/case-delete");
  await expect(page.getByRole("heading", { name: "案件 case-delete" })).toBeVisible();
  await page.getByRole("button", { name: "删除此案件" }).click();
  await expect(page.getByRole("button", { name: "确认删除案件" })).toBeVisible();
  await page.getByRole("button", { name: "确认删除案件" }).click();
  await expect(page.getByTestId("deletion-receipt")).toContainText("删除请求已受理");
  await expect(page.getByText("案件 case-delete")).toHaveCount(0);
  expect(deleteRequestUrl).toContain("/api/cases/case-delete/delete");
});
