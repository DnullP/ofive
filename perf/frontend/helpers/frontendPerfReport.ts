/**
 * @module perf/frontend/helpers/frontendPerfReport
 * @description 前端性能测试通用辅助：读取浏览器性能指标并写入结构化报告文件。
 * @dependencies
 *   - @playwright/test
 *   - node:fs/promises
 *   - node:path
 *
 * @exports
 *   - BrowserPerfMetricRecord
 *   - readPerfMetrics
 *   - writeFrontendPerfReport
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

/**
 * @interface BrowserPerfMetricRecord
 * @description 浏览器上下文内读取到的性能指标结构。
 */
export interface BrowserPerfMetricRecord {
    schemaVersion: string;
    name: string;
    category: string;
    status: string;
    durationMs: number;
    details: Record<string, unknown>;
}

/**
 * @function readPerfMetrics
 * @description 从浏览器上下文中读取已记录的性能指标。
 * @param page Playwright 页面对象。
 * @returns 性能指标数组。
 */
export async function readPerfMetrics(page: Page): Promise<BrowserPerfMetricRecord[]> {
    return page.evaluate(() => {
        const runtimeWindow = window as Window & {
            __OFIVE_PERF_METRICS__?: BrowserPerfMetricRecord[];
        };

        return Array.isArray(runtimeWindow.__OFIVE_PERF_METRICS__)
            ? runtimeWindow.__OFIVE_PERF_METRICS__
            : [];
    });
}

/**
 * @function writeFrontendPerfReport
 * @description 将前端性能场景结果输出到固定报告目录。
 * @param fileName 输出文件名。
 * @param report 待写入的报告对象。
 */
export async function writeFrontendPerfReport(
    fileName: string,
    report: Record<string, unknown>,
): Promise<void> {
    const reportDir = path.join(process.cwd(), "test-results", "perf");
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(
        path.join(reportDir, fileName),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8",
    );
}