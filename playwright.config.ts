/**
 * @module playwright.config
 * @description Playwright E2E 测试配置。
 *
 * - 使用 web:dev（Vite dev server，port 4173）作为被测应用
 * - 仅启用 Chromium（桌面应用场景，无需跨浏览器）
 * - webServer 会自动启动开发服务器，CI 环境中强制重启
 *
 * @dependencies
 *   - @playwright/test
 *   - vite (通过 bun run web:dev 启动)
 *
 * @example
 *   bun run test:e2e          # headless 运行
 *   bun run test:e2e:ui       # 交互式 UI 模式
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    /** 测试文件目录 */
    testDir: "./e2e",

    /** 单个测试超时 30s */
    timeout: 30_000,

    /** 失败时不自动重试（本地开发体验优先） */
    retries: 0,

    /** 测试报告输出 */
    reporter: "html",

    use: {
        /** 被测应用地址 */
        baseURL: "http://127.0.0.1:4173",

        /** 默认 headless，CI 中始终 headless */
        headless: true,

        /** 失败时自动截图 */
        screenshot: "only-on-failure",

        /** 失败时保留 trace */
        trace: "on-first-retry",
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],

    /** 自动启动 Vite dev server */
    webServer: {
        command: "bun run web:dev",
        url: "http://127.0.0.1:4173",
        /** 本地复用已启动的 dev server，CI 中强制重启 */
        reuseExistingServer: !process.env.CI,
        /** 最多等 30s 让 dev server 就绪 */
        timeout: 30_000,
    },
});
