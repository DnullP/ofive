/**
 * @module e2e/browser-fallback-vault
 * @description 浏览器 fallback 根页面回归测试。
 *
 * 验证场景：
 * 1. 首次打开根地址 `/` 时，不依赖本地“上次仓库”缓存。
 * 2. 浏览器 fallback 会自动落到 `/mock/notes`。
 * 3. 资源管理器能展开到 `test-resources/notes` 并看到样例文章。
 *
 * @dependencies
 *   - @playwright/test
 *
 * @example
 *   bunx playwright test --config playwright.config.ts e2e/browser-fallback-vault.e2e.ts --reporter=line
 */

import { expect, test } from "@playwright/test";

const LAST_VAULT_PATH_STORAGE_KEY = "ofive:last-vault-path";
const FRONTEND_REMEMBER_LAST_VAULT_KEY = "ofive:settings:remember-last-vault";

test.describe("browser fallback 默认仓库", () => {
    test("首次打开根页面时应自动显示 mock 测试文章", async ({ page }) => {
        await page.addInitScript(({ lastVaultKey, rememberKey }) => {
            window.localStorage.removeItem(lastVaultKey);
            window.localStorage.removeItem(rememberKey);
        }, {
            lastVaultKey: LAST_VAULT_PATH_STORAGE_KEY,
            rememberKey: FRONTEND_REMEMBER_LAST_VAULT_KEY,
        });

        await page.goto("/");

        const testResourcesFolder = page.locator('[data-tree-path="test-resources"]');
        await expect(testResourcesFolder).toBeVisible();
        await expect(page.locator('[title="/mock/notes"]')).toBeVisible();

        await testResourcesFolder.click();
        const notesFolder = page.locator('[data-tree-path="test-resources/notes"]');
        await expect(notesFolder).toBeVisible();

        await notesFolder.click();
        await expect(page.locator('[data-tree-path="test-resources/notes/guide.md"]')).toBeVisible();
        await expect(page.locator('[data-tree-path="test-resources/notes/note1.md"]')).toBeVisible();
    });
});