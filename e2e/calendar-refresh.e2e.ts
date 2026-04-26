/**
 * @module e2e/calendar-refresh
 * @description 日历刷新体验回归：后台刷新时保留已有月历主体，避免整块 UI 闪烁。
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/mockVault
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

async function waitForLayoutReady(page: Page): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab").first().waitFor({ state: "visible" });
}

test.describe("日历刷新体验", () => {
    test("后台刷新期间应保留已有月历主体", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-refresh");
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".layout-v2-tab-section__card--active .calendar-tab");
        const calendarSurface = calendarTab.locator(".calendar-tab__calendar-surface");

        await expect(calendarSurface).toBeVisible();
        await expect(calendarSurface.locator(".calendar-tab__day")).toHaveCount(42);
        await expect(calendarTab.locator(".calendar-tab__status", { hasText: /Loading|加载/ })).toHaveCount(0);

        await page.evaluate(async () => {
            const module = await import("/src/host/events/appEventBus.ts");
            module.dispatchVaultFsBusEventForTest({
                eventId: `calendar-refresh-${String(Date.now())}`,
                sourceTraceId: null,
                eventType: "modified",
                relativePath: "test-resources/notes/network-segment.md",
                oldRelativePath: null,
            });
        });

        await expect(calendarSurface).toBeVisible();
        await expect(calendarSurface.locator(".calendar-tab__day")).toHaveCount(42);
        await expect(calendarTab.locator(".calendar-tab__status", { hasText: /Loading|加载/ })).toHaveCount(0);
    });

    test("panel 日期气泡应在点击非气泡位置后关闭", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-popover-dismiss");
        await waitForLayoutReady(page);

        const rightSidebar = page.locator("[aria-label='Right Extension Panel']");
        const calendarPanelTab = rightSidebar.locator(".layout-v2-panel-section__panel-tab[title='日历'], .layout-v2-panel-section__panel-tab[title='Calendar']");
        await calendarPanelTab.click();

        const calendarPanel = rightSidebar.locator(".calendar-tab--panel");
        await expect(calendarPanel.locator(".calendar-tab__calendar-surface")).toBeVisible();

        await calendarPanel.locator(".calendar-tab__day").filter({ hasText: "9" }).first().click();
        const popover = calendarPanel.locator(".calendar-tab__panel-popover");
        await expect(popover).toBeVisible();
        await expect(popover.locator(".calendar-tab__panel-popover-title")).toHaveCount(0);
        await expect(popover.locator(".calendar-tab__panel-popover-subtitle")).toHaveCount(0);
        await expect(popover.locator(".calendar-tab__panel-popover-close")).toHaveCount(0);

        await calendarPanel.locator(".calendar-tab__month-label").click();
        await expect(popover).toHaveClass(/is-closing/);
        await expect(popover).toHaveCount(0);
    });
});
