from playwright.sync_api import sync_playwright


def test_manbo_workspace_renders_core_workflow():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto("http://127.0.0.1:63370/", wait_until="networkidle")

        assert page.title() == "慢波 Manbo · AI-Native 举报档案工作台"
        assert page.get_by_text("把叙述变成可核对的档案").is_visible()
        assert page.get_by_text("需继续补充").is_visible()
        assert page.get_by_text("单文件 100 MB · 单案件 2 GB").is_visible()

        ai_avatar = page.locator(".message").nth(0).locator(".avatar").bounding_box()
        ai_bubble = page.locator(".message").nth(0).locator(".bubble").bounding_box()
        user_avatar = page.locator(".message").nth(1).locator(".avatar").bounding_box()
        user_bubble = page.locator(".message").nth(1).locator(".bubble").bounding_box()
        assert ai_avatar is not None and ai_bubble is not None
        assert user_avatar is not None and user_bubble is not None
        assert ai_avatar["x"] < ai_bubble["x"], "AI avatar must stay left of its reply"
        assert user_avatar["x"] > user_bubble["x"], "User avatar must appear right of the message"

        composer = page.get_by_placeholder("描述你经历的事情，或补充一份材料…")
        composer.fill("我想补充一段时间线")
        page.get_by_role("button", name="发送").click()
        assert page.get_by_text("我想补充一段时间线").is_visible()
        sent_message = page.locator(".message.user-message").last
        sent_avatar = sent_message.locator(".avatar").bounding_box()
        sent_bubble = sent_message.locator(".bubble").bounding_box()
        assert sent_avatar is not None and sent_bubble is not None
        assert sent_avatar["x"] > sent_bubble["x"]

        browser.close()


if __name__ == "__main__":
    test_manbo_workspace_renders_core_workflow()
