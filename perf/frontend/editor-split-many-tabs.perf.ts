/**
 * @module perf/frontend/editor-split-many-tabs
 * @description 大量 Markdown editor tab 打开后的 split 性能测试。
 *   通过 web-mock 注入 perf-editor-* fixture，验证 split 只挂载可见 section 的 active editor，
 *   并输出打开耗时、split 耗时、EditorView 销毁日志数和 long task 统计。
 *
 * @dependencies
 *   - @playwright/test
 *   - node:perf_hooks
 *   - ./helpers/frontendPerfReport
 *
 * @example
 *   bunx playwright test --config playwright.perf.config.ts perf/frontend/editor-split-many-tabs.perf.ts --reporter=line
 */

import { performance } from "node:perf_hooks";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readPerfMetrics, writeFrontendPerfReport, type BrowserPerfMetricRecord } from "./helpers/frontendPerfReport";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0&bulkEditorPerf=1";
const MANY_EDITOR_TAB_COUNT = 24;
const MAX_EXPECTED_SPLIT_EDITOR_DESTROY_LOGS = 3;
const LIVE_EDITOR_SELECTOR = ".cm-editor:not([data-editor-preview-mirror-node='true'])";
const PERF_NOTE_PATHS = Array.from({ length: MANY_EDITOR_TAB_COUNT }, (_, index) => {
    const paddedIndex = String(index + 1).padStart(3, "0");
    return `test-resources/notes/perf-editor-${paddedIndex}.md`;
});

interface LongTaskSnapshot {
    count: number;
    totalDurationMs: number;
    maxDurationMs: number;
}

interface SplitMeasurement {
    openDurationMs: number;
    splitDurationMs: number;
    splitTotalGestureDurationMs: number;
    splitPointerMoveDurationMs: number;
    splitPointerUpDispatchDurationMs: number;
    splitPostDropSettleDurationMs: number;
    editorCountBeforeSplit: number;
    editorCountAfterSplit: number;
    tabSectionCountAfterSplit: number;
    editorDestroyLogCountDuringSplit: number;
    editorDestroyLogCountDuringPointerMove: number;
    editorDestroyLogCountDuringPointerUp: number;
    editorDestroyLogCountDuringPostDropSettle: number;
    longTaskDeltaDuringSplit: LongTaskSnapshot;
}

interface SplitInteractionTiming {
    totalGestureDurationMs: number;
    pointerMoveDurationMs: number;
    pointerUpDispatchDurationMs: number;
    postDropSettleDurationMs: number;
    pointerMoveDestroyLogCount: number;
    pointerUpDestroyLogCount: number;
    postDropSettleDestroyLogCount: number;
}

/**
 * @function installLongTaskRecorder
 * @description 在页面初始化前安装 long task 采集器；浏览器不支持时保持空结果。
 * @param page Playwright 页面对象。
 * @returns Promise<void>。
 */
async function installLongTaskRecorder(page: Page): Promise<void> {
    await page.addInitScript(() => {
        type LongTaskRecord = { duration: number; startTime: number; name: string };
        const runtimeWindow = window as Window & {
            __OFIVE_EDITOR_SPLIT_LONG_TASKS__?: LongTaskRecord[];
        };

        runtimeWindow.__OFIVE_EDITOR_SPLIT_LONG_TASKS__ = [];
        if (!("PerformanceObserver" in window)) {
            return;
        }

        try {
            const observer = new PerformanceObserver((entryList) => {
                entryList.getEntries().forEach((entry) => {
                    runtimeWindow.__OFIVE_EDITOR_SPLIT_LONG_TASKS__?.push({
                        duration: Number(entry.duration.toFixed(3)),
                        startTime: Number(entry.startTime.toFixed(3)),
                        name: entry.name,
                    });
                });
            });
            observer.observe({ entryTypes: ["longtask"] });
        } catch {
            runtimeWindow.__OFIVE_EDITOR_SPLIT_LONG_TASKS__ = [];
        }
    });
}

/**
 * @function readLongTaskSnapshot
 * @description 读取页面端累计 long task 数量、总耗时和最大耗时。
 * @param page Playwright 页面对象。
 * @returns long task 快照。
 */
async function readLongTaskSnapshot(page: Page): Promise<LongTaskSnapshot> {
    return page.evaluate(() => {
        const runtimeWindow = window as Window & {
            __OFIVE_EDITOR_SPLIT_LONG_TASKS__?: Array<{ duration: number }>;
        };
        const tasks = runtimeWindow.__OFIVE_EDITOR_SPLIT_LONG_TASKS__ ?? [];
        const durations = tasks.map((task) => task.duration);
        return {
            count: tasks.length,
            totalDurationMs: Number(durations.reduce((sum, duration) => sum + duration, 0).toFixed(3)),
            maxDurationMs: durations.length > 0 ? Number(Math.max(...durations).toFixed(3)) : 0,
        };
    });
}

/**
 * @function diffLongTaskSnapshot
 * @description 计算两个 long task 快照之间的增量。
 * @param before 操作前快照。
 * @param after 操作后快照。
 * @returns 增量快照。
 */
function diffLongTaskSnapshot(before: LongTaskSnapshot, after: LongTaskSnapshot): LongTaskSnapshot {
    return {
        count: Math.max(0, after.count - before.count),
        totalDurationMs: Number(Math.max(0, after.totalDurationMs - before.totalDurationMs).toFixed(3)),
        maxDurationMs: after.maxDurationMs,
    };
}

/**
 * @function waitForMockWorkbench
 * @description 打开带大量 editor fixture 的 mock 工作台并等待主布局可交互。
 * @param page Playwright 页面对象。
 * @returns Promise<void>。
 */
async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: "首页" }).first().waitFor({ state: "visible" });
}

/**
 * @function expandMockNotes
 * @description 展开 mock 文件树中的 notes 目录。
 * @param page Playwright 页面对象。
 * @returns Promise<void>。
 */
async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

/**
 * @function openMockNote
 * @description 从 mock 文件树打开指定笔记并等待 tab 出现。
 * @param page Playwright 页面对象。
 * @param relativePath mock vault 内的相对路径。
 * @returns Promise<void>。
 */
async function openMockNote(page: Page, relativePath: string): Promise<void> {
    const fileName = relativePath.split("/").pop() ?? relativePath;
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: fileName }).first().waitFor({ state: "visible" });
}

/**
 * @function dragLocatorToPoint
 * @description 使用真实鼠标将 locator 拖到目标坐标。
 * @param page Playwright 页面对象。
 * @param locator 拖拽源元素。
 * @param targetX 目标 x 坐标。
 * @param targetY 目标 y 坐标。
 * @returns Promise<void>。
 */
async function dragLocatorToPoint(
    page: Page,
    locator: Locator,
    targetX: number,
    targetY: number,
    readDestroyLogCount: () => number,
): Promise<SplitInteractionTiming> {
    const sourceBounds = await locator.boundingBox();
    if (!sourceBounds) {
        throw new Error("dragLocatorToPoint: source bounds missing");
    }

    const gestureStartedAt = performance.now();
    const initialDestroyLogCount = readDestroyLogCount();
    await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2);
    await page.mouse.down();

    const pointerMoveStartedAt = performance.now();
    await page.mouse.move(targetX, targetY, { steps: 16 });
    const pointerMoveDurationMs = Number((performance.now() - pointerMoveStartedAt).toFixed(3));
    const destroyLogCountAfterPointerMove = readDestroyLogCount();

    const pointerUpStartedAt = performance.now();
    await page.mouse.up();
    const pointerUpDispatchDurationMs = Number((performance.now() - pointerUpStartedAt).toFixed(3));
    const destroyLogCountAfterPointerUp = readDestroyLogCount();

    const postDropSettleStartedAt = performance.now();
    await expect(page.locator(".layout-v2-tab-section")).toHaveCount(2);
    await expect(page.locator(LIVE_EDITOR_SELECTOR)).toHaveCount(2);
    const postDropSettleDurationMs = Number((performance.now() - postDropSettleStartedAt).toFixed(3));
    const destroyLogCountAfterPostDropSettle = readDestroyLogCount();

    return {
        totalGestureDurationMs: Number((performance.now() - gestureStartedAt).toFixed(3)),
        pointerMoveDurationMs,
        pointerUpDispatchDurationMs,
        postDropSettleDurationMs,
        pointerMoveDestroyLogCount: destroyLogCountAfterPointerMove - initialDestroyLogCount,
        pointerUpDestroyLogCount: destroyLogCountAfterPointerUp - destroyLogCountAfterPointerMove,
        postDropSettleDestroyLogCount: destroyLogCountAfterPostDropSettle - destroyLogCountAfterPointerUp,
    };
}

/**
 * @function measureSplitActiveTabToRight
 * @description 将当前 active tab 拖到主内容区右侧创建 split，并细分拖拽、pointerup 与 drop 后稳定耗时。
 * @param page Playwright 页面对象。
 * @param tabTitle 要 split 的 tab 标题。
 * @param readDestroyLogCount 读取当前 EditorView 销毁日志数量。
 * @returns split 交互分阶段耗时与销毁日志计数。
 */
async function measureSplitActiveTabToRight(
    page: Page,
    tabTitle: string,
    readDestroyLogCount: () => number,
): Promise<SplitInteractionTiming> {
    const sourceTab = page.locator(".layout-v2-tab-section__tab-main", { hasText: tabTitle }).first();
    const targetContent = page.locator(".layout-v2-tab-section__content").first();
    const targetBounds = await targetContent.boundingBox();
    if (!targetBounds) {
        throw new Error("measureSplitActiveTabToRight: target bounds missing");
    }

    return dragLocatorToPoint(
        page,
        sourceTab,
        targetBounds.x + targetBounds.width - 16,
        targetBounds.y + targetBounds.height / 2,
        readDestroyLogCount,
    );
}

/**
 * @function measureSplitWithManyEditorTabs
 * @description 打开大量 editor tab 后执行一次向右 split 并采集性能数据。
 * @param page Playwright 页面对象。
 * @param editorDestroyLogs 测试期间采集到的 EditorView 销毁日志数组。
 * @returns split 性能测量结果。
 */
async function measureSplitWithManyEditorTabs(
    page: Page,
    editorDestroyLogs: string[],
): Promise<SplitMeasurement> {
    await waitForMockWorkbench(page);
    await expandMockNotes(page);

    const openStartedAt = performance.now();
    for (const notePath of PERF_NOTE_PATHS) {
        await openMockNote(page, notePath);
    }
    const openDurationMs = Number((performance.now() - openStartedAt).toFixed(3));
    const activeTabTitle = PERF_NOTE_PATHS[PERF_NOTE_PATHS.length - 1].split("/").pop() ?? "";

    await expect(page.locator(".layout-v2-tab-section__tab-main", { hasText: activeTabTitle })).toBeVisible();
    const editorCountBeforeSplit = await page.locator(LIVE_EDITOR_SELECTOR).count();
    const destroyLogCountBeforeSplit = editorDestroyLogs.length;
    const longTasksBeforeSplit = await readLongTaskSnapshot(page);
    const splitTiming = await measureSplitActiveTabToRight(page, activeTabTitle, () => editorDestroyLogs.length);
    const longTasksAfterSplit = await readLongTaskSnapshot(page);

    return {
        openDurationMs,
        splitDurationMs: splitTiming.postDropSettleDurationMs,
        splitTotalGestureDurationMs: splitTiming.totalGestureDurationMs,
        splitPointerMoveDurationMs: splitTiming.pointerMoveDurationMs,
        splitPointerUpDispatchDurationMs: splitTiming.pointerUpDispatchDurationMs,
        splitPostDropSettleDurationMs: splitTiming.postDropSettleDurationMs,
        editorCountBeforeSplit,
        editorCountAfterSplit: await page.locator(LIVE_EDITOR_SELECTOR).count(),
        tabSectionCountAfterSplit: await page.locator(".layout-v2-tab-section").count(),
        editorDestroyLogCountDuringSplit: editorDestroyLogs.length - destroyLogCountBeforeSplit,
        editorDestroyLogCountDuringPointerMove: splitTiming.pointerMoveDestroyLogCount,
        editorDestroyLogCountDuringPointerUp: splitTiming.pointerUpDestroyLogCount,
        editorDestroyLogCountDuringPostDropSettle: splitTiming.postDropSettleDestroyLogCount,
        longTaskDeltaDuringSplit: diffLongTaskSnapshot(longTasksBeforeSplit, longTasksAfterSplit),
    };
}

/**
 * @function toDerivedMetrics
 * @description 将 split 测量结果转换为性能报告使用的派生指标。
 * @param measurement split 测量结果。
 * @returns 性能指标数组。
 */
function toDerivedMetrics(measurement: SplitMeasurement): BrowserPerfMetricRecord[] {
    const details = {
        dataset: `${MANY_EDITOR_TAB_COUNT}-editor-tabs`,
        editorTabCount: MANY_EDITOR_TAB_COUNT,
        editorCountBeforeSplit: measurement.editorCountBeforeSplit,
        editorCountAfterSplit: measurement.editorCountAfterSplit,
        tabSectionCountAfterSplit: measurement.tabSectionCountAfterSplit,
        editorDestroyLogCountDuringSplit: measurement.editorDestroyLogCountDuringSplit,
        editorDestroyLogCountDuringPointerMove: measurement.editorDestroyLogCountDuringPointerMove,
        editorDestroyLogCountDuringPointerUp: measurement.editorDestroyLogCountDuringPointerUp,
        editorDestroyLogCountDuringPostDropSettle: measurement.editorDestroyLogCountDuringPostDropSettle,
        maxExpectedSplitEditorDestroyLogs: MAX_EXPECTED_SPLIT_EDITOR_DESTROY_LOGS,
        splitTotalGestureDurationMs: measurement.splitTotalGestureDurationMs,
        splitPointerMoveDurationMs: measurement.splitPointerMoveDurationMs,
        splitPointerUpDispatchDurationMs: measurement.splitPointerUpDispatchDurationMs,
        splitPostDropSettleDurationMs: measurement.splitPostDropSettleDurationMs,
        splitLongTaskCount: measurement.longTaskDeltaDuringSplit.count,
        splitLongTaskTotalDurationMs: measurement.longTaskDeltaDuringSplit.totalDurationMs,
        splitLongTaskMaxDurationMs: measurement.longTaskDeltaDuringSplit.maxDurationMs,
    };

    return [
        {
            schemaVersion: "ofive.perf.metric.v1",
            name: "frontend.flow.open-many-editor-tabs",
            category: "playwright-derived",
            status: "ok",
            runtime: "node",
            durationMs: measurement.openDurationMs,
            details,
        },
        {
            schemaVersion: "ofive.perf.metric.v1",
            name: "frontend.flow.split-with-many-editor-tabs",
            category: "playwright-derived",
            status: measurement.editorDestroyLogCountDuringSplit <= MAX_EXPECTED_SPLIT_EDITOR_DESTROY_LOGS ? "ok" : "warn",
            runtime: "node",
            durationMs: measurement.splitDurationMs,
            details,
        },
    ];
}

test.describe("大量 editor tab split 性能", () => {
    test.setTimeout(120_000);

    test("打开 24 个 editor tab 后 split 应保持低挂载量并输出性能报告", async ({ page }) => {
        const pageErrors: string[] = [];
        const editorDestroyLogs: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });
        page.on("console", (message) => {
            const text = message.text();
            if (text.includes("EditorView safely destroyed")) {
                editorDestroyLogs.push(text);
            }
        });

        await installLongTaskRecorder(page);
        const measurement = await measureSplitWithManyEditorTabs(page, editorDestroyLogs);
        console.info("[editor-split-many-tabs-perf]", JSON.stringify(measurement));

        const browserMetrics = await readPerfMetrics(page);
        await writeFrontendPerfReport("frontend-editor-split-many-tabs.json", {
            schemaVersion: "ofive.perf.report.v1",
            generatedAt: new Date().toISOString(),
            suite: "frontend-editor-split-many-tabs",
            metrics: browserMetrics,
            derived: toDerivedMetrics(measurement),
        });

        expect(measurement.editorCountBeforeSplit).toBe(1);
        expect(measurement.editorCountAfterSplit).toBe(2);
        expect(measurement.tabSectionCountAfterSplit).toBe(2);
        expect(measurement.editorDestroyLogCountDuringSplit).toBeLessThanOrEqual(MAX_EXPECTED_SPLIT_EDITOR_DESTROY_LOGS);
        expect(pageErrors).toEqual([]);
    });
});