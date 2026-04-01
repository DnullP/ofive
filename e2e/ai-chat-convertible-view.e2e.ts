/**
 * @module e2e/ai-chat-convertible-view
 * @description AI chat 可转化视图 E2E 回归测试。
 *
 * 覆盖场景：
 * 1. 从右侧 activity icon 打开 AI chat pane
 * 2. 将 AI chat pane 拖到主区域，转为 tab
 * 3. 将 AI chat tab 拖回右侧 sidebar，转回 pane
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
    test("ai chat pane 可拖到主区域并可拖回右侧 sidebar", async ({ page }) => {
        await gotoMockVaultPage(page, "ai-chat-pane-back-to-tab");
        await waitForLayoutReady(page);

        await page.getByTestId("right-activity-icon-ai-chat").click();

        const rightSidebar = page.locator("[aria-label='Right Extension Panel']");
        const aiChatPaneHeader = rightSidebar.locator(".dv-pane-header", {
            hasText: AI_CHAT_TITLE_PATTERN,
        });
        await expect(aiChatPaneHeader).toBeVisible();

        const dockviewContent = page.locator("[aria-label='Dockview Main Area'] .dv-content-container");
        await dockviewDragPanel(page, aiChatPaneHeader, dockviewContent, { x: 0.82, y: 0.5 });

        const aiChatTab = page.locator(".dv-tab", { hasText: AI_CHAT_TITLE_PATTERN });
        await expect(aiChatTab).toBeVisible();
        await expect(aiChatPaneHeader).toHaveCount(0);

        const rightSidebarEmpty = rightSidebar.getByTestId("right-sidebar-empty");
        await expect(rightSidebarEmpty).toBeVisible();
        await dockviewDragPanel(page, aiChatTab, rightSidebarEmpty);

        await expect(rightSidebar.locator(".dv-pane-header", {
            hasText: AI_CHAT_TITLE_PATTERN,
        })).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: AI_CHAT_TITLE_PATTERN })).toHaveCount(0);
    });

    test("ai chat panel 转成 tab 后关闭应恢复回右侧 panel", async ({ page }) => {
        await gotoMockVaultPage(page, "ai-chat-close-restores-panel");
        await waitForLayoutReady(page);

        await page.getByTestId("right-activity-icon-ai-chat").click();

        const rightSidebar = page.locator("[aria-label='Right Extension Panel']");
        const aiChatPaneHeader = rightSidebar.locator(".dv-pane-header", {
            hasText: AI_CHAT_TITLE_PATTERN,
        });
        await expect(aiChatPaneHeader).toBeVisible();

        const dockviewContent = page.locator("[aria-label='Dockview Main Area'] .dv-content-container");
        await dockviewDragPanel(page, aiChatPaneHeader, dockviewContent, { x: 0.82, y: 0.5 });

        const aiChatTab = page.locator(".dv-tab", { hasText: AI_CHAT_TITLE_PATTERN });
        await expect(aiChatTab).toBeVisible();
        await aiChatTab.hover();
        await aiChatTab.locator(".dv-default-tab-action").click({ force: true });

        await expect(rightSidebar.locator(".dv-pane-header", {
            hasText: AI_CHAT_TITLE_PATTERN,
        })).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: AI_CHAT_TITLE_PATTERN })).toHaveCount(0);
    });
});