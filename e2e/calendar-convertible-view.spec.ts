/**
 * @module e2e/calendar-convertible-view.spec
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

test.describe("日历 tab/panel 转换", () => {
    test("calendar panel 拖回主区域右侧时应恢复为 split tab", async ({ page }) => {
        await page.goto("/");
        await waitForLayoutReady(page);

        await page.getByTitle("Calendar").click();
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

    test("calendar activity icon 在 panel 模式下仍应打开 tab 而不是接管左侧 sidebar", async ({ page }) => {
        await page.goto("/");
        await waitForLayoutReady(page);

        const calendarIcon = page.getByTitle("Calendar");
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

    test("calendar panel 移到左侧后切换 Search/Explorer 应恢复上次展开的 calendar panel", async ({ page }) => {
        await page.goto("/");
        await waitForLayoutReady(page);

        await page.getByTitle("Calendar").click();
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

        await page.getByTitle("Search").click();
        await expect(leftSidebar.getByText("Search Panel")).toBeVisible();

        await page.getByTitle("Explorer").click();
        await expect(calendarPaneOnLeft.locator(".dv-pane-header")).toBeVisible();
        await expect(calendarPaneOnLeft.getByRole("button", { name: "Today" })).toBeVisible();
        await expect(calendarPaneOnLeft.locator(".dv-pane-header-icon.collapsed")).toHaveCount(0);
    });

    test("left sidebar 全部 pane 折叠后仍可将 calendar tab 放到空白区", async ({ page }) => {
        await page.goto("/");
        await waitForLayoutReady(page);

        await page.getByTitle("Calendar").click();
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
});
