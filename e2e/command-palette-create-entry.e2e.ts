/**
 * @module e2e/command-palette-create-entry.e2e
 * @description 验证命令面板执行“在当前目录创建文件”时会打开宿主创建输入浮窗。
 *
 * 覆盖场景：
 * 1. 在 mock 页面按下 `Cmd+J` 打开命令面板
 * 2. 执行“在当前目录创建文件”命令
 * 3. 验证新建文件输入浮窗出现并带有默认草稿名
 *
 * @dependencies
 *   - @playwright/test
 */

import { expect, test, type Page } from "@playwright/test";

/**
 * @function openCommandPalette
 * @description 打开命令面板；若首次按键时绑定尚未加载完成，则重试一次。
 * @param page - Playwright 页面对象。
 * @returns Promise<void>
 */
async function openCommandPalette(page: Page): Promise<void> {
    await page.keyboard.press("Meta+J");

    const commandPalette = page.locator(".command-palette-panel");
    try {
        await expect(commandPalette).toBeVisible({ timeout: 2000 });
    } catch {
        await page.keyboard.press("Meta+J");
        await expect(commandPalette).toBeVisible();
    }
}

test("command palette create-file command should open create-entry modal", async ({ page }) => {
    await page.goto("/web-mock/mock-tauri-test.html?showControls=0");

    await openCommandPalette(page);

    const commandPalette = page.locator(".command-palette-panel");
    await commandPalette.locator(".command-palette-input").fill("note.createNew");
    await commandPalette
        .locator(".command-palette-item")
        .filter({ hasText: "note.createNew" })
        .first()
        .click();

    const createEntryModal = page.locator(".create-entry-panel");
    await expect(createEntryModal).toBeVisible();
    await expect(createEntryModal.locator(".create-entry-title")).toHaveText(/New File|新建文件/);
    await expect(createEntryModal.locator(".create-entry-input")).toHaveValue("untitled");
});