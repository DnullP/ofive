/**
 * @module e2e/settings-number-input
 * @description 设置页数值输入回归：验证公共数值输入允许清空编辑且不使用浏览器原生 number spinner。
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";

async function openSettingsSection(page: Page, sectionName: RegExp): Promise<void> {
    await page.goto(MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.getByTestId("activity-bar-item-__settings__").click();

    const settingsTab = page.locator(".layout-v2-tab-section__card--active .settings-tab");
    await expect(settingsTab).toBeVisible();
    await settingsTab.locator(".settings-tab-sidebar-item", { hasText: sectionName }).click();
}

async function expectFreeNumberInput(input: Locator, initialValue: string, nextValue: string): Promise<void> {
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveClass(/ofive-ui-number-input/);
    await expect(input).toHaveValue(initialValue);

    await input.focus();
    for (let index = 0; index < initialValue.length; index += 1) {
        await input.press("Backspace");
    }
    await expect(input).toHaveValue("");

    await input.pressSequentially(nextValue);
    await expect(input).toHaveValue(nextValue);
}

test.describe("settings number input", () => {
    test("standard settings number input can be cleared while editing", async ({ page }) => {
        await openSettingsSection(page, /通用|General/);

        const notificationsInput = page.locator("#general-global-notifications-max-visible");
        await expectFreeNumberInput(notificationsInput, "3", "7");
    });

    test("dense graph settings number input can be cleared while editing", async ({ page }) => {
        await openSettingsSection(page, /图谱|Graph/);

        const pointDefaultSizeInput = page.locator(".settings-dense-row", {
            hasText: /节点大小|Node Size/,
        }).locator(".ofive-ui-number-input");
        await expectFreeNumberInput(pointDefaultSizeInput, "2.5", "12.5");
    });
});
