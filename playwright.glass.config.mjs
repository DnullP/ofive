/**
 * @module playwright.glass.config
 * @description 桌面毛玻璃视觉参考用例专用 Playwright 配置。
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    testMatch: /glass-visual\.e2e\.ts/,
    timeout: 30_000,
    retries: 0,
    reporter: "line",
    use: {
        baseURL: "http://127.0.0.1:4173",
        headless: true,
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: {
        command: "bun run web:dev",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: true,
        timeout: 30_000,
    },
});