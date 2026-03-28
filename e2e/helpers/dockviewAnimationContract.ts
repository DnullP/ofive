/**
 * @module e2e/helpers/dockviewAnimationContract
 * @description Dockview 动画测试的工程契约辅助模块。
 *
 * 契约要求：
 * 1. 动画测试必须依赖实际埋点（observations、timeline、layout snapshot）。
 * 2. 拖拽类动画默认优先使用真实鼠标路径，仅在显式指定时才退回 synthetic DragEvent。
 * 3. 每个场景都要产出结构化报告，记录布局变化、动画播放结果与关键时序。
 *
 * @dependencies
 *   - @playwright/test
 *   - ./dockviewAnimation
 *   - ./dockviewDrag
 *
 * @example
 *   const report = await runDockviewDragAnimationContract(page, testInfo, {
 *     scenario: "guide-self-left-split",
 *     source: page.locator(".dv-tab", { hasText: "guide.md" }).first(),
 *     target: page.locator(".dv-groupview", { has: page.locator(".dv-tab", { hasText: "guide.md" }) }).first(),
 *     targetOffset: { x: 0.08, y: 0.5 },
 *   });
 */

import type { Locator, Page, TestInfo } from "@playwright/test";
import {
    clearDockviewAnimationObservations,
    clearDockviewTimelineEntries,
    getDockviewAnimationObservations,
    getDockviewLayoutSnapshot,
    getDockviewTimelineEntries,
    waitForDockviewAnimationsToSettle,
    type DockviewLayoutAnimationObservation,
    type DockviewLayoutSnapshot,
    type DockviewLayoutTimelineEntry,
} from "./dockviewAnimation";
import {
    dockviewDragPanel,
    dockviewMouseDragPanel,
    type DockviewDragTargetOffset,
    type DockviewMouseDragOptions,
} from "./dockviewDrag";

/** 拖拽审计的交互模式。 */
export type DockviewDragInteractionMode = "mouse" | "synthetic";

/**
 * @interface DockviewAnimationContractReport
 * @description 单个 Dockview 动画场景的标准化报告。
 */
export interface DockviewAnimationContractReport {
    scenario: string;
    interactionMode: DockviewDragInteractionMode | "programmatic";
    didPlay: boolean;
    lastPlayStatus: DockviewLayoutAnimationObservation["status"] | null;
    layoutChanged: boolean;
    beforeLayout: DockviewLayoutSnapshot;
    afterLayout: DockviewLayoutSnapshot;
    observations: DockviewLayoutAnimationObservation[];
    timeline: DockviewLayoutTimelineEntry[];
}

/**
 * @interface DockviewDragAnimationContractOptions
 * @description Dockview 拖拽动画契约执行参数。
 */
export interface DockviewDragAnimationContractOptions {
    scenario: string;
    source: Locator;
    target: Locator;
    targetOffset?: DockviewDragTargetOffset;
    interactionMode?: DockviewDragInteractionMode;
    mouseOptions?: DockviewMouseDragOptions;
    settleMs?: number;
}

/**
 * @function sortDockviewLayoutGroups
 * @description 按 top/left 稳定排序 Dockview group 快照。
 * @param layout Dockview 布局快照。
 * @returns 排序后的 group 列表。
 */
export function sortDockviewLayoutGroups(layout: DockviewLayoutSnapshot) {
    return [...layout.groups].sort((left, right) => {
        if (Math.abs(left.top - right.top) > 6) {
            return left.top - right.top;
        }

        return left.left - right.left;
    });
}

/**
 * @function createDockviewLayoutSignature
 * @description 为 Dockview 布局生成稳定签名，用于判定是否发生布局变化。
 * @param layout Dockview 布局快照。
 * @returns 布局签名。
 */
export function createDockviewLayoutSignature(layout: DockviewLayoutSnapshot): string {
    return sortDockviewLayoutGroups(layout).map((group) => {
        return [
            Math.round(group.left),
            Math.round(group.top),
            group.tabLabels.join("|"),
        ].join(":");
    }).join("/");
}

/**
 * @function countPlayedDockviewAnimationObservations
 * @description 统计动画观测中成功播放的次数。
 * @param observations 动画观测记录。
 * @returns played 状态数量。
 */
export function countPlayedDockviewAnimationObservations(
    observations: DockviewLayoutAnimationObservation[],
): number {
    return observations.filter((item) => item.phase === "play" && item.status === "played").length;
}

/**
 * @function emitDockviewAnimationContractReport
 * @description 输出标准化动画场景报告，并附加到 Playwright 测试结果中。
 * @param testInfo 当前测试上下文。
 * @param report 动画场景报告。
 */
export async function emitDockviewAnimationContractReport(
    testInfo: TestInfo,
    report: DockviewAnimationContractReport,
): Promise<void> {
    await testInfo.attach(`${report.scenario}.animation-report.json`, {
        body: Buffer.from(JSON.stringify(report, null, 2), "utf8"),
        contentType: "application/json",
    });

    console.info("[dockview-animation-contract]", {
        scenario: report.scenario,
        interactionMode: report.interactionMode,
        didPlay: report.didPlay,
        lastPlayStatus: report.lastPlayStatus,
        layoutChanged: report.layoutChanged,
        beforeGroupCount: report.beforeLayout.groups.length,
        afterGroupCount: report.afterLayout.groups.length,
        observations: report.observations.map((item) => ({
            phase: item.phase,
            status: item.status,
            source: item.source,
        })),
        timeline: report.timeline.map((item) => ({
            type: item.type,
            pendingAnimationId: item.pendingAnimationId,
            groupCount: item.groupCount,
        })),
    });
}

/**
 * @function runDockviewAnimationContract
 * @description 执行一个标准化 Dockview 动画场景，并采集完整报告。
 * @param page Playwright 页面对象。
 * @param testInfo 当前测试上下文。
 * @param scenario 场景标识。
 * @param interactionMode 交互模式。
 * @param action 执行动作。
 * @param settleMs 动作完成后的采样等待时长。
 * @returns 标准化场景报告。
 */
export async function runDockviewAnimationContract(
    page: Page,
    testInfo: TestInfo,
    scenario: string,
    interactionMode: DockviewAnimationContractReport["interactionMode"],
    action: () => Promise<void>,
    settleMs = 900,
): Promise<DockviewAnimationContractReport> {
    await waitForDockviewAnimationsToSettle(page);
    const beforeLayout = await getDockviewLayoutSnapshot(page);

    await clearDockviewAnimationObservations(page);
    await clearDockviewTimelineEntries(page);
    await action();
    await page.waitForTimeout(settleMs);

    const observations = await getDockviewAnimationObservations(page);
    const timeline = await getDockviewTimelineEntries(page);
    const afterLayout = await getDockviewLayoutSnapshot(page);
    const playObservations = observations.filter((item) => item.phase === "play");
    const lastPlay = playObservations.at(-1) ?? null;

    const report: DockviewAnimationContractReport = {
        scenario,
        interactionMode,
        didPlay: playObservations.some((item) => item.status === "played"),
        lastPlayStatus: lastPlay?.status ?? null,
        layoutChanged: createDockviewLayoutSignature(beforeLayout) !== createDockviewLayoutSignature(afterLayout),
        beforeLayout,
        afterLayout,
        observations,
        timeline,
    };

    await emitDockviewAnimationContractReport(testInfo, report);
    return report;
}

/**
 * @function runDockviewDragAnimationContract
 * @description 按统一契约执行 Dockview 拖拽动画场景。
 * @param page Playwright 页面对象。
 * @param testInfo 当前测试上下文。
 * @param options 拖拽场景参数。
 * @returns 标准化场景报告。
 */
export async function runDockviewDragAnimationContract(
    page: Page,
    testInfo: TestInfo,
    options: DockviewDragAnimationContractOptions,
): Promise<DockviewAnimationContractReport> {
    const interactionMode = options.interactionMode ?? "mouse";

    return runDockviewAnimationContract(
        page,
        testInfo,
        options.scenario,
        interactionMode,
        async () => {
            if (interactionMode === "mouse") {
                await dockviewMouseDragPanel(
                    page,
                    options.source,
                    options.target,
                    options.targetOffset,
                    options.mouseOptions,
                );
                return;
            }

            await dockviewDragPanel(
                page,
                options.source,
                options.target,
                options.targetOffset,
            );
        },
        options.settleMs ?? 1100,
    );
}
