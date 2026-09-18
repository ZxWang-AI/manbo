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
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  await page.getByRole("button", { name: "停止生成" }).click();

  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  await expect(page.getByText("先停一下", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "AI 正在整理……" })).toHaveCount(0);
});

test("allows only one first turn while private case bootstrap is pending", async ({ page }) => {
  let accountCalls = 0;
  let caseCalls = 0;
  let conversationCalls = 0;
  await page.route("**/api/accounts", async (route) => {
    accountCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ alias: "quiet-river", recoverySecret: "one-time-secret" }),
    });
  });
  await page.route("**/api/cases", async (route) => {
    caseCalls += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ case: { caseId: "case-single-bootstrap", version: 1 } }),
    });
  });
  await page.route("**/api/conversation", async (route) => {
    conversationCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: "单次回复", actions: [] },
        persistence: {
          messageSaved: true,
          userMessageCreated: true,
          userMessageId: "11111111-1111-4111-8111-111111111140",
          caseUpdated: false,
        },
      }),
    });
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("只发送一次");
  await page.getByRole("button", { name: "发送", exact: true }).dblclick();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(accountCalls).toBe(1);
  await expect(page.getByText("单次回复", { exact: true })).toBeVisible();
  expect(caseCalls).toBe(1);
  expect(conversationCalls).toBe(1);
  await expect(page.getByLabel("对话记录").locator('[data-message-role="user"]')).toHaveCount(1);
});

test("does not show retry on an older assistant after the newest user turn fails", async ({ page }) => {
  let conversationCalls = 0;
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async (route) => {
    conversationCalls += 1;
    if (conversationCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          assistant: { message: "第一轮回复", actions: [] },
          persistence: {
            messageSaved: true,
            userMessageCreated: true,
            userMessageId: "11111111-1111-4111-8111-111111111150",
            caseUpdated: false,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "第二轮失败" }),
    });
  });

  await page.goto("/start");
  const composer = page.getByRole("textbox", { name: "描述你的经历" });
  await composer.fill("第一轮");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("第一轮回复", { exact: true })).toBeVisible();
  await composer.fill("第二轮");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("第二轮失败");

  await expect(page.getByRole("button", { name: "重试", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("对话记录").locator('[data-message-role="user"]')).toHaveCount(2);
});

test("edits a previous user turn and retries the latest assistant turn", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  const storedUserIds = [
    "11111111-1111-4111-8111-111111111101",
    "11111111-1111-4111-8111-111111111102",
  ];
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    const index = requests.length;
    const retryUserMessageId = requests.at(-1)?.retryUserMessageId;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: `回复 ${index}`, actions: [] },
        persistence: {
          messageSaved: true,
          userMessageCreated: !retryUserMessageId,
          userMessageId: retryUserMessageId ?? storedUserIds[index - 1],
          caseUpdated: false,
        },
      }),
    });
  });

  await page.goto("/start");
  const transcript = page.getByLabel("对话记录");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("原始描述");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("回复 1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "编辑并重新发送", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "描述你的经历" })).toHaveValue("原始描述");
  await expect(transcript.getByText("原始描述", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("修订描述");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("回复 2", { exact: true })).toBeVisible();

  const userMessages = transcript.locator('[data-message-role="user"]');
  const assistantMessages = transcript.locator('[data-message-role="assistant"]');
  await expect(userMessages).toHaveCount(2);
  await expect(assistantMessages).toHaveCount(3);
  await expect(page.getByRole("button", { name: "重试", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("回复 3", { exact: true })).toBeVisible();
  await expect(userMessages).toHaveCount(2);
  await expect(assistantMessages).toHaveCount(4);
  await expect(page.getByRole("button", { name: "重试", exact: true })).toHaveCount(1);

  expect(requests.map((request) => request.message)).toEqual(["原始描述", "修订描述", "修订描述"]);
  expect(requests[0]).not.toHaveProperty("retryUserMessageId");
  expect(requests[1]).not.toHaveProperty("retryUserMessageId");
  expect(requests[2]).toMatchObject({ retryUserMessageId: storedUserIds[1] });
});

test("retries a preview turn without duplicating the user message or claiming persistence", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/accounts", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "DEGRADED" }),
    });
  });
  await page.route("**/api/conversation", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: `预览回复 ${requests.length}`, actions: [] },
      }),
    });
  });

  await page.goto("/start");
  const transcript = page.getByLabel("对话记录");
  const userMessages = transcript.locator('[data-message-role="user"]');
  const assistantMessages = transcript.locator('[data-message-role="assistant"]');
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("预览描述");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("预览回复 1", { exact: true })).toBeVisible();
  await expect(userMessages).toHaveCount(1);
  await expect(assistantMessages).toHaveCount(2);

  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("预览回复 2", { exact: true })).toBeVisible();
  await expect(userMessages).toHaveCount(1);
  await expect(assistantMessages).toHaveCount(3);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ message: "预览描述" });
  expect(requests[1]).not.toHaveProperty("caseId");
  expect(requests[1]).not.toHaveProperty("retryUserMessageId");
});

test("fails closed when a persistent user message has no server-issued id", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: "缺少来源编号的回复", actions: [] },
      }),
    });
  });

  await page.goto("/start");
  const transcript = page.getByLabel("对话记录");
  const userMessages = transcript.locator('[data-message-role="user"]');
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("需要安全重试的描述");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("缺少来源编号的回复", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("尚未取得可验证的保存编号");
  await expect(userMessages).toHaveCount(1);
  expect(requests).toHaveLength(1);
});

test("reuses one persistent turnId after a lost/failed response", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  let calls = 0;
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async (route) => {
    calls += 1;
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (calls === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "DEGRADED", message: "稍后重试" }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: "重放成功", actions: [] },
        persistence: { messageSaved: true, userMessageCreated: true, userMessageId: "11111111-1111-4111-8111-111111111180", caseUpdated: false },
      }),
    });
  });

  await page.goto("/start");
  const composer = page.getByRole("textbox", { name: "描述你的经历" });
  await composer.fill("保持同一个轮次");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("稍后重试");
  await composer.fill("保持同一个轮次");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("重放成功", { exact: true })).toBeVisible();

  expect(requests).toHaveLength(2);
  const firstRequest = requests[0];
  const secondRequest = requests[1];
  expect(firstRequest).toBeDefined();
  expect(secondRequest).toBeDefined();
  expect(firstRequest?.turnId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(secondRequest?.turnId).toBe(firstRequest?.turnId);
  await expect(page.getByLabel("对话记录").locator('[data-message-role="user"]')).toHaveCount(1);
});

test("reuses one persistent turnId after an unknown network failure", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (requests.length === 1) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: "网络恢复后重放成功", actions: [] },
        persistence: {
          messageSaved: true,
          userMessageCreated: true,
          userMessageId: "11111111-1111-4111-8111-111111111184",
          caseUpdated: false,
        },
      }),
    });
  });

  await page.goto("/start");
  const composer = page.getByRole("textbox", { name: "描述你的经历" });
  await composer.fill("网络失败后继续");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toBeVisible();
  await composer.fill("网络失败后继续");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("网络恢复后重放成功", { exact: true })).toBeVisible();

  expect(requests).toHaveLength(2);
  expect(requests[0]?.turnId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(requests[1]?.turnId).toBe(requests[0]?.turnId);
  await expect(page.getByLabel("对话记录").locator('[data-message-role="user"]')).toHaveCount(1);
});

test("starts a fresh persistent turn after TURN_FAILED", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (requests.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          statusCode: 503,
          error: { code: "TURN_FAILED", message: "本轮失败" },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: "新轮次成功", actions: [] },
        persistence: {
          messageSaved: true,
          userMessageCreated: true,
          userMessageId: "11111111-1111-4111-8111-111111111181",
          caseUpdated: false,
        },
      }),
    });
  });

  await page.goto("/start");
  const composer = page.getByRole("textbox", { name: "描述你的经历" });
  await composer.fill("失败后开始新轮次");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("本轮失败");
  await composer.fill("失败后开始新轮次");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("新轮次成功", { exact: true })).toBeVisible();

  expect(requests).toHaveLength(2);
  expect(requests[0]?.turnId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(requests[1]?.turnId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(requests[1]?.turnId).not.toBe(requests[0]?.turnId);
  await expect(page.getByLabel("对话记录").locator('[data-message-role="user"]')).toHaveCount(2);
});

test("starts a fresh persistent turn after INVALID_INPUT", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (requests.length === 1) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "INVALID_INPUT", message: "材料状态已变化" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: "修正输入后成功", actions: [] },
        persistence: {
          messageSaved: true,
          userMessageCreated: true,
          userMessageId: "11111111-1111-4111-8111-111111111183",
          caseUpdated: false,
        },
      }),
    });
  });

  await page.goto("/start");
  const composer = page.getByRole("textbox", { name: "描述你的经历" });
  await composer.fill("输入校验失败后重新开始");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("材料状态已变化");
  await composer.fill("输入校验失败后重新开始");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("修正输入后成功", { exact: true })).toBeVisible();

  expect(requests).toHaveLength(2);
  expect(requests[0]?.turnId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(requests[1]?.turnId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(requests[1]?.turnId).not.toBe(requests[0]?.turnId);
});

test("starts a fresh persistent turn after a terminal cancellation response", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (requests.length === 1) {
      await route.fulfill({ status: 499, body: "" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: "取消后重新开始成功", actions: [] },
        persistence: {
          messageSaved: true,
          userMessageCreated: true,
          userMessageId: "11111111-1111-4111-8111-111111111182",
          caseUpdated: false,
        },
      }),
    });
  });

  await page.goto("/start");
  const composer = page.getByRole("textbox", { name: "描述你的经历" });
  await composer.fill("取消后重新开始");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("本轮已取消");
  await composer.fill("取消后重新开始");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("取消后重新开始成功", { exact: true })).toBeVisible();

  expect(requests).toHaveLength(2);
  expect(requests[0]?.turnId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(requests[1]?.turnId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(requests[1]?.turnId).not.toBe(requests[0]?.turnId);
});

test("focuses the composer when the user chooses to continue adding information", async ({ page }) => {
  await installPrivateCaseMocks(page);
  await page.route("**/api/conversation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: "我已整理当前内容。", actions: [] },
        caseDraft: {
          facts: [{
            id: "fact-focus",
            field: "经历",
            value: "用户希望继续补充",
            sourceMessageIds: ["user-1"],
            sourceQuote: "继续补充",
            certainty: "user_stated",
          }],
        },
      }),
    });
  });

  await page.goto("/start");
  const composer = page.getByRole("textbox", { name: "描述你的经历" });
  await composer.fill("先整理一段经历");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("heading", { name: "档案草稿" })).toBeVisible();

  await page.getByRole("button", { name: "继续补充" }).click();
  await expect(composer).toBeFocused();
});

test("shows human-readable source traces for structured material evidence", async ({ page }) => {
  await installPrivateCaseMocks(page);
  await page.route("**/api/cases/case-controls/materials", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        materials: [{
          materialId: "material-pay-slip",
          originalFilename: "pay-slip.pdf",
          declaredBytes: 128,
          declaredMime: "application/pdf",
          processingState: "parsed",
          eligibleForAi: true,
          aiContentRefs: ["derived/pay-slip-v1"],
          createdAt: "2026-09-14T00:00:00.000Z",
        }],
      }),
    });
  });
  await page.route("**/api/conversation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistant: { message: "已整理并保留来源。", actions: [] },
        caseDraft: {
          facts: [{
            id: "fact-material",
            field: "工资记录",
            value: "材料显示按月支付",
            sourceMessageIds: [],
            sourceQuote: "材料显示按月支付",
            sourceTrace: [{ kind: "material", id: "derived/pay-slip-v1" }],
            certainty: "uncertain",
          }],
        },
      }),
    });
  });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "描述你的经历" }).fill("整理工资记录");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("heading", { name: "档案草稿" })).toBeVisible();
  await expect(page.getByText("查看来源（1）")).toBeVisible();
  await page.getByText("查看来源（1）").click();
  await expect(page.getByText("材料：pay-slip.pdf（已安全解析）")).toBeVisible();
  await expect(page.getByText("derived/pay-slip-v1")).toHaveCount(0);
});
