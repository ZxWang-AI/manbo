import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("home page", () => {
  it("introduces a private preparation workspace without promising public reporting", () => {
    const html = renderToStaticMarkup(HomePage());

    expect(html).toContain("私密举报材料准备工具");
    expect(html).toContain("不会公开发布");
    expect(html).not.toContain("已提交至主管机构");
  });

  it("places the AI identity on the left and the user identity on the right", () => {
    const html = renderToStaticMarkup(HomePage());

    expect(html).toMatch(/data-message-role="assistant"[^>]*>[\s\S]*data-avatar-position="left"/);
    expect(html).toMatch(/data-message-role="user"[^>]*>[\s\S]*data-avatar-position="right"/);
  });
});
