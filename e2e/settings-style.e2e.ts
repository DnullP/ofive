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
        await expect(page.locator(".ai-chat-provider-settings-form")).toBeVisible();
        await expect(page.locator(".ai-chat-settings-input").first()).toHaveCSS("border-top-left-radius", "0px");
        await expect(page.locator(".ai-chat-settings-save").first()).toHaveCSS("border-top-left-radius", "0px");

        await page.locator(".settings-tab-sidebar-item", { hasText: /风格|Style/ }).click();
        await expect(page.locator(".settings-theme-mode-button").first()).toHaveCSS("border-top-left-radius", "0px");
    });
});
