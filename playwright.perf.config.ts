/**
 * @module playwright.perf.config
 * @description Playwright 前端性能 smoke 测试配置。
 *
 * - 使用独立的 `perf/frontend` 目录，避免与功能 E2E 混跑
 * - 继续复用 web:dev 作为被测应用，保持环境一致性
 * - 输出独立的 HTML 报告目录，隔离性能测试工件
 *
 * @dependencies
 *   - @playwright/test
 *   - vite (通过 bun run web:dev 启动)
 *
 * @example
 *   bun run test:perf:frontend
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    /** 测试文件目录 */
    testDir: "./perf/frontend",

    /** 性能测试工件目录，与 HTML 报告隔离，避免互相清理 */
    outputDir: "test-results/playwright-perf-artifacts",

    /** 仅匹配前端性能 smoke 文件 */
    testMatch: /.*\.perf\.ts/,

    /** 单个测试超时 30s */
    timeout: 30_000,

    /** 性能 smoke 不重试，避免掩盖抖动 */
    retries: 0,

    /** 独立报告输出，避免与功能 E2E 混用 */
    reporter: [["html", { outputFolder: "test-results/perf-report-html" }]],

    use: {
        /** 被测应用地址 */
        baseURL: "http://127.0.0.1:4173",

        /** 默认 headless */
        headless: true,

        /**
         * 使用软件 WebGL，确保 headless 环境下图谱等 WebGL 组件也能参与性能测试。
         */
        launchOptions: {
            args: [
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--ignore-gpu-blocklist",
            ],
        },

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
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});