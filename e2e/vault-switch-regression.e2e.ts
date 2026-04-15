/**
 * @module e2e/vault-switch-regression
 * @description 仓库切换回归测试。
 *
 *   覆盖场景：
 *   1. 打开一个显式声明为 vault 作用域的增量 tab（calendar）。
 *   2. 同时打开一个 global 作用域 tab（Architecture DevTools）。
 *   3. 切换到另一个仓库并 reload。
 *   4. 验证 vault 作用域 tab 已关闭，global 功能入口仍可重新打开，跟随面板仍处于无焦点态。
 *
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/mockVault
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage, switchMockVaultAndReload } from "./helpers/mockVault";

/**
 * @function waitForLayoutReady
 * @description 等待主布局和左右侧栏进入可交互状态。
 * @param page - Playwright 页面对象。
 * @returns Promise<void>
 */
async function waitForLayoutReady(page: Page): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab").first().waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-left']").first().waitFor({ state: "visible" });
}

test.describe("仓库切换 UI 失效", () => {
    test("reload 到另一个仓库后应清理 vault 作用域 tab 且 global 入口仍可使用", async ({ page }) => {
        const initialVaultPath = await gotoMockVaultPage(page, "vault-switch-regression-a");
        await waitForLayoutReady(page);

        await expect(page.locator(".vault-separator")).toHaveAttribute("title", initialVaultPath);

        const rightSidebar = page.locator("[aria-label='Right Extension Panel']");

        /* layout-v2 uses tabbed panels: check outline tab is visible, then verify empty state */
        const outlineTab = rightSidebar.locator(".layout-v2-panel-section__panel-tab[title='Outline']");
        const backlinksTab = rightSidebar.locator(".layout-v2-panel-section__panel-tab[title='Backlinks']");
        const paneBody = rightSidebar.locator(".layout-v2-panel-section__pane-body");

        await outlineTab.click();
        await expect(paneBody.getByText("No focused article")).toBeVisible();

        await backlinksTab.click();
        await expect(paneBody.getByText("No focused article")).toBeVisible();

        await page.getByTestId("activity-bar-item-calendar").click();
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "Calendar" })).toBeVisible();

        await page.getByTestId("activity-bar-item-architecture-devtools").click();
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "Architecture DevTools" })).toBeVisible();

        const nextVaultPath = await switchMockVaultAndReload(page, "vault-switch-regression-b");
        await waitForLayoutReady(page);

        await expect(page.locator(".vault-separator")).toHaveAttribute("title", nextVaultPath);
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "Calendar" })).toHaveCount(0);
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "Home" })).toBeVisible();

        await outlineTab.click();
        await expect(paneBody.getByText("No focused article")).toBeVisible();
        await expect(paneBody.getByText("Failed to load outline")).toHaveCount(0);

        await page.getByTestId("activity-bar-item-architecture-devtools").click();
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "Architecture DevTools" })).toBeVisible();
    });
});