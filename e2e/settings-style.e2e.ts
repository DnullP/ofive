/**
 * @module e2e/settings-style
 * @description 设置页风格回归：验证 settings 面板使用直角卡片和紧凑列表风格。
 */

import { expect, test } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";

test.describe("settings style", () => {
    test("settings page should use square surfaces and dense controls", async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });

        await page.getByTestId("activity-bar-item-__settings__").click();

        const settingsTab = page.locator(".layout-v2-tab-section__card--active .settings-tab");
        await expect(settingsTab).toBeVisible();

        await expect(page.locator(".settings-tab-search")).toHaveCSS("border-top-left-radius", "0px");
        await expect(page.locator(".settings-item-group").first()).toHaveCSS("border-top-left-radius", "0px");

        await page.locator(".settings-tab-sidebar-item", { hasText: /快捷键|Shortcuts/ }).click();
        await expect(page.locator(".settings-shortcut-table-wrapper")).toBeVisible();
        await expect(page.locator(".settings-shortcut-table-wrapper")).toHaveCSS("border-top-left-radius", "0px");
        await expect(page.locator(".settings-shortcut-kbd").first()).toHaveCSS("border-top-left-radius", "0px");

        await page.locator(".settings-tab-sidebar-item", { hasText: /AI 对话|AI Chat/ }).click();
        await page.locator(".settings-tab-sidebar-subitem", { hasText: /Provider/ }).click();
        await expect(page.locator(".ai-chat-provider-settings-form")).toBeVisible();
        await expect(page.locator(".ai-chat-settings-input").first()).toHaveCSS("border-top-left-radius", "0px");
        await expect(page.locator(".ai-chat-settings-save").first()).toHaveCSS("border-top-left-radius", "0px");

        await page.locator(".ai-chat-settings-provider-actions button", { hasText: /Add provider|添加 provider/ }).click();
        const addProviderSubmit = page.locator(".ai-chat-provider-modal .ofive-ui-button--primary", { hasText: /Add provider|添加 provider/ });
        await expect(addProviderSubmit).toBeVisible();
        await expect(addProviderSubmit).toHaveCSS("background-image", /gradient/);
        await expect(addProviderSubmit).toHaveCSS("color", "rgb(255, 255, 255)");
        await page.locator(".ai-chat-provider-modal button", { hasText: /Cancel|取消/ }).click();
        await expect(page.locator(".ai-chat-provider-modal")).toHaveCount(0);

        await page.locator(".settings-tab-sidebar-item", { hasText: /风格|Style/ }).click();
        await expect(page.locator(".settings-theme-mode-button").first()).toHaveCSS("border-top-left-radius", "0px");
    });

    test("settings sidebar list should scroll independently", async ({ page }) => {
        await page.setViewportSize({ width: 1180, height: 520 });
        await page.goto(MOCK_PAGE);
        await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });

        await page.getByTestId("activity-bar-item-__settings__").click();

        const settingsTab = page.locator(".layout-v2-tab-section__card--active .settings-tab");
        await expect(settingsTab).toBeVisible();

        const sidebar = settingsTab.locator(".settings-tab-sidebar");
        const sidebarList = settingsTab.locator(".settings-tab-sidebar-list");
        await expect(sidebar).toBeVisible();
        await expect(sidebarList).toBeVisible();

        const metricsBefore = await sidebarList.evaluate((element) => ({
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            overflowY: window.getComputedStyle(element).overflowY,
            sidebarClientHeight: element.closest(".settings-tab-sidebar")?.clientHeight ?? 0,
        }));

        expect(metricsBefore.overflowY).toBe("auto");
        expect(metricsBefore.clientHeight).toBeLessThan(metricsBefore.scrollHeight);
        expect(metricsBefore.clientHeight).toBeLessThanOrEqual(metricsBefore.sidebarClientHeight);

        await sidebarList.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });

        await expect.poll(async () => sidebarList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    });
});
