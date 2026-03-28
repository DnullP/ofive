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
    getDockviewAnimationObservations,
    getDockviewTimelineEntries,
    getDockviewLayoutSnapshot,
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
} from "./helpers/dockviewDrag";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";

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
    settleMs?: number;
}

interface ManualDragAuditSummary {
    audit: Awaited<ReturnType<typeof runDockviewAnimationAudit>>;
    beforeGroups: Awaited<ReturnType<typeof readSortedGroups>>;
    afterGroups: Awaited<ReturnType<typeof readSortedGroups>>;
    layoutChanged: boolean;
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

    test("manual drag audit: left tab to right edge of right group should expose swap case", async ({ page }) => {
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

    test("manual drag audit: bottom tab to top edge of home should expose vertical swap edge", async ({ page }) => {
        await openMockSplitTab(page, {
            id: "manual-bottom",
            title: "Manual Bottom",
            component: "split-demo",
            position: "bottom",
        });
        await waitForDockviewAnimationsToSettle(page);

        const beforeGroups = await readSortedGroups(page);
        const sourceTab = page.locator(".dv-tab", { hasText: "Manual Bottom" }).first();
        const targetHeader = getGroupByTabLabel(page, "首页")
            .locator(".dv-tabs-and-actions-container")
            .first();

        const audit = await runDockviewAnimationAudit(page, async () => {
            await dockviewDragPanel(page, sourceTab, targetHeader, { x: 0.5, y: 0.08 });
        }, 950);

        const afterGroups = await readSortedGroups(page);
        const result = {
            audit,
            beforeGroups,
            afterGroups,
            layoutChanged: createLayoutSignature(beforeGroups) !== createLayoutSignature(afterGroups),
        };

        const homeGroup = findGroupByTabLabel(result.afterGroups, "首页");
        const bottomGroup = findGroupByTabLabel(result.afterGroups, "Manual Bottom");
        const swapHappened = Boolean(homeGroup && bottomGroup && bottomGroup.top < homeGroup.top);

        logAuditResult("manual-bottom-to-top-of-home", {
            ...result.audit,
            layoutChanged: result.layoutChanged,
            observations: result.audit.observations.map((item) => ({
                phase: item.phase,
                status: item.status,
                source: item.source,
            })),
        }, {
            swapHappened,
            beforeVertical: isVerticalLayout(result.beforeGroups),
            afterVertical: isVerticalLayout(result.afterGroups),
        });

        expect(result.afterGroups.length).toBe(2);
        expect(swapHappened).toBe(true);
        expect(result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
        expect(result.audit.didPlay).toBe(true);
    });

    test("manual drag audit: home tab to bottom edge of bottom group should expose reverse vertical swap", async ({ page }) => {
        const result = await runManualDragAuditScenario(page, {
            scenario: "manual-home-to-bottom-of-bottom",
            setup: async (currentPage) => {
                await openMockSplitTab(currentPage, {
                    id: "manual-bottom",
                    title: "Manual Bottom",
                    component: "split-demo",
                    position: "bottom",
                });
            },
            sourceLabel: "首页",
            targetLabel: "Manual Bottom",
            targetOffset: { x: 0.5, y: 0.92 },
        });

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
            beforeVertical: isVerticalLayout(result.beforeGroups),
            afterVertical: isVerticalLayout(result.afterGroups),
        });

        expect(result.afterGroups.length).toBe(2);
        expect(result.layoutChanged).toBe(true);
        expect(result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test("manual drag audit: nested left-bottom tab to right edge of right column", async ({ page }) => {
        const result = await runManualDragAuditScenario(page, {
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
            settleMs: 1000,
        });

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
        });

        expect(result.beforeGroups.length).toBe(3);
        expect(result.afterGroups.length).toBe(3);
        expect(result.layoutChanged).toBe(true);
        expect(result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test("manual drag audit: nested right-top tab to bottom edge of left column", async ({ page }) => {
        const result = await runManualDragAuditScenario(page, {
            scenario: "nested-right-top-to-bottom-of-left-column",
            setup: async (currentPage) => {
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
            },
            sourceLabel: "Nested Right Base",
            targetLabel: "首页",
            targetOffset: { x: 0.5, y: 0.92 },
            settleMs: 1000,
        });

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
        });

        expect(result.beforeGroups.length).toBe(3);
        expect(result.afterGroups.length).toBe(3);
        expect(result.layoutChanged).toBe(true);
        expect(result.audit.observations.some((item) => item.phase === "capture" && item.source === "drag")).toBe(true);
    });

    test("manual drag audit: mixed swap sequence should keep both drags observable", async ({ page }) => {
        await openMockSplitTab(page, {
            id: "sequence-right",
            title: "Sequence Right",
            component: "split-demo",
            position: "right",
        });
        await waitForDockviewAnimationsToSettle(page);

        const firstResult = await runDockviewAnimationAudit(page, async () => {
            await dockviewDragPanel(
                page,
                page.locator(".dv-tab", { hasText: "首页" }).first(),
                getGroupByTabLabel(page, "Sequence Right"),
                { x: 0.92, y: 0.5 },
            );
        }, 950);

        await waitForDockviewAnimationsToSettle(page);
        const secondResult = await runDockviewAnimationAudit(page, async () => {
            await dockviewDragPanel(
                page,
                page.locator(".dv-tab", { hasText: "Sequence Right" }).first(),
                getGroupByTabLabel(page, "首页"),
                { x: 0.92, y: 0.5 },
            );
        }, 950);

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

    test("manual mouse drag audit: guide self split should animate before follow-up click", async ({ page }, testInfo) => {
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

    test("manual mouse drag audit: collapsing split back to one group should animate before follow-up click", async ({ page }, testInfo) => {
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
});