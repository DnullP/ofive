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
    test("composer should stay bottom-aligned in empty conversation state", async ({ page }) => {
        await waitForAiChatReady(page);

        const panel = page.locator(".ai-chat-panel");
        const welcomeCard = page.locator(".ai-chat-welcome-card");
        const composer = page.locator(".ai-chat-composer");

        await expect(welcomeCard).toBeVisible();
        await expect(composer).toBeVisible();

        const [panelBox, composerBox] = await Promise.all([
            panel.boundingBox(),
            composer.boundingBox(),
        ]);

        if (!panelBox || !composerBox) {
            throw new Error("AI chat panel layout boxes should be measurable in empty state.");
        }

        const panelBottom = panelBox.y + panelBox.height;
        const composerBottom = composerBox.y + composerBox.height;
        expect(Math.abs(panelBottom - composerBottom)).toBeLessThanOrEqual(1);
    });

    test("assistant wikilink should open the target file in a tab section", async ({ page }) => {
        await waitForAiChatReady(page);

        await page.locator(".ai-chat-input").fill("open [[guide]]");
        await page.locator(".ai-chat-send-button").click();

        const wikiLink = page.locator(".ai-chat-message.assistant .ai-chat-message-wikilink", { hasText: "guide" }).first();
        await expect(wikiLink).toBeVisible({ timeout: 3_000 });
        await wikiLink.click();

        await expect(page.locator(".layout-v2-tab-section__tab--focused", { hasText: "guide.md" })).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "guide.md" })).toHaveCount(1);

        await wikiLink.click();
        await expect(page.locator(".layout-v2-tab-section__tab--focused", { hasText: "guide.md" })).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "guide.md" })).toHaveCount(1);
    });

    test("composer should switch model and keep next draft while streaming", async ({ page }) => {
        await waitForAiChatReady(page);

        await expect(page.locator(".ai-chat-header-actions")).toHaveCount(0);
        await expect(page.locator(".ai-chat-tab-strip")).toHaveCount(0);
        await expect(page.locator(".ai-chat-new-button")).toBeVisible();

        const modelButton = page.locator(".ai-chat-model-button");
        await expect(modelButton).toContainText("mock-fast");
        await expect(modelButton).toHaveCSS("border-top-width", "0px");
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
        const initialInputHeight = await input.evaluate((element) => element.getBoundingClientRect().height);
        await input.fill(["line one", "line two", "line three", "line four"].join("\n"));
        const grownInputHeight = await input.evaluate((element) => element.getBoundingClientRect().height);
        expect(grownInputHeight).toBeGreaterThan(initialInputHeight);
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

    test("assistant tool calls should be visible and expandable", async ({ page }) => {
        await waitForAiChatReady(page);

        await page.locator(".ai-chat-input").fill("tool record");
        await page.locator(".ai-chat-send-button").click();

        const toolGroup = page.locator(".ai-chat-tool-call-group", { hasText: "vault.read_markdown_file" }).first();
        await expect(toolGroup).toBeVisible();
        await expect(toolGroup.locator(".ai-chat-tool-call-status").first()).toContainText(/Calling|调用中|Completed|调用完成/);
        await expect(toolGroup.locator(".ai-chat-tool-call-status").first()).toContainText(/Completed|调用完成/, { timeout: 3_000 });
        await expect(toolGroup.locator(".ai-chat-tool-call-count")).toContainText(/2 calls|2 次调用/);

        await toolGroup.locator(".ai-chat-tool-call-summary").click();
        await expect(toolGroup.locator(".ai-chat-tool-call")).toHaveCount(2);
        await expect(toolGroup.locator(".ai-chat-tool-call-detail-block", { hasText: "mock/article.md" })).toBeVisible();
        await expect(toolGroup.locator(".ai-chat-tool-call-detail-block", { hasText: "second mock content" })).toBeVisible();
    });

    test("message actions should copy, retry, and edit from a prior user turn", async ({ page }) => {
        await waitForAiChatReady(page);

        await page.locator(".ai-chat-input").fill("first action prompt");
        await page.locator(".ai-chat-send-button").click();
        const firstAssistant = page.locator(".ai-chat-message.assistant", { hasText: "Mock response for: first action prompt" }).first();
        await expect(firstAssistant.locator(".ai-chat-message-duration")).toBeVisible({ timeout: 3_000 });
        await expect(firstAssistant.locator(".ai-chat-message-action-button")).toHaveCount(2);

        await firstAssistant.locator(".ai-chat-message-action-button").nth(1).click();
        await expect(page.locator(".ai-chat-message.assistant", { hasText: "Mock response for: first action prompt" }).last()).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".ai-chat-message.assistant")).toHaveCount(1);

        const userMessage = page.locator(".ai-chat-message.user", { hasText: "first action prompt" }).first();
        await userMessage.locator(".ai-chat-message-action-button").click();
        const editInput = userMessage.locator(".ai-chat-message-edit-input");
        await expect(editInput).toBeVisible();
        await editInput.fill("edited action prompt");
        await page.locator(".ai-chat-message-edit-form .ai-chat-message-edit-actions .ai-chat-message-action-button").first().click();

        await expect(page.locator(".ai-chat-message.user", { hasText: "edited action prompt" })).toBeVisible();
        await expect(page.locator(".ai-chat-message.user", { hasText: "first action prompt" })).toHaveCount(0);
        await expect(page.locator(".ai-chat-message.assistant", { hasText: "Mock response for: edited action prompt" })).toBeVisible({ timeout: 3_000 });
        await expect(page.locator(".ai-chat-message.assistant")).toHaveCount(1);
    });

    test("approval split menu should persist always-allow operation policy", async ({ page }) => {
        await waitForAiChatReady(page);

        await page.locator(".ai-chat-input").fill("approval menu");
        await page.locator(".ai-chat-send-button").click();

        const confirmation = page.locator(".ai-chat-confirmation-card", { hasText: "vault.apply_markdown_patch" });
        await expect(confirmation).toBeVisible();
        await confirmation.locator(".ai-chat-confirm-button.menu-trigger").hover();
        await confirmation.locator(".ai-chat-confirm-menu-item", { hasText: /Always allow this operation|该操作均允许/ }).click();
        await expect(confirmation).toHaveCount(0);

        await page.getByTestId("activity-bar-item-__settings__").click();
        await page.locator(".settings-tab-search-input").fill("AI");
        await page.locator(".settings-tab-sidebar-item", { hasText: /AI Chat|AI 对话/ }).click();
        const policyRow = page.locator(".ai-chat-settings-tool-policy-row", { hasText: "vault.apply_markdown_patch" });
        await expect(policyRow).toBeVisible();
        await expect(policyRow.locator(".ai-chat-settings-tool-policy-select")).toHaveValue("auto");
    });

    test("settings should add and configure multiple providers", async ({ page }) => {
        await waitForAiChatReady(page);

        await page.getByTestId("activity-bar-item-__settings__").click();
        await page.locator(".settings-tab-search-input").fill("AI");
        await page.locator(".settings-tab-sidebar-item", { hasText: /AI Chat|AI 对话/ }).click();

        const providerList = page.locator(".ai-chat-settings-provider-list");
        await expect(providerList.locator(".ai-chat-settings-provider-item")).toHaveCount(1);

        await page.locator(".ai-chat-settings-provider-actions button", { hasText: /Add provider|添加 provider/ }).click();
        const providerModal = page.locator(".ai-chat-provider-modal");
        await expect(providerModal).toBeVisible();
        await providerModal.locator("input").fill("OpenAI Work");
        await providerModal.locator("select").selectOption("openai-compatible");
        await providerModal.locator("button[type='submit']").click();
        await expect(providerModal).toHaveCount(0);
        await expect(providerList.locator(".ai-chat-settings-provider-item")).toHaveCount(2);
        await expect(providerList.locator(".ai-chat-settings-provider-item.active")).toContainText("OpenAI Work");

        const providerNameRow = page.locator(".ai-chat-settings-row", {
            hasText: /Provider Name|Provider 名称/,
        });
        await providerNameRow.locator("input").fill("OpenAI Work");

        const vendorRow = page.locator(".ai-chat-settings-row", {
            hasText: /Choose the provider type|选择 provider 类型/,
        });
        await vendorRow.locator("select").selectOption("openai-compatible");
        await expect(vendorRow.locator("select")).toHaveValue("openai-compatible");

        await page.locator(".ai-chat-settings-row", { hasText: "API Key" }).locator("input").fill("test-key");
        await page.locator(".ai-chat-settings-row", { hasText: /Base URL/ }).locator("input").fill("http://127.0.0.1:9999/v1");

        const modelRow = page.locator(".ai-chat-settings-row", {
            hasText: /Load vendor-supported models|通过后端按当前 vendor 凭证/,
        });
        await modelRow.locator("input").fill("gpt-4.1-mini");

        await page.locator(".ai-chat-provider-settings-form .ai-chat-settings-save").click();
        await expect(providerList.locator(".ai-chat-settings-provider-item", { hasText: "OpenAI Work" })).toHaveCount(1);
        await expect(providerList.locator(".ai-chat-settings-provider-item.active")).toContainText("OpenAI Work");
        await expect(vendorRow.locator("select")).toHaveValue("openai-compatible");
    });
});
