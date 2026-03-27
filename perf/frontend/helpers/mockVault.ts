/**
 * @module perf/frontend/helpers/mockVault
 * @description 前端性能 smoke 测试的 mock vault 初始化辅助。
 *   该模块与功能 E2E 的 helper 隔离，避免性能测试对功能测试目录形成耦合。
 *
 * @dependencies
 *   - @playwright/test
 *
 * @exports
 *   - gotoPerfMockVaultPage
 */

import type { Page } from "@playwright/test";

const LAST_VAULT_PATH_STORAGE_KEY = "ofive:last-vault-path";
const REMEMBER_LAST_VAULT_STORAGE_KEY = "ofive:settings:remember-last-vault";

/**
 * @function gotoPerfMockVaultPage
 * @description 为当前性能测试预置 mock vault 路径并打开目标页面。
 * @param page Playwright 页面对象。
 * @param testName 当前测试名称，用于生成隔离的 mock vault 路径。
 * @param appPath 目标页面路径，默认为主应用首页。
 * @returns 当前测试使用的 mock vault 绝对路径。
 */
export async function gotoPerfMockVaultPage(
    page: Page,
    testName: string,
    appPath = "/",
): Promise<string> {
    const mockVaultPath = `/mock/notes/${testName}-${Date.now()}`;
    await page.goto(appPath);

    await page.evaluate(
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

    await page.reload();
    return mockVaultPath;
}