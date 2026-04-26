/**
 * @module e2e/context-menu-center
 * @description 右键菜单中心回归：默认阻止未注册右键，已注册区域能进入中心分发。
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

test.describe("右键菜单中心", () => {
    test("应用空白区域默认阻止浏览器右键菜单", async ({ page }) => {
        await gotoMockVaultPage(page, "context-menu-blocker");
        await waitForLayoutReady(page);

        const result = await page.evaluate(() => {
            const event = new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: 8,
                clientY: 8,
            });
            const dispatchResult = document.body.dispatchEvent(event);

            return {
                defaultPrevented: event.defaultPrevented,
                dispatchResult,
            };
        });

        expect(result.defaultPrevented).toBe(true);
        expect(result.dispatchResult).toBe(false);
    });

    test("已注册日历日期右键会进入菜单中心分发", async ({ page }) => {
        await gotoMockVaultPage(page, "context-menu-calendar");
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".layout-v2-tab-section__card--active .calendar-tab");
        await expect(calendarTab.locator(".calendar-tab__calendar-surface")).toBeVisible();

        const nativeMenuAttempt = page.waitForEvent("console", {
            predicate: (message) => message.text().includes("[native-context-menu] skipped: not tauri runtime"),
            timeout: 3000,
        });
        await calendarTab.locator(".calendar-tab__day").first().click({ button: "right" });

        await nativeMenuAttempt;
    });
});
