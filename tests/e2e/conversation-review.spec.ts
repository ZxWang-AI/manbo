import { expect, test } from "@playwright/test";

test("user can converse, review indicators, and save privately", async ({ page }) => {
  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("工厂要求我长期加班，工资记录也不完整");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("ILO 指标矩阵")).toBeVisible();
  await expect(page.getByText("用户报告，未经独立核实")).toBeVisible();
  await page.getByRole("button", { name: "保存为私密档案" }).click();
  await expect(page.getByText("仅本人可见").last()).toBeVisible();
});
