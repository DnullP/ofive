/**
 * @module e2e/helpers/mockVault
 * @description Playwright E2E 的 mock vault 初始化辅助。
 *   通过在页面脚本执行前预置 localStorage，复用应用默认“记住上次仓库”逻辑，
 *   避免在正式业务初始化中引入测试专用 URL 参数分支。
 *
 * @dependencies
 *   - @playwright/test
 *
 * @exports
 *   - gotoMockVaultPage
 */

import type { Page } from "@playwright/test";

const LAST_VAULT_PATH_STORAGE_KEY = "ofive:last-vault-path";
const REMEMBER_LAST_VAULT_STORAGE_KEY = "ofive:settings:remember-last-vault";

/**
 * @function gotoMockVaultPage
 * @description 为当前测试预置 mock vault 路径并打开目标页面。
 * @param page - Playwright 页面对象。
 * @param testName - 当前测试名称，用于生成隔离的 mock vault 路径。
 * @param path - 目标页面路径，默认为主应用首页。
 * @returns 当前测试使用的 mock vault 绝对路径。
 */
export async function gotoMockVaultPage(
    page: Page,
    testName: string,
    path = "/",
): Promise<string> {
    const mockVaultPath = `/mock/notes/${testName}-${Date.now()}`;

    await page.addInitScript(
        ({ lastVaultPathStorageKey, rememberLastVaultStorageKey, nextVaultPath }) => {
            window.localStorage.setItem(rememberLastVaultStorageKey, "true");
            window.localStorage.setItem(lastVaultPathStorageKey, nextVaultPath);
        },
        {
            lastVaultPathStorageKey: LAST_VAULT_PATH_STORAGE_KEY,
            rememberLastVaultStorageKey: REMEMBER_LAST_VAULT_STORAGE_KEY,
            nextVaultPath: mockVaultPath,
        },
    );

    await page.goto(path);
    return mockVaultPath;
}