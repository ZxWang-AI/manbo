// @vitest-environment happy-dom

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
    const template = document.createElement("template");
    template.innerHTML = html;
    const assistant = template.content.querySelector('[data-message-role="assistant"]');
    const user = template.content.querySelector('[data-message-role="user"]');

    expect(assistant?.querySelector('[data-avatar-position="left"]')).not.toBeNull();
    expect(assistant?.firstElementChild?.getAttribute("data-avatar-position")).toBe("left");
    expect(user?.querySelector('[data-avatar-position="right"]')).not.toBeNull();
    expect(user?.lastElementChild?.getAttribute("data-avatar-position")).toBe("right");
  });
});
