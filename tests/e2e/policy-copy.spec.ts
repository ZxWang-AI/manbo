import { expect, test } from "@playwright/test";

const prohibitedClaims = [
  /\bscore\b/iu,
  /\bprobability\b/iu,
  /\branking\b/iu,
  /\bblacklist\b/iu,
  /verified company/iu,
  /已提交/u,
  /构成强迫劳动/u,
  /已经违法/u,
  /举报成功率/u,
  /足以证明违法/u,
];

test("public and conversation surfaces do not make prohibited result claims", async ({ page }) => {
  for (const path of ["/", "/start"]) {
    await page.goto(path);
    const copy = await page.locator("body").innerText();
    for (const pattern of prohibitedClaims) {
      expect(copy, `${path} contains ${pattern}`).not.toMatch(pattern);
    }
  }
});
