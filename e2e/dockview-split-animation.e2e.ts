/**
 * @module e2e/dockview-split-animation.e2e
 * @description Dockview split 动画触发审计测试。
 *
 * 本文件的目标不是立即修复所有 split 动画缺口，而是先把不同方向、
 * 不同布局下“动作是否成功”和“动画是否被检测到”都变成可审计结果。
 *
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/dockviewAnimation
 *   - ./helpers/dockviewDrag
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
    activateMockTab,
    clearDockviewTabReorderAuditEntries,
    getDockviewAnimationObservations,
    getDockviewTimelineEntries,
    getDockviewLayoutSnapshot,
    getDockviewTabReorderAuditEntries,
    openMockSplitTab,
    runDockviewAnimationAudit,
    waitForDockviewAnimationsToSettle,
    waitForMockDockviewDebugApi,
} from "./helpers/dockviewAnimation";
import {
    countPlayedDockviewAnimationObservations,
    runDockviewDragAnimationContract,
    sortDockviewLayoutGroups,
} from "./helpers/dockviewAnimationContract";
import {
    dockviewDragPanel,
    dockviewMouseDragPanel,
    type DockviewDragTargetOffset,
    type DockviewMouseDragOptions,
} from "./helpers/dockviewDrag";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const IS_LINUX = process.platform === "linux";
const MOUSE_DRAG_TAG = "@mouse-drag";

/**
 * @function waitForDockviewReady
 * @description 等待主区 Dockview 进入可操作状态。
 * @param page Playwright 页面对象。
 */
async function waitForDockviewReady(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await page.locator("[data-testid='main-dockview-host']").waitFor({ state: "visible" });
    await page.locator(".dv-tab", { hasText: "首页" }).waitFor({ state: "visible" });
    await waitForMockDockviewDebugApi(page);
}

/**
 * @function openMockGuideTabFromFileTree
 * @description 从 mock 文件树展开目录并打开 guide.md。
 * @param page Playwright 页面对象。
 */
async function openMockGuideTabFromFileTree(page: Page): Promise<void> {
    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes/guide.md']").click();
    await page.locator(".dv-tab", { hasText: "guide.md" }).waitFor({ state: "visible" });
}

/**
 * @function openMockLatexTabFromFileTree
 * @description 从 mock 文件树打开 latex-test.md，构造主区同组多 tab 场景。
 * @param page Playwright 页面对象。
 */
async function openMockLatexTabFromFileTree(page: Page): Promise<void> {
    await page.locator(".tree-item[data-tree-path='test-resources/notes/latex-test.md']").click();
    await page.locator(".dv-tab", { hasText: "latex-test.md" }).waitFor({ state: "visible" });
}

/**
 * @function getGroupByTabLabel
 * @description 根据 tab 文本定位所属 group。
 * @param page Playwright 页面对象。
 * @param label tab 文本。
 * @returns group 定位器。
 */
function getGroupByTabLabel(page: Page, label: string): Locator {
    return page.locator(".dv-groupview", {
        has: page.locator(".dv-tab", { hasText: label }),
    }).first();
}

/**
 * @function readSortedGroups
 * @description 读取并按 top/left 顺序排序当前布局 groups。
 * @param page Playwright 页面对象。
 * @returns 排序后的 group 快照。
 */
async function readSortedGroups(page: Page) {
    const snapshot = await getDockviewLayoutSnapshot(page);
    return [...snapshot.groups].sort((left, right) => {
        if (Math.abs(left.top - right.top) > 6) {
            return left.top - right.top;
        }

        return left.left - right.left;
    });
}

/**
 * @function createLayoutSignature
 * @description 将当前布局压缩为便于比较的签名字符串。
 * @param groups group 快照。
 * @returns 布局签名。
 */
function createLayoutSignature(
    groups: Array<{ left: number; top: number; tabLabels: string[] }>,
): string {
    return groups.map((group) => {
        return [
            Math.round(group.left),
            Math.round(group.top),
            group.tabLabels.join("|"),
        ].join(":");
    }).join("/");
}

/**
 * @function findGroupByTabLabel
 * @description 在 group 快照中查找包含指定 tab 的 group。
 * @param groups group 快照。
 * @param label tab 文本。
 * @returns 命中的 group，未命中返回 null。
 */
function findGroupByTabLabel(
    groups: Array<{ left: number; top: number; tabLabels: string[] }>,
    label: string,
): { left: number; top: number; tabLabels: string[] } | null {
    return groups.find((group) => group.tabLabels.includes(label)) ?? null;
}

/**
 * @function isHorizontalLayout
 * @description 判断两组布局是否主要呈左右排布。
 * @param groups group 快照。
 * @returns 若是左右排布则返回 true。
 */
function isHorizontalLayout(groups: Array<{ left: number; top: number }>): boolean {
    if (groups.length < 2) {
        return false;
    }

    return Math.abs(groups[0].left - groups[1].left) > 40 && Math.abs(groups[0].top - groups[1].top) < 40;
}

/**
 * @function isVerticalLayout
 * @description 判断两组布局是否主要呈上下排布。
 * @param groups group 快照。
 * @returns 若是上下排布则返回 true。
 */
function isVerticalLayout(groups: Array<{ left: number; top: number }>): boolean {
    if (groups.length < 2) {
        return false;
    }

    return Math.abs(groups[0].top - groups[1].top) > 40 && Math.abs(groups[0].left - groups[1].left) < 40;
}

/**
 * @function logAuditResult
 * @description 将当前场景的动画审计结果输出到测试日志。
 * @param scenario 场景名。
 * @param result 审计结果。
 */
function logAuditResult(
    scenario: string,
    result: {
        didPlay: boolean;
        lastPlayStatus: string | null;
        layoutChanged?: boolean;
        observations: Array<{ phase: string; status: string; source: string }>;
        layout: { groups: Array<{ tabLabels: string[]; left: number; top: number }> };
    },
    extras: Record<string, unknown> = {},
): void {
    console.info("[dockview-animation-audit]", {
        scenario,
        didPlay: result.didPlay,
        lastPlayStatus: result.lastPlayStatus,
        layoutChanged: result.layoutChanged ?? null,
        observations: result.observations,
        groups: result.layout.groups.map((group) => ({
            tabLabels: group.tabLabels,
            left: Math.round(group.left),
            top: Math.round(group.top),
        })),
        ...extras,
    });
}

interface ManualDragAuditScenario {
    scenario: string;
    setup: (page: Page) => Promise<void>;
    sourceLabel: string;
    targetLabel: string;
    targetOffset: DockviewDragTargetOffset;
    interactionMode?: "synthetic" | "mouse";
    mouseOptions?: DockviewMouseDragOptions;
    settleMs?: number;
}

interface ManualDragAuditSummary {
    audit: Awaited<ReturnType<typeof runDockviewAnimationAudit>>;
    beforeGroups: Awaited<ReturnType<typeof readSortedGroups>>;
    afterGroups: Awaited<ReturnType<typeof readSortedGroups>>;
    layoutChanged: boolean;
}

interface TopEdgeSwapAttemptResult extends ManualDragAuditSummary {
    swapHappened: boolean;
    attempt: number;
}

interface TopEdgeSwapAttempt {
    targetOffset: DockviewDragTargetOffset;
    mouseOptions: DockviewMouseDragOptions;
    useVerticalAnchorSnap?: boolean;
    approachTarget?: "header" | "group";
    useSyntheticFallback?: boolean;
}

type DockviewVerticalEdge = "top" | "bottom";

interface ManualDragRetryAttempt {
    targetOffset?: DockviewDragTargetOffset;
    mouseOptions?: DockviewMouseDragOptions;
    settleMs?: number;
}

interface ManualDragRetryResult extends ManualDragAuditSummary {
    attempt: number;
}

/**
 * @function dockviewMouseDragPanelToVerticalEdgeAnchor
 * @description 在垂直边缘场景中，先把鼠标拖到目标边缘附近，再在可见时吸附到 Dockview 垂直 drop anchor 中心点释放。
 * @param page Playwright 页面对象。
 * @param source 拖拽源 tab。
 * @param approachTarget 用于靠近目标边缘的定位器。
 * @param targetGroup 目标 group。
 * @param edge 目标垂直边缘。
 * @param options 鼠标拖拽节奏控制参数。
 */
async function dockviewMouseDragPanelToVerticalEdgeAnchor(
    page: Page,
    source: Locator,
    approachTarget: Locator,
    targetGroup: Locator,
    edge: DockviewVerticalEdge,
    options: DockviewMouseDragOptions,
): Promise<void> {
    await source.waitFor({ state: "visible" });
    await approachTarget.waitFor({ state: "visible" });
    await targetGroup.waitFor({ state: "visible" });

    const sourceBox = await source.boundingBox();
    const approachBox = await approachTarget.boundingBox();
    const groupBox = await targetGroup.boundingBox();
    if (!sourceBox || !approachBox || !groupBox) {
        throw new Error("dockviewMouseDragPanelToVerticalEdgeAnchor: source or target boundingBox is null");
    }

    const srcX = sourceBox.x + sourceBox.width / 2;
    const srcY = sourceBox.y + sourceBox.height / 2;
    const targetX = approachBox.x + approachBox.width / 2;
    const edgeInset = Math.min(Math.max(groupBox.height * 0.03, 4), 18);
    const targetY = edge === "top"
        ? approachBox.y + Math.min(Math.max(approachBox.height * 0.08, 2), 8)
        : groupBox.y + groupBox.height - edgeInset;
    const finalHoverRepeats = options.finalHoverRepeats ?? 10;
    const finalHoverDelayMs = options.finalHoverDelayMs ?? 64;
    const settleDelayMs = options.settleDelayMs ?? 560;
    const expectedEdgeY = edge === "top"
        ? groupBox.y + edgeInset
        : groupBox.y + groupBox.height - edgeInset;
    const waypoints = [0.12, 0.28, 0.48, 0.7, 0.88, 1].map((progress) => ({
        x: srcX + (targetX - srcX) * progress,
        y: srcY + (targetY - srcY) * progress,
    }));

    const resolveVerticalAnchorPoint = async (): Promise<{ x: number; y: number } | null> => {
        return page.evaluate(({ expectedLeft, expectedRight, expectedEdge, expectedCenterX, edgeDirection, maxAnchorHeight }) => {
            const candidates = Array.from(
                document.querySelectorAll<HTMLElement>(".dv-drop-target-anchor, .dv-drop-target-dropzone"),
            ).map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                };
            }).filter((candidate) => {
                const verticalMatch = edgeDirection === "top"
                    ? candidate.top <= expectedEdge + 28 && candidate.bottom >= expectedEdge - 6
                    : candidate.bottom >= expectedEdge - 28 && candidate.top <= expectedEdge + 6;
                const isThinHorizontalZone = candidate.height <= maxAnchorHeight;
                return candidate.width > 8
                    && candidate.height > 8
                    && isThinHorizontalZone
                    && candidate.x >= expectedLeft + 12
                    && candidate.x <= expectedRight - 12
                    && verticalMatch;
            });

            if (candidates.length === 0) {
                return null;
            }

            candidates.sort((left, right) => {
                const leftScore = Math.abs(left.x - expectedCenterX) + Math.abs(left.y - expectedEdge) * 2;
                const rightScore = Math.abs(right.x - expectedCenterX) + Math.abs(right.y - expectedEdge) * 2;
                return leftScore - rightScore;
            });

            const best = candidates[0];
            return best ? { x: best.x, y: best.y } : null;
        }, {
            expectedLeft: groupBox.x,
            expectedRight: groupBox.x + groupBox.width,
            expectedEdge: expectedEdgeY,
            expectedCenterX: groupBox.x + groupBox.width / 2,
            edgeDirection: edge,
            maxAnchorHeight: Math.max(40, groupBox.height * 0.16),
        });
    };

    await page.mouse.move(srcX, srcY);
    await page.waitForTimeout(16);
    await page.mouse.down();
    await page.mouse.move(srcX + 8, srcY + 4, { steps: 6 });
    await page.waitForTimeout(24);

    for (const point of waypoints) {
        await page.mouse.move(point.x, point.y, { steps: 10 });
        await page.waitForTimeout(20);
    }

    let snappedAnchorPoint: { x: number; y: number } | null = null;
    for (let index = 0; index < finalHoverRepeats; index += 1) {
        const horizontalSweep = index % 3 === 0 ? -6 : index % 3 === 1 ? 0 : 6;
        const hoverX = targetX + horizontalSweep;
        const hoverY = edge === "top"
            ? targetY + (index % 2 === 0 ? 0 : 2)
            : targetY - (index % 2 === 0 ? 0 : 2);
        await page.mouse.move(hoverX, hoverY, { steps: 6 });
        await page.waitForTimeout(finalHoverDelayMs);

        snappedAnchorPoint = await resolveVerticalAnchorPoint();
        if (snappedAnchorPoint) {
            await page.mouse.move(snappedAnchorPoint.x, snappedAnchorPoint.y, { steps: 6 });
            await page.waitForTimeout(finalHoverDelayMs + 24);
            break;
        }
    }

    if (!snappedAnchorPoint) {
        await page.mouse.move(targetX, targetY, { steps: 6 });
        await page.waitForTimeout(finalHoverDelayMs);
    }

    await page.mouse.up();
    await page.waitForTimeout(settleDelayMs);
}

/**
 * @function runManualDragAuditScenario
 * @description 运行一个手动拖拽 split 审计场景，并返回布局变化摘要。
 * @param page Playwright 页面对象。
 * @param scenario 场景定义。
 * @returns 拖拽审计摘要。
 */
async function runManualDragAuditScenario(
    page: Page,
    scenario: ManualDragAuditScenario,
): Promise<ManualDragAuditSummary> {
    await scenario.setup(page);
    await waitForDockviewAnimationsToSettle(page);

    const beforeGroups = await readSortedGroups(page);
    const sourceTab = page.locator(".dv-tab", { hasText: scenario.sourceLabel }).first();
    const targetGroup = getGroupByTabLabel(page, scenario.targetLabel);

    const audit = await runDockviewAnimationAudit(page, async () => {
        if (scenario.interactionMode === "mouse") {
            await dockviewMouseDragPanel(
                page,
                sourceTab,
                targetGroup,
                scenario.targetOffset,
                scenario.mouseOptions,
            );
            return;
        }

        await dockviewDragPanel(page, sourceTab, targetGroup, scenario.targetOffset);
    }, scenario.settleMs ?? 900);

    const afterGroups = await readSortedGroups(page);
    return {
        audit,
        beforeGroups,
        afterGroups,
        layoutChanged: createLayoutSignature(beforeGroups) !== createLayoutSignature(afterGroups),
    };
}

/**
 * @function runManualDragAuditScenarioWithRetry
 * @description 仅在 Linux 下对边缘拖拽场景执行受限重试，避免 CI 偶发误落点，同时保持 macOS 默认路径不变。
 * @param page Playwright 页面对象。
 * @param scenario 基础拖拽场景定义。
 * @param attempts Linux 平台使用的尝试参数列表。
 * @param evaluateSuccess 判断场景是否成功的回调。
 * @returns 包含最终尝试次数的拖拽审计摘要。
 */
async function runManualDragAuditScenarioWithRetry(
    page: Page,
    scenario: ManualDragAuditScenario,
    attempts: ManualDragRetryAttempt[],
    evaluateSuccess: (result: ManualDragAuditSummary) => boolean,
): Promise<ManualDragRetryResult> {
    const effectiveAttempts = IS_LINUX && attempts.length > 0 ? attempts : [{}];
    let lastResult: ManualDragRetryResult | null = null;

    for (const [index, attempt] of effectiveAttempts.entries()) {
        await waitForDockviewReady(page);

        const result = await runManualDragAuditScenario(page, {
            ...scenario,
            targetOffset: attempt.targetOffset ?? scenario.targetOffset,
            mouseOptions: {
                ...scenario.mouseOptions,
                ...attempt.mouseOptions,
            },
            settleMs: attempt.settleMs ?? scenario.settleMs,
        });
        const decoratedResult: ManualDragRetryResult = {
            ...result,
            attempt: index + 1,
        };

        lastResult = decoratedResult;

        if (evaluateSuccess(result)) {
            return decoratedResult;
        }

        console.warn("[dockview-animation-audit-retry]", {
            scenario: scenario.scenario,
            attempt: index + 1,
            didPlay: result.audit.didPlay,
            lastPlayStatus: result.audit.lastPlayStatus,
            layoutChanged: result.layoutChanged,
            groups: result.afterGroups.map((group) => ({
                tabLabels: group.tabLabels,
                left: Math.round(group.left),
                top: Math.round(group.top),
            })),
        });
    }

    if (!lastResult) {
        throw new Error("runManualDragAuditScenarioWithRetry: no attempts executed");
    }

    return lastResult;
}

/**
 * @function runBottomToTopSwapAuditWithRetry
 * @description 对顶部交换场景执行最多两次独立尝试，降低 Linux CI 下偶发落点抖动带来的失败概率。
 * @param page Playwright 页面对象。
 * @returns 包含尝试次数与交换结果的审计摘要。
 */
async function runBottomToTopSwapAuditWithRetry(page: Page): Promise<TopEdgeSwapAttemptResult> {
    const attempts: TopEdgeSwapAttempt[] = [
        {
            targetOffset: { x: 0.5, y: 0.04 } as DockviewDragTargetOffset,
            mouseOptions: {
                finalHoverRepeats: 8,
                finalHoverDelayMs: 56,
                settleDelayMs: 480,
            },
        },
        {
            targetOffset: { x: 0.5, y: 0.02 } as DockviewDragTargetOffset,
            mouseOptions: {
                finalHoverRepeats: 10,
                finalHoverDelayMs: 64,
                settleDelayMs: 560,
            },
            useVerticalAnchorSnap: true,
        },
        {
            targetOffset: { x: 0.5, y: 0.015 } as DockviewDragTargetOffset,
            mouseOptions: {
                finalHoverRepeats: 12,
                finalHoverDelayMs: 72,
                settleDelayMs: 620,
            },
            useVerticalAnchorSnap: true,
        },
        {
            targetOffset: { x: 0.5, y: 0.04 } as DockviewDragTargetOffset,
            mouseOptions: {
                finalHoverRepeats: 12,
                finalHoverDelayMs: 72,
                settleDelayMs: 620,
            },
            useSyntheticFallback: true,
        },
    ];

    let lastResult: TopEdgeSwapAttemptResult | null = null;

    for (const [index, attempt] of attempts.entries()) {
        await waitForDockviewReady(page);
        await openMockSplitTab(page, {
            id: "manual-bottom",
            title: "Manual Bottom",
            component: "split-demo",
            position: "bottom",
        });
        await waitForDockviewAnimationsToSettle(page);

        const beforeGroups = await readSortedGroups(page);
        const sourceTab = page.locator(".dv-tab", { hasText: "Manual Bottom" }).first();
        const targetGroup = getGroupByTabLabel(page, "首页");
        const targetHeader = getGroupByTabLabel(page, "首页")
            .locator(".dv-tabs-and-actions-container")
            .first();

        const audit = await runDockviewAnimationAudit(page, async () => {
            if (attempt.useSyntheticFallback) {
                await dockviewDragPanel(
                    page,
                    sourceTab,
                    targetHeader,
                    attempt.targetOffset,
                );
                return;
            }

            if (attempt.useVerticalAnchorSnap) {
                const approachTarget = attempt.approachTarget === "group" ? targetGroup : targetHeader;
                await dockviewMouseDragPanelToVerticalEdgeAnchor(
                    page,
                    sourceTab,
                    approachTarget,
                    targetGroup,
                    "top",
                    attempt.mouseOptions,
                );
                return;
            }

            await dockviewMouseDragPanel(
                page,
                sourceTab,
                targetHeader,
                attempt.targetOffset,
                attempt.mouseOptions,
            );
        }, 1100);

        const afterGroups = await readSortedGroups(page);
        const homeGroup = findGroupByTabLabel(afterGroups, "首页");
        const bottomGroup = findGroupByTabLabel(afterGroups, "Manual Bottom");
        const swapHappened = Boolean(homeGroup && bottomGroup && bottomGroup.top < homeGroup.top);
        const result: TopEdgeSwapAttemptResult = {
            audit,
            beforeGroups,
            afterGroups,
            layoutChanged: createLayoutSignature(beforeGroups) !== createLayoutSignature(afterGroups),
            swapHappened,
            attempt: index + 1,
        };

        lastResult = result;

        if (swapHappened) {
            return result;
        }

        console.warn("[dockview-animation-audit-retry]", {
            scenario: "manual-bottom-to-top-of-home",
            attempt: index + 1,
            swapHappened,
            didPlay: audit.didPlay,
            lastPlayStatus: audit.lastPlayStatus,
            groups: afterGroups.map((group) => ({
                tabLabels: group.tabLabels,
                left: Math.round(group.left),
                top: Math.round(group.top),
            })),
        });
    }

    if (!lastResult) {
        throw new Error("runBottomToTopSwapAuditWithRetry: no attempts executed");
    }

    return lastResult;
}

/**
 * @function runHomeToBottomSwapAuditWithRetry
 * @description 对底部交换场景执行 Linux 专用受限重试，并在后续尝试中吸附到底部 drop anchor。
 * @param page Playwright 页面对象。
 * @returns 包含尝试次数的审计摘要。
 */
async function runHomeToBottomSwapAuditWithRetry(page: Page): Promise<ManualDragRetryResult> {
    const attempts: TopEdgeSwapAttempt[] = IS_LINUX
        ? [
            {
                targetOffset: { x: 0.5, y: 0.92 },
                mouseOptions: {
                    finalHoverRepeats: 6,
                    finalHoverDelayMs: 44,
                    settleDelayMs: 420,
                },
            },
            {
                targetOffset: { x: 0.5, y: 0.94 },
                mouseOptions: {
                    finalHoverRepeats: 10,
                    finalHoverDelayMs: 64,
                    settleDelayMs: 560,
                },
                useVerticalAnchorSnap: true,
                approachTarget: "group",
            },
            {
                targetOffset: { x: 0.5, y: 0.96 },
                mouseOptions: {
                    finalHoverRepeats: 12,
                    finalHoverDelayMs: 72,
                    settleDelayMs: 620,
                },
                useVerticalAnchorSnap: true,
                approachTarget: "group",
            },
        ]
        : [
            {
                targetOffset: { x: 0.5, y: 0.92 },
                mouseOptions: {
                    finalHoverRepeats: 6,
                    finalHoverDelayMs: 44,
                    settleDelayMs: 420,
                },
            },
        ];

    let lastResult: ManualDragRetryResult | null = null;

    for (const [index, attempt] of attempts.entries()) {
        await waitForDockviewReady(page);
        await openMockSplitTab(page, {
            id: "manual-bottom",
            title: "Manual Bottom",
            component: "split-demo",
            position: "bottom",
        });
        await waitForDockviewAnimationsToSettle(page);

        const beforeGroups = await readSortedGroups(page);
        const sourceTab = page.locator(".dv-tab", { hasText: "首页" }).first();
        const targetGroup = getGroupByTabLabel(page, "Manual Bottom");

        const audit = await runDockviewAnimationAudit(page, async () => {
            if (attempt.useVerticalAnchorSnap) {
                await dockviewMouseDragPanelToVerticalEdgeAnchor(
                    page,
                    sourceTab,
                    targetGroup,
                    targetGroup,
                    "bottom",
                    attempt.mouseOptions,
                );
                return;
            }

            await dockviewMouseDragPanel(
                page,
                sourceTab,
                targetGroup,
                attempt.targetOffset,
                attempt.mouseOptions,
            );
        }, 1200);

        const afterGroups = await readSortedGroups(page);
        const result: ManualDragRetryResult = {
            audit,
            beforeGroups,
            afterGroups,
            layoutChanged: createLayoutSignature(beforeGroups) !== createLayoutSignature(afterGroups),
            attempt: index + 1,
        };
        lastResult = result;

        if (result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")) {
            return result;
        }

        console.warn("[dockview-animation-audit-retry]", {
            scenario: "manual-home-to-bottom-of-bottom",
            attempt: index + 1,
            didPlay: audit.didPlay,
            lastPlayStatus: audit.lastPlayStatus,
            layoutChanged: result.layoutChanged,
            groups: afterGroups.map((group) => ({
                tabLabels: group.tabLabels,
                left: Math.round(group.left),
                top: Math.round(group.top),
            })),
        });
    }

    if (!lastResult) {
        throw new Error("runHomeToBottomSwapAuditWithRetry: no attempts executed");
    }

    return lastResult;
}

/**
 * @function runNestedRightTopToBottomOfLeftColumnAuditWithRetry
 * @description 对嵌套右上到左列底边场景执行 Linux 专用受限重试，并在后续尝试中吸附到底部 drop anchor。
 * @param page Playwright 页面对象。
 * @returns 包含尝试次数的审计摘要。
 */
async function runNestedRightTopToBottomOfLeftColumnAuditWithRetry(page: Page): Promise<ManualDragRetryResult> {
    const setupScenario = async (currentPage: Page): Promise<void> => {
        await openMockSplitTab(currentPage, {
            id: "nested-right-base",
            title: "Nested Right Base",
            component: "split-demo",
            position: "right",
        });
        await waitForDockviewAnimationsToSettle(currentPage);
        await activateMockTab(currentPage, "nested-right-base");
        await openMockSplitTab(currentPage, {
            id: "nested-bottom-right",
            title: "Nested Bottom Right",
            component: "split-demo",
            position: "bottom",
        });
    };

    const attempts = IS_LINUX
        ? [
            {
                mouseOptions: {
                    finalHoverRepeats: 6,
                    finalHoverDelayMs: 44,
                    settleDelayMs: 420,
                },
            },
            {
                mouseOptions: {
                    finalHoverRepeats: 10,
                    finalHoverDelayMs: 64,
                    settleDelayMs: 560,
                },
                settleMs: 1200,
            },
            {
                mouseOptions: {
                    finalHoverRepeats: 12,
                    finalHoverDelayMs: 72,
                    settleDelayMs: 620,
                },
                settleMs: 1260,
            },
        ]
        : [
            {
                mouseOptions: {
                    finalHoverRepeats: 6,
                    finalHoverDelayMs: 44,
                    settleDelayMs: 420,
                },
            },
        ];

    let lastResult: ManualDragRetryResult | null = null;

    for (const [index, attempt] of attempts.entries()) {
        await waitForDockviewReady(page);
        await setupScenario(page);
        await waitForDockviewAnimationsToSettle(page);

        const beforeGroups = await readSortedGroups(page);
        const sourceTab = page.locator(".dv-tab", { hasText: "Nested Right Base" }).first();
        const targetGroup = getGroupByTabLabel(page, "首页");

        const audit = await runDockviewAnimationAudit(page, async () => {
            if (index > 0 && IS_LINUX) {
                await dockviewMouseDragPanelToVerticalEdgeAnchor(
                    page,
                    sourceTab,
                    targetGroup,
                    targetGroup,
                    "bottom",
                    attempt.mouseOptions ?? {},
                );
                return;
            }

            await dockviewMouseDragPanel(
                page,
                sourceTab,
                targetGroup,
                { x: 0.5, y: 0.92 },
                attempt.mouseOptions,
            );
        }, attempt.settleMs ?? 1100);

        const afterGroups = await readSortedGroups(page);
        const result: ManualDragRetryResult = {
            audit,
            beforeGroups,
            afterGroups,
            layoutChanged: createLayoutSignature(beforeGroups) !== createLayoutSignature(afterGroups),
            attempt: index + 1,
        };
        lastResult = result;

        if (
            result.beforeGroups.length === 3
            && result.afterGroups.length === 3
            && result.layoutChanged
            && result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")
        ) {
            return result;
        }

        console.warn("[dockview-animation-audit-retry]", {
            scenario: "nested-right-top-to-bottom-of-left-column",
            attempt: index + 1,
            didPlay: audit.didPlay,
            lastPlayStatus: audit.lastPlayStatus,
            layoutChanged: result.layoutChanged,
            groups: afterGroups.map((group) => ({
                tabLabels: group.tabLabels,
                left: Math.round(group.left),
                top: Math.round(group.top),
            })),
        });
    }

    if (!lastResult) {
        throw new Error("runNestedRightTopToBottomOfLeftColumnAuditWithRetry: no attempts executed");
    }

    return lastResult;
}

test.describe("Dockview split animation audit", () => {
    test.beforeEach(async ({ page }) => {
        await waitForDockviewReady(page);
    });

    for (const direction of ["left", "right", "top", "bottom"] as const) {
        test(`programmatic split should be observable: ${direction}`, async ({ page }) => {
            const result = await runDockviewAnimationAudit(page, async () => {
                await openMockSplitTab(page, {
                    id: `audit-${direction}`,
                    title: `Audit ${direction}`,
                    component: "split-demo",
                    position: direction,
                });
            });

            logAuditResult(`programmatic-${direction}`, {
                ...result,
                observations: result.observations.map((item) => ({
                    phase: item.phase,
                    status: item.status,
                    source: item.source,
                })),
            });

            expect(result.layout.groups.length).toBe(2);
            expect(result.didPlay).toBe(true);
        });
    }

    test("programmatic split should not defer first play until tab click", async ({ page }) => {
        const result = await runDockviewAnimationAudit(page, async () => {
            await openMockSplitTab(page, {
                id: "audit-no-defer",
                title: "Audit No Defer",
                component: "split-demo",
                position: "right",
            });
        }, 950);

        const preClickPlayCount = result.observations.filter((item) => item.phase === "play" && item.status === "played").length;
        await page.locator(".dv-tab", { hasText: "首页" }).first().click();
        await page.waitForTimeout(160);
        const postClickObservations = await getDockviewAnimationObservations(page);
        const postClickPlayCount = postClickObservations.filter((item) => item.phase === "play" && item.status === "played").length;

        logAuditResult("programmatic-no-deferred-click-play", {
            ...result,
            observations: result.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        }, {
            preClickPlayCount,
            postClickPlayCount,
        });

        expect(result.didPlay).toBe(true);
        expect(preClickPlayCount).toBeGreaterThan(0);
        expect(postClickPlayCount).toBe(preClickPlayCount);
    });

    test("programmatic nested split under left column should be observable", async ({ page }) => {
        await openMockSplitTab(page, {
            id: "audit-right-base",
            title: "Audit Right Base",
            component: "split-demo",
            position: "right",
        });
        await waitForDockviewAnimationsToSettle(page);

        await activateMockTab(page, "home");
        const result = await runDockviewAnimationAudit(page, async () => {
            await openMockSplitTab(page, {
                id: "audit-bottom-left",
                title: "Audit Bottom Left",
                component: "split-demo",
                position: "bottom",
            });
        });

        logAuditResult("programmatic-bottom-under-left", {
            ...result,
            observations: result.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        });

        expect(result.layout.groups.length).toBe(3);
        expect(result.didPlay).toBe(true);
    });

    test("programmatic nested split under right column should be observable", async ({ page }) => {
        await openMockSplitTab(page, {
            id: "audit-right-base",
            title: "Audit Right Base",
            component: "split-demo",
            position: "right",
        });
        await waitForDockviewAnimationsToSettle(page);

        await activateMockTab(page, "audit-right-base");
        const result = await runDockviewAnimationAudit(page, async () => {
            await openMockSplitTab(page, {
                id: "audit-bottom-right",
                title: "Audit Bottom Right",
                component: "split-demo",
                position: "bottom",
            });
        });

        logAuditResult("programmatic-bottom-under-right", {
            ...result,
            observations: result.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        });

        expect(result.layout.groups.length).toBe(3);
        expect(result.didPlay).toBe(true);
    });

    test("manual drag audit: right tab to bottom of left group", async ({ page }) => {
        await openMockSplitTab(page, {
            id: "manual-right",
            title: "Manual Right",
            component: "split-demo",
            position: "right",
        });
        await waitForDockviewAnimationsToSettle(page);

        const beforeGroups = await readSortedGroups(page);
        const sourceTab = page.locator(".dv-tab", { hasText: "Manual Right" }).first();
        const targetGroup = getGroupByTabLabel(page, "首页");

        const result = await runDockviewAnimationAudit(page, async () => {
            await dockviewDragPanel(page, sourceTab, targetGroup, { x: 0.5, y: 0.92 });
        }, 900);

        const afterGroups = await readSortedGroups(page);
        const layoutChanged = createLayoutSignature(beforeGroups) !== createLayoutSignature(afterGroups);

        logAuditResult("manual-right-to-bottom-of-left", {
            ...result,
            layoutChanged,
            observations: result.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        });

        expect(afterGroups.length).toBe(2);
        expect(result.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test("manual drag audit: right tab to top of left group", async ({ page }) => {
        await openMockSplitTab(page, {
            id: "manual-right",
            title: "Manual Right",
            component: "split-demo",
            position: "right",
        });
        await waitForDockviewAnimationsToSettle(page);

        const beforeGroups = await readSortedGroups(page);
        const sourceTab = page.locator(".dv-tab", { hasText: "Manual Right" }).first();
        const targetGroup = getGroupByTabLabel(page, "首页");

        const result = await runDockviewAnimationAudit(page, async () => {
            await dockviewDragPanel(page, sourceTab, targetGroup, { x: 0.5, y: 0.08 });
        }, 900);

        const afterGroups = await readSortedGroups(page);
        const layoutChanged = createLayoutSignature(beforeGroups) !== createLayoutSignature(afterGroups);

        logAuditResult("manual-right-to-top-of-left", {
            ...result,
            layoutChanged,
            observations: result.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        });

        expect(afterGroups.length).toBe(2);
        expect(result.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test("manual drag audit: right tab to left edge of home group", async ({ page }) => {
        await openMockSplitTab(page, {
            id: "manual-right",
            title: "Manual Right",
            component: "split-demo",
            position: "right",
        });
        await waitForDockviewAnimationsToSettle(page);

        const beforeGroups = await readSortedGroups(page);
        const sourceTab = page.locator(".dv-tab", { hasText: "Manual Right" }).first();
        const targetGroup = getGroupByTabLabel(page, "首页");

        const result = await runDockviewAnimationAudit(page, async () => {
            await dockviewDragPanel(page, sourceTab, targetGroup, { x: 0.08, y: 0.5 });
        }, 900);

        const afterGroups = await readSortedGroups(page);
        const layoutChanged = createLayoutSignature(beforeGroups) !== createLayoutSignature(afterGroups);

        logAuditResult("manual-right-to-left-of-home", {
            ...result,
            layoutChanged,
            observations: result.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        });

        expect(afterGroups.length).toBe(2);
        expect(result.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test("manual drag audit: bottom tab to right of top group", async ({ page }) => {
        await openMockSplitTab(page, {
            id: "manual-bottom",
            title: "Manual Bottom",
            component: "split-demo",
            position: "bottom",
        });
        await waitForDockviewAnimationsToSettle(page);

        const beforeGroups = await readSortedGroups(page);
        const sourceTab = page.locator(".dv-tab", { hasText: "Manual Bottom" }).first();
        const targetGroup = getGroupByTabLabel(page, "首页");

        const result = await runDockviewAnimationAudit(page, async () => {
            await dockviewDragPanel(page, sourceTab, targetGroup, { x: 0.92, y: 0.5 });
        }, 900);

        const afterGroups = await readSortedGroups(page);
        const layoutChanged = createLayoutSignature(beforeGroups) !== createLayoutSignature(afterGroups);

        logAuditResult("manual-bottom-to-right-of-home", {
            ...result,
            layoutChanged,
            observations: result.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        });

        expect(afterGroups.length).toBe(2);
        expect(result.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test(`manual drag audit: left tab to right edge of right group should expose swap case ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        const result = await runManualDragAuditScenario(page, {
            scenario: "manual-home-to-right-of-right",
            setup: async (currentPage) => {
                await openMockSplitTab(currentPage, {
                    id: "manual-right",
                    title: "Manual Right",
                    component: "split-demo",
                    position: "right",
                });
            },
            sourceLabel: "首页",
            targetLabel: "Manual Right",
            targetOffset: { x: 0.92, y: 0.5 },
            interactionMode: "mouse",
            settleMs: 1100,
        });

        const homeGroup = findGroupByTabLabel(result.afterGroups, "首页");
        const rightGroup = findGroupByTabLabel(result.afterGroups, "Manual Right");
        const swapHappened = Boolean(homeGroup && rightGroup && homeGroup.left > rightGroup.left);

        logAuditResult("manual-home-to-right-of-right", {
            ...result.audit,
            layoutChanged: result.layoutChanged,
            observations: result.audit.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        }, {
            swapHappened,
            beforeHorizontal: isHorizontalLayout(result.beforeGroups),
            afterHorizontal: isHorizontalLayout(result.afterGroups),
        });

        expect(result.afterGroups.length).toBe(2);
        expect(result.layoutChanged).toBe(true);
        expect(result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test(`manual drag audit: bottom tab to top edge of home should expose vertical swap edge ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        const result = await runBottomToTopSwapAuditWithRetry(page);

        logAuditResult("manual-bottom-to-top-of-home", {
            ...result.audit,
            layoutChanged: result.layoutChanged,
            observations: result.audit.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        }, {
            swapHappened: result.swapHappened,
            attempt: result.attempt,
            beforeVertical: isVerticalLayout(result.beforeGroups),
            afterVertical: isVerticalLayout(result.afterGroups),
        });

        expect(result.afterGroups.length).toBe(2);
        expect(result.swapHappened).toBe(true);
        expect(result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
        expect(result.audit.didPlay).toBe(true);
    });

    test(`manual drag audit: home tab to bottom edge of bottom group should expose reverse vertical swap ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        const result = await runHomeToBottomSwapAuditWithRetry(page);

        const homeGroup = findGroupByTabLabel(result.afterGroups, "首页");
        const bottomGroup = findGroupByTabLabel(result.afterGroups, "Manual Bottom");
        const swapHappened = Boolean(homeGroup && bottomGroup && homeGroup.top > bottomGroup.top);

        logAuditResult("manual-home-to-bottom-of-bottom", {
            ...result.audit,
            layoutChanged: result.layoutChanged,
            observations: result.audit.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        }, {
            swapHappened,
            attempt: result.attempt,
            beforeVertical: isVerticalLayout(result.beforeGroups),
            afterVertical: isVerticalLayout(result.afterGroups),
        });

        expect(result.afterGroups.length).toBe(2);
        expect(result.layoutChanged).toBe(true);
        expect(result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test(`manual drag audit: nested left-bottom tab to right edge of right column ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        const result = await runManualDragAuditScenarioWithRetry(
            page,
            {
            scenario: "nested-left-bottom-to-right-column-edge",
            setup: async (currentPage) => {
                await openMockSplitTab(currentPage, {
                    id: "nested-right-base",
                    title: "Nested Right Base",
                    component: "split-demo",
                    position: "right",
                });
                await waitForDockviewAnimationsToSettle(currentPage);
                await activateMockTab(currentPage, "home");
                await openMockSplitTab(currentPage, {
                    id: "nested-bottom-left",
                    title: "Nested Bottom Left",
                    component: "split-demo",
                    position: "bottom",
                });
            },
            sourceLabel: "Nested Bottom Left",
            targetLabel: "Nested Right Base",
            targetOffset: { x: 0.92, y: 0.5 },
            interactionMode: "mouse",
            settleMs: 1100,
            },
            [
                {
                    mouseOptions: {
                        finalHoverRepeats: 6,
                        finalHoverDelayMs: 44,
                        settleDelayMs: 420,
                    },
                },
                {
                    targetOffset: { x: 0.9, y: 0.5 },
                    mouseOptions: {
                        finalHoverRepeats: 8,
                        finalHoverDelayMs: 56,
                        settleDelayMs: 520,
                    },
                    settleMs: 1200,
                },
            ],
            (currentResult) => {
                return currentResult.beforeGroups.length === 3
                    && currentResult.afterGroups.length === 3
                    && currentResult.layoutChanged
                    && currentResult.audit.observations.some((item) => item.phase === "capture" && item.source === "drag");
            },
        );

        logAuditResult("nested-left-bottom-to-right-column-edge", {
            ...result.audit,
            layoutChanged: result.layoutChanged,
            observations: result.audit.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        }, {
            beforeGroupCount: result.beforeGroups.length,
            afterGroupCount: result.afterGroups.length,
            attempt: result.attempt,
        });

        expect(result.beforeGroups.length).toBe(3);
        expect(result.afterGroups.length).toBe(3);
        expect(result.layoutChanged).toBe(true);
        expect(result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test(`manual drag audit: nested right-top tab to bottom edge of left column ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        const result = await runNestedRightTopToBottomOfLeftColumnAuditWithRetry(page);

        logAuditResult("nested-right-top-to-bottom-of-left-column", {
            ...result.audit,
            layoutChanged: result.layoutChanged,
            observations: result.audit.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        }, {
            beforeGroupCount: result.beforeGroups.length,
            afterGroupCount: result.afterGroups.length,
            attempt: result.attempt,
        });

        expect(result.beforeGroups.length).toBe(3);
        expect(result.afterGroups.length).toBe(3);
        expect(result.layoutChanged).toBe(true);
        expect(result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test(`manual drag audit: mixed swap sequence should keep both drags observable ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        await openMockSplitTab(page, {
            id: "sequence-right",
            title: "Sequence Right",
            component: "split-demo",
            position: "right",
        });
        await waitForDockviewAnimationsToSettle(page);

        const firstResult = await runDockviewAnimationAudit(page, async () => {
            await dockviewMouseDragPanel(
                page,
                page.locator(".dv-tab", { hasText: "首页" }).first(),
                getGroupByTabLabel(page, "Sequence Right"),
                { x: 0.92, y: 0.5 },
            );
        }, 1100);

        await waitForDockviewAnimationsToSettle(page);
        const secondResult = await runDockviewAnimationAudit(page, async () => {
            await dockviewMouseDragPanel(
                page,
                page.locator(".dv-tab", { hasText: "Sequence Right" }).first(),
                getGroupByTabLabel(page, "首页"),
                { x: 0.92, y: 0.5 },
            );
        }, 1100);

        const finalGroups = await readSortedGroups(page);
        logAuditResult("mixed-horizontal-swap-sequence:first", {
            ...firstResult,
            observations: firstResult.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        });
        logAuditResult("mixed-horizontal-swap-sequence:second", {
            ...secondResult,
            observations: secondResult.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        }, {
            finalHorizontal: isHorizontalLayout(finalGroups),
        });

        expect(finalGroups.length).toBe(2);
        expect(firstResult.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
        expect(secondResult.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
        expect(firstResult.didPlay).toBe(true);
        expect(secondResult.didPlay).toBe(true);
    });

    test("manual drag audit: guide tab dragged to its own left half should create split and animate", async ({ page }) => {
        await openMockGuideTabFromFileTree(page);
        await waitForDockviewAnimationsToSettle(page);

        const beforeGroups = await readSortedGroups(page);
        const sourceTab = page.locator(".dv-tab", { hasText: "guide.md" }).first();
        const targetGroup = getGroupByTabLabel(page, "guide.md");

        const result = await runDockviewAnimationAudit(page, async () => {
            await dockviewDragPanel(page, sourceTab, targetGroup, { x: 0.08, y: 0.5 });
        }, 950);

        const afterGroups = await readSortedGroups(page);
        const layoutChanged = createLayoutSignature(beforeGroups) !== createLayoutSignature(afterGroups);
        const guideGroups = afterGroups.filter((group) => group.tabLabels.includes("guide.md") || group.tabLabels.includes("首页"));

        logAuditResult("manual-guide-self-left-split", {
            ...result,
            layoutChanged,
            observations: result.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        }, {
            beforeGroupCount: beforeGroups.length,
            afterGroupCount: afterGroups.length,
            guideGroups: guideGroups.map((group) => ({
                tabLabels: group.tabLabels,
                left: Math.round(group.left),
                top: Math.round(group.top),
            })),
        });

        expect(afterGroups.length).toBe(2);
        expect(layoutChanged).toBe(true);
        expect(result.didPlay).toBe(true);
        expect(result.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);

        const preClickPlayCount = result.observations.filter((item) => item.phase === "play" && item.status === "played").length;
        await page.locator(".dv-tab", { hasText: "首页" }).first().click();
        await page.waitForTimeout(160);
        const postClickObservations = await getDockviewAnimationObservations(page);
        const postClickPlayCount = postClickObservations.filter((item) => item.phase === "play" && item.status === "played").length;
        expect(preClickPlayCount).toBeGreaterThan(0);
        expect(postClickPlayCount).toBe(preClickPlayCount);
    });

    test("manual drag audit: guide self split timeline should not require follow-up click", async ({ page }) => {
        await openMockGuideTabFromFileTree(page);
        await waitForDockviewAnimationsToSettle(page);

        const sourceTab = page.locator(".dv-tab", { hasText: "guide.md" }).first();
        const targetGroup = getGroupByTabLabel(page, "guide.md");

        await runDockviewAnimationAudit(page, async () => {
            await dockviewDragPanel(page, sourceTab, targetGroup, { x: 0.08, y: 0.5 });
        }, 950);

        const timelineBeforeClick = await getDockviewTimelineEntries(page);
        await page.locator(".dv-tab", { hasText: "首页" }).first().click();
        await page.waitForTimeout(180);
        const timelineAfterClick = await getDockviewTimelineEntries(page);

        console.info("[dockview-animation-timeline]", {
            scenario: "manual-guide-self-left-split-timeline",
            beforeClick: timelineBeforeClick.map((item) => ({
                type: item.type,
                pendingAnimationId: item.pendingAnimationId,
                activeTabId: item.activeTabId,
                groupCount: item.groupCount,
            })),
            afterClickDelta: timelineAfterClick.slice(timelineBeforeClick.length).map((item) => ({
                type: item.type,
                pendingAnimationId: item.pendingAnimationId,
                activeTabId: item.activeTabId,
                groupCount: item.groupCount,
            })),
        });

        expect(timelineBeforeClick.some((item) => item.type === "dragstart-tab")).toBe(true);
        expect(timelineBeforeClick.some((item) => item.type === "layout-change")).toBe(true);
        expect(timelineBeforeClick.some((item) => item.type === "play-attempt")).toBe(true);
    });

    test(`manual mouse drag audit: guide self split should animate before follow-up click ${MOUSE_DRAG_TAG}`, async ({ page }, testInfo) => {
        await openMockGuideTabFromFileTree(page);

        const sourceTab = page.locator(".dv-tab", { hasText: "guide.md" }).first();
        const targetGroup = getGroupByTabLabel(page, "guide.md");

        const report = await runDockviewDragAnimationContract(page, testInfo, {
            scenario: "manual-mouse-guide-self-left-split",
            source: sourceTab,
            target: targetGroup,
            targetOffset: { x: 0.08, y: 0.5 },
            interactionMode: "mouse",
            settleMs: 1100,
        });

        const afterGroups = sortDockviewLayoutGroups(report.afterLayout);

        expect(afterGroups.length).toBe(2);
        expect(report.layoutChanged).toBe(true);
        expect(report.didPlay).toBe(true);
        expect(report.timeline.some((item) => item.type === "dragstart-tab")).toBe(true);
        expect(report.timeline.some((item) => item.type === "layout-change")).toBe(true);
        expect(report.timeline.some((item) => item.type === "play-attempt")).toBe(true);

        const preClickPlayCount = countPlayedDockviewAnimationObservations(report.observations);
        await page.locator(".dv-tab", { hasText: "首页" }).first().click();
        await page.waitForTimeout(180);
        const postClickObservations = await getDockviewAnimationObservations(page);
        const postClickPlayCount = countPlayedDockviewAnimationObservations(postClickObservations);
        expect(preClickPlayCount).toBeGreaterThan(0);
        expect(postClickPlayCount).toBe(preClickPlayCount);
    });

    test(`manual mouse drag audit: collapsing split back to one group should animate before follow-up click ${MOUSE_DRAG_TAG}`, async ({ page }, testInfo) => {
        await openMockGuideTabFromFileTree(page);
        await waitForDockviewAnimationsToSettle(page);

        await dockviewMouseDragPanel(
            page,
            page.locator(".dv-tab", { hasText: "guide.md" }).first(),
            getGroupByTabLabel(page, "guide.md"),
            { x: 0.08, y: 0.5 },
        );
        await waitForDockviewAnimationsToSettle(page);

        const sourceTab = page.locator(".dv-tab", { hasText: "guide.md" }).first();
        const targetTab = page.locator(".dv-tab", { hasText: "首页" }).first();

        const report = await runDockviewDragAnimationContract(page, testInfo, {
            scenario: "manual-mouse-collapse-to-single-group",
            source: sourceTab,
            target: targetTab,
            targetOffset: { x: 0.5, y: 0.5 },
            interactionMode: "mouse",
            settleMs: 1100,
            mouseOptions: {
                finalHoverRepeats: 3,
                finalHoverDelayMs: 28,
            },
        });

        const beforeGroups = sortDockviewLayoutGroups(report.beforeLayout);
        const afterGroups = sortDockviewLayoutGroups(report.afterLayout);

        expect(beforeGroups.length).toBe(2);
        expect(afterGroups.length).toBe(1);
        expect(report.layoutChanged).toBe(true);
        expect(report.didPlay).toBe(true);
        expect(report.timeline.some((item) => item.type === "dragstart-tab")).toBe(true);
        expect(report.timeline.some((item) => item.type === "layout-change")).toBe(true);
        expect(report.timeline.some((item) => item.type === "play-attempt")).toBe(true);

        const preClickPlayCount = countPlayedDockviewAnimationObservations(report.observations);
        await page.locator(".dv-tab", { hasText: "首页" }).first().click();
        await page.waitForTimeout(180);
        const postClickObservations = await getDockviewAnimationObservations(page);
        const postClickPlayCount = countPlayedDockviewAnimationObservations(postClickObservations);
        expect(preClickPlayCount).toBeGreaterThan(0);
        expect(postClickPlayCount).toBe(preClickPlayCount);
    });

    test(`manual mouse drag audit: same-group tab drag should shift sibling tab before drop ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        await waitForDockviewReady(page);
        await openMockGuideTabFromFileTree(page);
        await openMockLatexTabFromFileTree(page);
        await waitForDockviewAnimationsToSettle(page);

        await page.evaluate(() => {
            window.__OFIVE_E2E_DOCKVIEW_TRACE__ = [];

            const host = document.querySelector(".main-dockview-host");
            if (!host || window.__OFIVE_E2E_DOCKVIEW_TRACE_BOUND__) {
                return;
            }

            const pushTrace = (type: string, event: DragEvent): void => {
                const target = event.target instanceof Element
                    ? event.target.closest(".dv-tab, .dv-tabs-container, .dv-groupview")
                    : null;

                window.__OFIVE_E2E_DOCKVIEW_TRACE__.push({
                    type,
                    targetText: target ? (target.textContent ?? "").trim() : null,
                    targetClassName: target ? target.className : null,
                });
                window.__OFIVE_E2E_DOCKVIEW_TRACE__ = window.__OFIVE_E2E_DOCKVIEW_TRACE__.slice(-120);
            };

            host.addEventListener("dragstart", (event) => pushTrace("dragstart", event), true);
            host.addEventListener("dragover", (event) => pushTrace("dragover", event), true);
            host.addEventListener("drop", (event) => pushTrace("drop", event), true);
            host.addEventListener("dragend", (event) => pushTrace("dragend", event), true);
            window.__OFIVE_E2E_DOCKVIEW_TRACE_BOUND__ = true;
        });

        const sourceTab = page.locator(".dv-tab", { hasText: "guide.md" }).first();
        const targetTab = page.locator(".dv-tab", { hasText: "latex-test.md" }).first();
        const sourceBox = await sourceTab.boundingBox();
        const targetBox = await targetTab.boundingBox();
        if (!sourceBox || !targetBox) {
            throw new Error("manual mouse drag audit: same-group live reorder probe missing bounding boxes");
        }

        const sourceX = sourceBox.x + (sourceBox.width / 2);
        const sourceY = sourceBox.y + (sourceBox.height / 2);
        const targetX = targetBox.x + (targetBox.width * 0.84);
        const targetY = targetBox.y + (targetBox.height * 0.5);

        await page.mouse.move(sourceX, sourceY);
        await page.waitForTimeout(16);
        await page.mouse.down();
        await page.mouse.move(sourceX + 8, sourceY + 4, { steps: 6 });
        await page.waitForTimeout(24);
        await page.mouse.move(sourceX + ((targetX - sourceX) * 0.45), sourceY, { steps: 8 });
        await page.waitForTimeout(24);
        await page.mouse.move(targetX, targetY, { steps: 14 });
        await page.waitForTimeout(120);

        const dragProbe = await page.evaluate(() => {
            const probeTab = Array.from(document.querySelectorAll<HTMLElement>(".dv-tab")).find((tab) => {
                return (tab.textContent ?? "").trim() === "latex-test.md";
            });
            const sourceTabElement = Array.from(document.querySelectorAll<HTMLElement>(".dv-tab")).find((tab) => {
                return (tab.textContent ?? "").trim() === "guide.md";
            });
            const insertionContainer = document.querySelector<HTMLElement>(".dv-tabs-container.dv-tabs-container--insertion-preview");

            return {
                trace: window.__OFIVE_E2E_DOCKVIEW_TRACE__ ?? [],
                targetTransform: probeTab ? window.getComputedStyle(probeTab).transform : null,
                targetShift: probeTab ? probeTab.style.getPropertyValue("--ofive-dockview-tab-shift-x") : null,
                sourceClassName: sourceTabElement?.className ?? null,
                insertionMarkerLeft: insertionContainer?.style.getPropertyValue("--ofive-dockview-insert-left") ?? null,
                insertionMarkerClassName: insertionContainer?.className ?? null,
            };
        });

        await page.mouse.up();

        expect(dragProbe.trace.some((entry: { type: string; }) => entry.type === "dragstart")).toBe(true);
        expect(dragProbe.trace.some((entry: { type: string; targetText: string | null; }) => {
            return entry.type === "dragover" && entry.targetText?.includes("latex-test.md");
        })).toBe(true);
        expect(dragProbe.sourceClassName).toContain("dv-tab--drag-source");
        expect(dragProbe.targetShift).toBeTruthy();
        expect(dragProbe.insertionMarkerClassName).toContain("dv-tabs-container--insertion-preview");
        expect(dragProbe.insertionMarkerLeft).toBeTruthy();
        expect(dragProbe.targetTransform).not.toBe("matrix(1, 0, 0, 1, 0, 0)");
    });

    test(`manual mouse drag audit: strict reorder telemetry should distinguish preview-only same-group drag ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        await waitForDockviewReady(page);
        await openMockGuideTabFromFileTree(page);
        await openMockLatexTabFromFileTree(page);
        await waitForDockviewAnimationsToSettle(page);
        await clearDockviewTabReorderAuditEntries(page);

        const sourceTab = page.locator(".dv-tab", { hasText: "guide.md" }).first();
        const targetTab = page.locator(".dv-tab", { hasText: "latex-test.md" }).first();

        const sourceBox = await sourceTab.boundingBox();
        const targetBox = await targetTab.boundingBox();
        if (!sourceBox || !targetBox) {
            throw new Error("strict reorder telemetry same-group drag is missing tab bounding boxes");
        }

        const sourceX = sourceBox.x + (sourceBox.width / 2);
        const sourceY = sourceBox.y + (sourceBox.height / 2);
        const targetX = targetBox.x + (targetBox.width * 0.84);
        const targetY = targetBox.y + (targetBox.height * 0.5);

        await page.mouse.move(sourceX, sourceY);
        await page.waitForTimeout(16);
        await page.mouse.down();
        await page.mouse.move(sourceX + 8, sourceY + 4, { steps: 6 });
        await page.waitForTimeout(24);
        await page.mouse.move(sourceX + ((targetX - sourceX) * 0.45), sourceY, { steps: 8 });
        await page.waitForTimeout(24);
        await page.mouse.move(targetX, targetY, { steps: 14 });
        await page.waitForTimeout(120);
        await page.mouse.up();
        await page.waitForTimeout(240);

        const auditEntries = await getDockviewTabReorderAuditEntries(page);
        const startEntry = auditEntries.find((entry) => entry.type === "drag-session-start") ?? null;
        const previewEntries = auditEntries.filter((entry) => entry.type === "preview-updated");
        const domOrderEntry = auditEntries.find((entry) => entry.type === "dom-order-changed") ?? null;
        const dropEntry = auditEntries.find((entry) => entry.type === "drop-committed") ?? null;
        const endEntry = auditEntries.find((entry) => entry.type === "drag-session-end") ?? null;
        const terminalEntry = auditEntries.at(-1) ?? null;

        expect(startEntry).not.toBeNull();
        expect(previewEntries.length).toBeGreaterThan(0);
        expect(endEntry).not.toBeNull();

        expect(previewEntries.some((entry) => {
            return entry.insertionLeft !== null && entry.shiftedTabLabels.includes("latex-test.md");
        })).toBe(true);

        expect(domOrderEntry).toBeNull();
        expect(dropEntry).toBeNull();
        expect(terminalEntry?.tabStrips.some((strip) => {
            return strip.tabLabels.join("|") === "首页|guide.md|latex-test.md";
        })).toBe(true);

        const distinctSessionIds = new Set(auditEntries.map((entry) => entry.sessionId).filter((value) => value !== null));
        expect(distinctSessionIds.size).toBe(1);
    });
});