/**
 * @module e2e/calendar-convertible-view.e2e
 * @description 日历可转化视图 E2E 回归测试。
 *
 * 覆盖场景：
 * 1. 从右侧 icon 打开日历 tab
 * 2. 将日历 tab 拖到右侧 sidebar，转为 panel
 * 3. 将日历 panel 拖回主区域右侧，转为 tab 且触发 split
 *
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/dockviewDrag
 */

import { expect, test, type Page } from "@playwright/test";
import { dockviewDragPanel } from "./helpers/dockviewDrag";
import { gotoMockVaultPage } from "./helpers/mockVault";

/**
 * 等待布局进入可操作状态。
 *
 * @param page - Playwright 页面对象
 * @returns Promise<void>
 */
async function waitForLayoutReady(page: Page): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await page.locator(".dv-tab").first().waitFor({ state: "visible" });
    await page.locator(".dv-pane-header").first().waitFor({ state: "visible" });
}

/**
 * 读取 pane body 的实际高度，用于检测面板是否被挤压到仅剩标题。
 *
 * @param pane - 目标 pane locator
 * @returns Promise<number>
 */
async function getPaneBodyHeight(pane: ReturnType<Page["locator"]>): Promise<number> {
    return pane.locator(".dv-pane-body").evaluate((element) => {
        const htmlElement = element as HTMLElement;
        return htmlElement.getBoundingClientRect().height;
    });
}

/**
 * 读取整个 pane 的实际高度，用于验证 reload 前后尺寸是否保持一致。
 *
 * @param pane - 目标 pane locator
 * @returns Promise<number>
 */
async function getPaneHeight(pane: ReturnType<Page["locator"]>): Promise<number> {
    return pane.evaluate((element) => {
        const htmlElement = element as HTMLElement;
        return htmlElement.getBoundingClientRect().height;
    });
}

// TODO: layout-v2 uses pointer-based drag instead of HTML5 DnD; these tests need rework.
test.describe.skip("日历 tab/panel 转换", () => {
    test("calendar panel 拖回主区域右侧时应恢复为 split tab", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-panel-back-to-tab");
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-calendar").click();
        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toBeVisible();

        const calendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        const backlinksHeader = page.locator(".dv-pane-header", { hasText: "Backlinks" });
        await dockviewDragPanel(page, calendarTab, backlinksHeader);

        await expect(
            page.locator("[aria-label='Right Extension Panel'] .dv-pane-header", { hasText: "Calendar" }),
        ).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toHaveCount(0);

        const calendarPanel = page.locator(".dv-pane-header", { hasText: "Calendar" });
        const dockviewContent = page.locator("[aria-label='Dockview Main Area'] .dv-content-container");
        await dockviewDragPanel(page, calendarPanel, dockviewContent, { x: 0.82, y: 0.5 });

        await expect(page.locator(".dv-groupview")).toHaveCount(2);
        await expect(page.locator(".dv-tab", { hasText: "Home" })).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toBeVisible();
        await expect(
            page.locator("[aria-label='Right Extension Panel'] .dv-pane-header", { hasText: "Calendar" }),
        ).toHaveCount(0);
    });

    test("calendar panel 转成 tab 后关闭应恢复回右侧 panel", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-close-restores-panel");
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();

        const backlinksHeader = page.locator(".dv-pane-header", { hasText: "Backlinks" });
        await dockviewDragPanel(page, calendarTab, backlinksHeader);

        const calendarPanel = page.locator("[aria-label='Right Extension Panel'] .dv-pane-header", {
            hasText: "Calendar",
        });
        await expect(calendarPanel).toBeVisible();

        const dockviewContent = page.locator("[aria-label='Dockview Main Area'] .dv-content-container");
        await dockviewDragPanel(page, calendarPanel, dockviewContent, { x: 0.82, y: 0.5 });

        const restoredCalendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        await expect(restoredCalendarTab).toBeVisible();
        await restoredCalendarTab.hover();
        await restoredCalendarTab.locator(".dv-default-tab-action").click({ force: true });

        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toHaveCount(0);
        await expect(page.locator("[aria-label='Right Extension Panel'] .dv-pane-header", {
            hasText: "Calendar",
        })).toBeVisible();
    });

    test("calendar activity icon 在 panel 模式下仍应打开 tab 而不是接管左侧 sidebar", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-panel-icon-behavior");
        await waitForLayoutReady(page);

        const calendarIcon = page.getByTestId("activity-bar-item-calendar");
        await calendarIcon.click();
        const calendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();

        const backlinksHeader = page.locator(".dv-pane-header", { hasText: "Backlinks" });
        await dockviewDragPanel(page, calendarTab, backlinksHeader);

        await expect(
            page.locator("[aria-label='Right Extension Panel'] .dv-pane-header", { hasText: "Calendar" }),
        ).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toHaveCount(0);

        await calendarIcon.click();

        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toBeVisible();
        await expect(
            page.locator("[aria-label='Left Extension Panel'] .dv-pane-header", { hasText: "Calendar" }),
        ).toHaveCount(0);
    });

    test("calendar tab 拖到右侧后 outline 与 backlinks 的内容不应变空", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-panel-right-bodies");
        await page.setViewportSize({ width: 1527, height: 796 });
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();

        const rightSidebar = page.locator("[aria-label='Right Extension Panel']");
        const outlinePane = rightSidebar.locator(".dv-pane").filter({ hasText: "Outline" }).first();
        const backlinksPane = rightSidebar.locator(".dv-pane").filter({ hasText: "Backlinks" }).first();

        await expect(outlinePane.getByText("No focused article")).toBeVisible();
        await expect(backlinksPane.getByText("No focused article")).toBeVisible();

        const backlinksHeader = page.locator(".dv-pane-header", { hasText: "Backlinks" });
        await dockviewDragPanel(page, calendarTab, backlinksHeader);

        await expect(
            page.locator("[aria-label='Right Extension Panel'] .dv-pane-header", { hasText: "Calendar" }),
        ).toBeVisible();
        await expect.poll(() => getPaneBodyHeight(outlinePane)).toBeGreaterThan(60);
        await expect.poll(() => getPaneBodyHeight(backlinksPane)).toBeGreaterThan(60);
    });

    test("calendar panel 移到左侧后切换 Search/Explorer 应恢复上次展开的 calendar panel", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-panel-left-restore");
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();

        const backlinksHeader = page.locator(".dv-pane-header", { hasText: "Backlinks" });
        await dockviewDragPanel(page, calendarTab, backlinksHeader);

        const calendarPanelOnRight = page.locator("[aria-label='Right Extension Panel'] .dv-pane-header", {
            hasText: "Calendar",
        });
        await expect(calendarPanelOnRight).toBeVisible();

        const explorerHeader = page.locator("[aria-label='Left Extension Panel'] .dv-pane-header", {
            hasText: "Explorer",
        });
        await dockviewDragPanel(page, calendarPanelOnRight, explorerHeader);

        const leftSidebar = page.locator("[aria-label='Left Extension Panel']");
        const calendarPaneOnLeft = leftSidebar.locator(".dv-pane").filter({ hasText: "Calendar" }).first();
        await expect(calendarPaneOnLeft.locator(".dv-pane-header")).toBeVisible();
        await expect(calendarPaneOnLeft.getByRole("button", { name: "Today" })).toBeVisible();
        await expect(calendarPaneOnLeft.locator(".dv-pane-header-icon.collapsed")).toHaveCount(0);

        await page.getByTestId("activity-bar-item-search").click();
        await expect(leftSidebar.locator(".search-toolbar")).toBeVisible();

        await page.getByTestId("activity-bar-item-files").click();
        await expect(calendarPaneOnLeft.locator(".dv-pane-header")).toBeVisible();
        await expect(calendarPaneOnLeft.getByRole("button", { name: "Today" })).toBeVisible();
        await expect(calendarPaneOnLeft.locator(".dv-pane-header-icon.collapsed")).toHaveCount(0);
    });

    test("left sidebar 全部 pane 折叠后仍可将 calendar tab 放到空白区", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-panel-left-empty-drop");
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();

        const explorerPane = page.locator("[aria-label='Left Extension Panel'] .dv-pane").filter({ hasText: "Explorer" }).first();
        await explorerPane.locator(".dv-pane-header-icon").click();
        await expect(explorerPane.locator(".dv-pane-header-icon.collapsed")).toHaveCount(1);

        const collapsedDropSurface = page.getByTestId("left-sidebar-collapsed-drop-surface");
        await dockviewDragPanel(page, calendarTab, collapsedDropSurface, { x: 0.5, y: 0.85 });

        const leftSidebar = page.locator("[aria-label='Left Extension Panel']");
        const calendarPane = leftSidebar.locator(".dv-pane").filter({ hasText: "Calendar" }).first();
        await expect(calendarPane.locator(".dv-pane-header")).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toHaveCount(0);
    });

    test("calendar tab 拖入右侧后 reload 仍应恢复为右侧 pane", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-panel-right-reload");
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();

        const backlinksHeader = page.locator(".dv-pane-header", { hasText: "Backlinks" });
        await dockviewDragPanel(page, calendarTab, backlinksHeader);

        const rightCalendarPaneHeader = page.locator(
            "[aria-label='Right Extension Panel'] .dv-pane-header",
            { hasText: "Calendar" },
        );
        await expect(rightCalendarPaneHeader).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toHaveCount(0);

        await page.waitForTimeout(450);
        await page.reload();
        await waitForLayoutReady(page);

        await expect(rightCalendarPaneHeader).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toHaveCount(0);
    });

    test("calendar tab 拖入右侧后 reload 不应改变 panel 高度", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-panel-right-reload-size");
        await page.setViewportSize({ width: 1527, height: 796 });
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();

        const backlinksHeader = page.locator(".dv-pane-header", { hasText: "Backlinks" });
        await dockviewDragPanel(page, calendarTab, backlinksHeader);

        const rightSidebar = page.locator("[aria-label='Right Extension Panel']");
        const calendarPane = rightSidebar.locator(".dv-pane").filter({ hasText: "Calendar" }).first();
        await expect(calendarPane.locator(".dv-pane-header")).toBeVisible();

        const heightBeforeReload = await getPaneHeight(calendarPane);
        await page.waitForTimeout(450);
        await page.reload();
        await waitForLayoutReady(page);

        const restoredCalendarPane = rightSidebar.locator(".dv-pane").filter({ hasText: "Calendar" }).first();
        await expect(restoredCalendarPane.locator(".dv-pane-header")).toBeVisible();
        const heightAfterReload = await getPaneHeight(restoredCalendarPane);

        expect(Math.abs(heightAfterReload - heightBeforeReload)).toBeLessThanOrEqual(4);
    });
});
