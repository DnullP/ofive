/**
 * @module e2e/ai-chat-ux.e2e
 * @description AI Chat 前端交互回归：覆盖 composer 模型切换、流式期间继续输入、生成完成后发送下一条。
 * @dependencies
 *   - @playwright/test
 *   - web-mock/mock-tauri-test.html
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";

async function waitForAiChatReady(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await page.locator(".ai-chat-panel").waitFor({ state: "visible" });
    await expect(page.locator(".ai-chat-input")).toBeEnabled();
    await expect(page.locator(".ai-chat-model-option", { hasText: "mock-deep" })).toHaveCount(0);
}

test.describe("ai chat ux", () => {
    test("composer should switch model and keep next draft while streaming", async ({ page }) => {
        await waitForAiChatReady(page);

        const modelButton = page.locator(".ai-chat-model-button");
        await expect(modelButton).toContainText("mock-fast");
        await expect(page.locator(".ai-chat-composer-hint")).toHaveCount(0);
        await modelButton.click();

        const modelMenu = page.locator(".ai-chat-model-menu");
        await expect(modelMenu).toBeVisible();
        await expect(modelMenu.locator(".ai-chat-model-menu-status")).toHaveCount(0);
        await expect(modelMenu).toHaveCSS("background-color", /rgb\(.+\)/);
        await expect(modelMenu.locator("select")).toHaveCount(0);
        await expect(modelMenu.locator("input")).toHaveCount(0);
        await expect(modelMenu).not.toContainText(/Browser Mock|MiniMax|Baidu|模型供应商|Model Vendor/);
        await modelMenu.locator(".ai-chat-model-option", { hasText: "mock-deep" }).click();
        await expect(modelMenu).toHaveCount(0);
        await expect(modelButton).toContainText("mock-deep");

        const input = page.locator(".ai-chat-input");
        await input.fill("first prompt");
        await page.locator(".ai-chat-send-button").click();
        await expect(page.locator(".ai-chat-send-button")).toContainText(/Stop|终止/);

        await input.fill("second prompt");
        await expect(input).toHaveValue("second prompt");
        await expect(page.locator(".ai-chat-composer-hint")).toContainText(/Next message ready|下一条已准备/);

        await expect(page.locator(".ai-chat-send-button")).toContainText(/Send|发送/, { timeout: 3_000 });
        await expect(page.locator(".ai-chat-message.assistant .ai-chat-message-duration").first()).toBeVisible();

        await page.locator(".ai-chat-send-button").click();
        await expect(page.locator(".ai-chat-message.user", { hasText: "second prompt" })).toBeVisible();
    });
});
