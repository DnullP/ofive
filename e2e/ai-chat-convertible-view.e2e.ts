/**
 * @module e2e/ai-chat-convertible-view
 * @description AI chat 可转化视图 E2E 回归测试。
 *
 * 覆盖场景：
 * 1. 从右侧 activity icon 打开 AI chat tab
 * 2. 将 AI chat tab 拖到右侧 sidebar，转为 pane
 * 3. 将 AI chat pane 拖回主区域，转回 tab
 *
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/dockviewDrag
 *   - ./helpers/mockVault
 */

import { expect, test, type Page } from "@playwright/test";
import { dockviewDragPanel } from "./helpers/dockviewDrag";
import { gotoMockVaultPage } from "./helpers/mockVault";

const AI_CHAT_TITLE_PATTERN = /AI\s*(Chat|对话)/;

/**
 * @function waitForLayoutReady
 * @description 等待主布局与侧栏进入可拖拽状态。
 * @param page Playwright 页面对象。
 * @returns Promise<void>
 */
async function waitForLayoutReady(page: Page): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await page.locator(".dv-tab").first().waitFor({ state: "visible" });
    await page.locator(".dv-pane-header").first().waitFor({ state: "visible" });
}

test.describe("AI chat pane/tab 转换", () => {
    test("ai chat tab 可拖到右侧 sidebar 并可拖回主区域", async ({ page }) => {
        await gotoMockVaultPage(page, "ai-chat-pane-back-to-tab");
        await waitForLayoutReady(page);

        await page.getByTestId("right-activity-icon-ai-chat").click();

        const aiChatTab = page.locator(".dv-tab", { hasText: AI_CHAT_TITLE_PATTERN });
        await expect(aiChatTab).toBeVisible();

        const rightSidebar = page.locator("[aria-label='Right Extension Panel']");
        const sidebarDropTarget = rightSidebar.locator(".dv-pane-header", {
            hasText: /Backlinks|反向链接/,
        });
        await dockviewDragPanel(page, aiChatTab, sidebarDropTarget);

        const aiChatPaneHeader = rightSidebar.locator(".dv-pane-header", {
            hasText: AI_CHAT_TITLE_PATTERN,
        });
        await expect(aiChatPaneHeader).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: AI_CHAT_TITLE_PATTERN })).toHaveCount(0);

        const dockviewContent = page.locator("[aria-label='Dockview Main Area'] .dv-content-container");
        await dockviewDragPanel(page, aiChatPaneHeader, dockviewContent, { x: 0.82, y: 0.5 });

        await expect(page.locator(".dv-tab", { hasText: AI_CHAT_TITLE_PATTERN })).toBeVisible();
        await expect(aiChatPaneHeader).toHaveCount(0);
    });

    test("ai chat activity icon 在 panel 模式下仍应打开 tab 而不是切到空右侧栏", async ({ page }) => {
        await gotoMockVaultPage(page, "ai-chat-panel-icon-behavior");
        await waitForLayoutReady(page);

        const aiChatIcon = page.getByTestId("right-activity-icon-ai-chat");
        await aiChatIcon.click();

        const aiChatTab = page.locator(".dv-tab", { hasText: AI_CHAT_TITLE_PATTERN });
        await expect(aiChatTab).toBeVisible();

        const rightSidebar = page.locator("[aria-label='Right Extension Panel']");
        const sidebarDropTarget = rightSidebar.locator(".dv-pane-header", {
            hasText: /Backlinks|反向链接/,
        });
        await dockviewDragPanel(page, aiChatTab, sidebarDropTarget);

        await expect(rightSidebar.locator(".dv-pane-header", {
            hasText: AI_CHAT_TITLE_PATTERN,
        })).toBeVisible();
        await expect(aiChatTab).toHaveCount(0);

        await aiChatIcon.click();

        await expect(page.locator(".dv-tab", { hasText: AI_CHAT_TITLE_PATTERN })).toBeVisible();
        await expect(rightSidebar.locator(".dv-pane-header", {
            hasText: AI_CHAT_TITLE_PATTERN,
        })).toHaveCount(0);
    });
});