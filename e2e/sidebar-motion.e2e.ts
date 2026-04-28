/**
 * @module e2e/sidebar-motion.e2e
 * @description 侧栏显隐回归测试（layout-v2）。
 *
 * 覆盖场景：
 * 1. 键盘快捷键切换左侧栏显隐
 * 2. 右侧 icon 点击可切换 active 项，键盘快捷键可隐藏/恢复右侧栏
 * 3. 左侧栏隐藏后，知识图谱入口仍可正常打开 tab
 *
 * @dependencies
 *   - @playwright/test
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";

async function waitForMockLayoutReady(page: Page): Promise<void> {
    await page.locator("[data-testid='sidebar-left']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-right']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab-main").first().waitFor({ state: "visible" });
}

test.describe("sidebar toggle regression", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await waitForMockLayoutReady(page);
    });

    test("left sidebar can hide and reopen via keyboard shortcut", async ({ page }) => {
        const sidebarLeft = page.locator("[data-testid='sidebar-left']");
        await expect(sidebarLeft).toBeVisible();

        await page.keyboard.press("Meta+Shift+J");
        await expect(sidebarLeft).toHaveCount(0);

        await page.keyboard.press("Meta+Shift+J");
        await expect(sidebarLeft).toBeVisible();
    });

    test("right sidebar can switch active item and hide via shortcut", async ({ page }) => {
        const outlineTab = page.locator("[data-layout-panel-id='outline'][data-layout-role='panel']");
        const aiChatTab = page.locator("[data-layout-panel-id='ai-chat'][data-layout-role='panel']");
        const sidebarRight = page.locator("[data-testid='sidebar-right']");

        await expect(sidebarRight).toBeVisible();

        await outlineTab.click();
        await expect(outlineTab).toHaveClass(/--focused/);

        await aiChatTab.click();
        await expect(aiChatTab).toHaveClass(/--focused/);
        await expect(sidebarRight).toBeVisible();

        await page.keyboard.press("Meta+Shift+K");
        await expect(sidebarRight).toHaveCount(0);

        await page.keyboard.press("Meta+Shift+K");
        await expect(sidebarRight).toBeVisible();
        await expect(outlineTab).toBeVisible();
    });

    test("knowledge graph tab opens after sidebar toggle", async ({ page }) => {
        await page.keyboard.press("Meta+Shift+J");
        await expect(page.locator("[data-testid='sidebar-left']")).toHaveCount(0);

        await page.getByTestId("activity-bar-item-knowledge-graph").click();

        await expect(
            page.locator(".layout-v2-tab-section__tab-title", { hasText: "知识图谱" }),
        ).toBeVisible();
        await expect(page.locator(".knowledge-graph-tab").first()).toBeVisible();
    });
});