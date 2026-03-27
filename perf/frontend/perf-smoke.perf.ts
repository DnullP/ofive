/**
 * @module perf/frontend/perf-smoke
 * @description 前端性能 smoke 用例：验证自动性能指标能够产出，并记录关键交互基线。
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/mockVault
 *
 * @example
 *   bunx playwright test --config playwright.perf.config.ts
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoPerfMockVaultPage } from "./helpers/mockVault";
import {
    readPerfMetrics,
    writeFrontendPerfReport,
} from "./helpers/frontendPerfReport";

/**
 * @function waitForLayoutReady
 * @description 等待主布局完成初始化。
 * @param page Playwright 页面对象。
 */
async function waitForLayoutReady(page: Page): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({
        state: "visible",
    });
    await page.locator(".dv-tab").first().waitFor({ state: "visible" });
}

/**
 * @function measureTaskBoardOpenInPage
 * @description 在浏览器上下文中测量任务看板打开到首张卡片可见的耗时。
 * @param page Playwright 页面对象。
 * @returns 浏览器侧测量结果。
 */
async function measureTaskBoardOpenInPage(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const start = performance.now();
        const button = document.querySelector(
            '[data-testid="activity-bar-item-task-board"]',
        ) as HTMLElement | null;
        if (!button) {
            throw new Error("task board activity button not found");
        }

        button.click();

        await new Promise<void>((resolve, reject) => {
            const timeoutAt = performance.now() + 5_000;

            const tick = (): void => {
                if (document.querySelector(".task-board__task-card")) {
                    resolve();
                    return;
                }

                if (performance.now() >= timeoutAt) {
                    reject(new Error("task board did not become visible in time"));
                    return;
                }

                window.requestAnimationFrame(tick);
            };

            tick();
        });

        return Number((performance.now() - start).toFixed(3));
    });
}

test.describe("性能 smoke", () => {
    test("应产出前端启动与关键交互性能指标", async ({ page }) => {
        await gotoPerfMockVaultPage(page, "perf-smoke");
        await waitForLayoutReady(page);

        const navigationMetric = (await readPerfMetrics(page)).find(
            (metric) => metric.name === "frontend.performance.navigation",
        );
        expect(navigationMetric).toBeTruthy();
        expect(navigationMetric?.status).toBe("ok");

        const taskBoardOpenDurationMs = await measureTaskBoardOpenInPage(page);
        await expect(page.locator(".task-board__task-card")).toHaveCount(1);
        await page.getByRole("button", { name: /All|全部/ }).click();
        await expect(page.locator(".task-board__task-card")).toHaveCount(2);

        const metrics = await readPerfMetrics(page);
        expect(metrics.some((metric) => metric.category === "web-vitals")).toBe(true);
        await writeFrontendPerfReport("frontend-perf-smoke.json", {
            schemaVersion: "ofive.perf.report.v1",
            generatedAt: new Date().toISOString(),
            suite: "frontend-perf-smoke",
            metrics,
            derived: [
                {
                    schemaVersion: "ofive.perf.metric.v1",
                    name: "frontend.flow.open-task-board",
                    category: "playwright-derived",
                    status: "ok",
                    runtime: "browser",
                    durationMs: taskBoardOpenDurationMs,
                    details: {
                        initialOpenCardCount: 1,
                        allCardCount: 2,
                    },
                },
            ],
        });
    });
});