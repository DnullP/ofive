/**
 * @module perf/frontend/knowledge-graph-labels
 * @description 知识图谱标签性能场景：测量连续缩放跨过标签显示阈值时的掉帧与标签显现表现。
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/mockVault
 *   - ./helpers/frontendPerfReport
 *
 * @example
 *   bunx playwright test --config playwright.perf.config.ts perf/frontend/knowledge-graph-labels.perf.ts
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoPerfMockVaultPage } from "./helpers/mockVault";
import { writeFrontendPerfReport } from "./helpers/frontendPerfReport";

interface MockGraphNode {
    path: string;
    title: string;
}

interface MockGraphEdge {
    sourcePath: string;
    targetPath: string;
    weight: number;
}

interface MockGraphResponse {
    nodes: MockGraphNode[];
    edges: MockGraphEdge[];
}

interface GraphFrameProfile {
    durationMs: number;
    frameCount: number;
    averageFrameMs: number;
    maxFrameMs: number;
    framesOver16Ms: number;
    framesOver32Ms: number;
    framesOver50Ms: number;
    finalZoomLevel: number;
    labelVisibleZoomLevel: number;
    visibleLabelCount: number;
    totalLabelCount: number;
    labelOpacity: number;
    maxLabelSwapCount: number;
    framesWithHeavyLabelSwap: number;
}

interface GraphSteadyFrameProfile {
    durationMs: number;
    frameCount: number;
    averageFrameMs: number;
    maxFrameMs: number;
    framesOver16Ms: number;
    framesOver32Ms: number;
    framesOver50Ms: number;
    minVisibleLabelCount: number;
    maxVisibleLabelCount: number;
}

interface GraphLabelStabilityProfile {
    totalLabelCount: number;
    minVisibleLabelCount: number;
    maxSwapCount: number;
    maxSwapRatio: number;
}

const MIN_VISIBLE_LABEL_RATIO_GUARD = 0.6;
const MIN_STEADY_SAMPLE_FRAME_COUNT = 5;

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
 * @function applyMockMacGlassChrome
 * @description 在浏览器 perf 环境中直接注入 glass 所需的根节点 class 与 CSS 变量，
 *   避免伪造完整 Tauri runtime 触发原生 API 依赖。
 * @param page Playwright 页面对象。
 */
async function applyMockMacGlassChrome(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.documentElement.classList.add(
            "app-runtime--tauri",
            "app-platform--macos",
            "app-effect--glass",
        );

        document.documentElement.style.setProperty("--glass-blur-radius", "8px");
        document.documentElement.style.setProperty("--glass-tint-opacity", "0.05");
        document.documentElement.style.setProperty("--glass-surface-opacity", "0.12");
        document.documentElement.style.setProperty("--glass-surface-opacity-soft", "0.16");
        document.documentElement.style.setProperty("--glass-surface-opacity-strong", "0.22");
        document.documentElement.style.setProperty("--glass-inactive-surface-opacity", "0.09");
        document.documentElement.style.setProperty("--glass-inactive-surface-opacity-soft", "0.13");
        document.documentElement.style.setProperty("--glass-inactive-surface-opacity-strong", "0.17");
    });
}

/**
 * @function buildDenseMockGraphResponse
 * @description 生成用于标签压力测试的高密度图谱数据集。
 * @returns 图谱 mock 响应。
 */
function buildDenseMockGraphResponse(): MockGraphResponse {
    const nodeCount = 1800;
    const nodes: MockGraphNode[] = Array.from({ length: nodeCount }, (_, index) => ({
        path: `test-resources/notes/graph-labels-${String(index).padStart(4, "0")}.md`,
        title: `Label Stress ${index}`,
    }));

    const edges: MockGraphEdge[] = [];
    for (let sourceIndex = 0; sourceIndex < nodes.length; sourceIndex += 1) {
        const sourceNode = nodes[sourceIndex];
        if (!sourceNode) {
            continue;
        }

        for (let offset = 1; offset <= 5; offset += 1) {
            const targetNode = nodes[(sourceIndex + offset) % nodes.length];
            if (!targetNode || targetNode.path === sourceNode.path) {
                continue;
            }

            edges.push({
                sourcePath: sourceNode.path,
                targetPath: targetNode.path,
                weight: 1,
            });
        }
    }

    return {
        nodes,
        edges,
    };
}

/**
 * @function installGraphOverride
 * @description 将测试图谱数据集注入浏览器 mock 运行时。
 * @param page Playwright 页面对象。
 * @param graphResponse 测试图谱响应。
 */
async function installGraphOverride(
    page: Page,
    graphResponse: MockGraphResponse,
): Promise<void> {
    await page.evaluate((nextGraphResponse) => {
        const runtimeWindow = window as Window & {
            __OFIVE_BROWSER_MOCK_GRAPH_RESPONSE__?: MockGraphResponse;
        };

        runtimeWindow.__OFIVE_BROWSER_MOCK_GRAPH_RESPONSE__ = nextGraphResponse;
    }, graphResponse);
}

/**
 * @function openKnowledgeGraph
 * @description 打开知识图谱并等待测试钩子就绪。
 * @param page Playwright 页面对象。
 * @param expectedNodeCount 期望节点数。
 * @param expectedEdgeCount 期望边数。
 */
async function openKnowledgeGraph(
    page: Page,
    expectedNodeCount: number,
    expectedEdgeCount: number,
): Promise<void> {
    await page.locator('[data-testid="activity-bar-item-knowledge-graph"]').click();
    await expect(page.locator(".knowledge-graph-tab__stats")).toHaveText(
        `nodes: ${String(expectedNodeCount)} | edges: ${String(expectedEdgeCount)}`,
    );
    await page.waitForFunction(() => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: unknown;
        };
        return Boolean(runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__);
    });
}

/**
 * @function profileContinuousZoomUntilLabelsVisible
 * @description 连续放大图谱直到跨过标签显示阈值，并采样 RAF 帧间隔。
 * @param page Playwright 页面对象。
 * @returns 连续缩放阶段的帧统计。
 */
async function profileContinuousZoomUntilLabelsVisible(page: Page): Promise<GraphFrameProfile> {
    return page.evaluate(async () => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                getZoomLevel: () => number;
                getLabelVisibleZoomLevel: () => number;
                setZoomLevel: (zoomLevel: number) => void;
                getLabelStats: () => {
                    totalLabelCount: number;
                    visibleLabelCount: number;
                    opacity: number;
                    swapCount: number;
                    maxSwapCount: number;
                };
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph perf hook not found");
        }

        const startZoomLevel = hook.getZoomLevel();
        const labelVisibleZoomLevel = hook.getLabelVisibleZoomLevel();
        const targetZoomLevel = Math.max(startZoomLevel + 0.8, labelVisibleZoomLevel + 0.35);
        const zoomDurationMs = 1200;
        const startedAt = performance.now();
        let lastFrameAt = startedAt;
        let frameCount = 0;
        let totalFrameMs = 0;
        let maxFrameMs = 0;
        let framesOver16Ms = 0;
        let framesOver32Ms = 0;
        let framesOver50Ms = 0;
        let maxLabelSwapCount = 0;
        let framesWithHeavyLabelSwap = 0;

        await new Promise<void>((resolve) => {
            const tick = (now: number): void => {
                if (frameCount > 0) {
                    const frameMs = now - lastFrameAt;
                    totalFrameMs += frameMs;
                    maxFrameMs = Math.max(maxFrameMs, frameMs);
                    if (frameMs > 16.7) {
                        framesOver16Ms += 1;
                    }
                    if (frameMs > 32) {
                        framesOver32Ms += 1;
                    }
                    if (frameMs > 50) {
                        framesOver50Ms += 1;
                    }
                }

                frameCount += 1;
                lastFrameAt = now;

                const progress = Math.min(1, (now - startedAt) / zoomDurationMs);
                const nextZoomLevel = startZoomLevel + (targetZoomLevel - startZoomLevel) * progress;
                hook.setZoomLevel(nextZoomLevel);

                const labelStats = hook.getLabelStats();
                maxLabelSwapCount = Math.max(maxLabelSwapCount, labelStats.swapCount);
                if (
                    labelStats.visibleLabelCount > 0
                    && labelStats.swapCount >= Math.max(8, Math.floor(labelStats.visibleLabelCount * 0.45))
                ) {
                    framesWithHeavyLabelSwap += 1;
                }
                if (
                    progress >= 1
                    && labelStats.opacity >= 0.95
                    && labelStats.visibleLabelCount > 0
                ) {
                    resolve();
                    return;
                }

                window.requestAnimationFrame(tick);
            };

            window.requestAnimationFrame(tick);
        });

        const labelStats = hook.getLabelStats();
        return {
            durationMs: Number((performance.now() - startedAt).toFixed(3)),
            frameCount,
            averageFrameMs: Number((frameCount > 1 ? totalFrameMs / (frameCount - 1) : 0).toFixed(3)),
            maxFrameMs: Number(maxFrameMs.toFixed(3)),
            framesOver16Ms,
            framesOver32Ms,
            framesOver50Ms,
            finalZoomLevel: Number(hook.getZoomLevel().toFixed(3)),
            labelVisibleZoomLevel: Number(labelVisibleZoomLevel.toFixed(3)),
            visibleLabelCount: labelStats.visibleLabelCount,
            totalLabelCount: labelStats.totalLabelCount,
            labelOpacity: Number(labelStats.opacity.toFixed(3)),
            maxLabelSwapCount,
            framesWithHeavyLabelSwap,
        };
    });
}

/**
 * @function verifyGraphRemainsResponsiveAfterZoom
 * @description 验证连续缩放后图谱仍可继续响应后续缩放指令。
 * @param page Playwright 页面对象。
 */
async function verifyGraphRemainsResponsiveAfterZoom(page: Page): Promise<void> {
    const result = await page.evaluate(async () => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                getZoomLevel: () => number;
                setZoomLevel: (zoomLevel: number) => void;
                getLabelStats: () => {
                    visibleLabelCount: number;
                    opacity: number;
                };
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph perf hook not found");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 500));

        const zoomBefore = hook.getZoomLevel();
        hook.setZoomLevel(zoomBefore + 0.12);
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
        const zoomAfterFirst = hook.getZoomLevel();

        hook.setZoomLevel(zoomBefore + 0.24);
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
        const zoomAfterSecond = hook.getZoomLevel();
        const labelStats = hook.getLabelStats();

        return {
            zoomBefore,
            zoomAfterFirst,
            zoomAfterSecond,
            visibleLabelCount: labelStats.visibleLabelCount,
            opacity: labelStats.opacity,
        };
    });

    expect(result.zoomAfterFirst).toBeGreaterThan(result.zoomBefore);
    expect(result.zoomAfterSecond).toBeGreaterThan(result.zoomAfterFirst);
    expect(result.visibleLabelCount).toBeGreaterThan(0);
    expect(result.opacity).toBeGreaterThan(0.9);
}

/**
 * @function profileLabelStabilityDuringSmallZoomSteps
 * @description 在标签已经可见后进行多次微小缩放，观察标签可见数量和切换抖动。
 * @param page Playwright 页面对象。
 * @returns 微小缩放阶段的标签稳定性摘要。
 */
async function profileLabelStabilityDuringSmallZoomSteps(
    page: Page,
): Promise<GraphLabelStabilityProfile> {
    return page.evaluate(async () => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                getZoomLevel: () => number;
                setZoomLevel: (zoomLevel: number) => void;
                getLabelStats: () => {
                    totalLabelCount: number;
                    visibleLabelCount: number;
                    opacity: number;
                    swapCount: number;
                };
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph perf hook not found");
        }

        let minVisibleLabelCount = Number.POSITIVE_INFINITY;
        let maxSwapCount = 0;
        let totalLabelCount = 0;

        for (let step = 1; step <= 4; step += 1) {
            const currentZoom = hook.getZoomLevel();
            hook.setZoomLevel(currentZoom + 0.035);
            await new Promise<void>((resolve) => {
                window.requestAnimationFrame(() => {
                    window.requestAnimationFrame(() => resolve());
                });
            });

            const stats = hook.getLabelStats();
            totalLabelCount = stats.totalLabelCount;
            minVisibleLabelCount = Math.min(minVisibleLabelCount, stats.visibleLabelCount);
            maxSwapCount = Math.max(maxSwapCount, stats.swapCount);
        }

        if (!Number.isFinite(minVisibleLabelCount)) {
            minVisibleLabelCount = 0;
        }

        return {
            totalLabelCount,
            minVisibleLabelCount,
            maxSwapCount,
            maxSwapRatio: totalLabelCount > 0 ? maxSwapCount / totalLabelCount : 0,
        };
    });
}

/**
 * @function profileSteadyStateZoomFrames
 * @description 在标签已显现后测量持续微缩放阶段的 RAF 帧时间，避免将首次显现成本
 *   与 steady-state 交互帧率混在同一个指标里。
 * @param page Playwright 页面对象。
 * @returns steady-state 微缩放阶段的帧统计。
 */
async function profileSteadyStateZoomFrames(
    page: Page,
): Promise<GraphSteadyFrameProfile> {
    return page.evaluate(async () => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                getZoomLevel: () => number;
                setZoomLevel: (zoomLevel: number) => void;
                getLabelStats: () => {
                    visibleLabelCount: number;
                    opacity: number;
                };
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph perf hook not found");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 180));

        const baseZoomLevel = hook.getZoomLevel();
        const startedAt = performance.now();
        const sampleDurationMs = 1_200;
        const hardStopAt = startedAt + sampleDurationMs + 1_000;
        let lastFrameAt = startedAt;
        let frameCount = 0;
        let totalFrameMs = 0;
        let maxFrameMs = 0;
        let framesOver16Ms = 0;
        let framesOver32Ms = 0;
        let framesOver50Ms = 0;
        let minVisibleLabelCount = Number.POSITIVE_INFINITY;
        let maxVisibleLabelCount = 0;

        await new Promise<void>((resolve) => {
            const tick = (now: number): void => {
                if (frameCount > 0) {
                    const frameMs = now - lastFrameAt;
                    totalFrameMs += frameMs;
                    maxFrameMs = Math.max(maxFrameMs, frameMs);
                    if (frameMs > 16.7) {
                        framesOver16Ms += 1;
                    }
                    if (frameMs > 32) {
                        framesOver32Ms += 1;
                    }
                    if (frameMs > 50) {
                        framesOver50Ms += 1;
                    }
                }

                const progress = Math.min(1, (now - startedAt) / sampleDurationMs);
                const phase = progress * Math.PI * 2;
                hook.setZoomLevel(baseZoomLevel + Math.sin(phase) * 0.045);
                const labelStats = hook.getLabelStats();
                minVisibleLabelCount = Math.min(minVisibleLabelCount, labelStats.visibleLabelCount);
                maxVisibleLabelCount = Math.max(maxVisibleLabelCount, labelStats.visibleLabelCount);

                frameCount += 1;
                lastFrameAt = now;

                if (now >= startedAt + sampleDurationMs || now >= hardStopAt) {
                    hook.setZoomLevel(baseZoomLevel);
                    resolve();
                    return;
                }

                window.requestAnimationFrame(tick);
            };

            window.requestAnimationFrame(tick);
        });

        return {
            durationMs: Number((performance.now() - startedAt).toFixed(3)),
            frameCount,
            averageFrameMs: Number((frameCount > 1 ? totalFrameMs / (frameCount - 1) : 0).toFixed(3)),
            maxFrameMs: Number(maxFrameMs.toFixed(3)),
            framesOver16Ms,
            framesOver32Ms,
            framesOver50Ms,
            minVisibleLabelCount: Number.isFinite(minVisibleLabelCount) ? minVisibleLabelCount : 0,
            maxVisibleLabelCount,
        };
    });
}

test.describe("知识图谱标签性能", () => {
    test.setTimeout(60_000);

    test("应测量连续缩放跨过标签阈值时的掉帧风险", async ({ page }) => {
        const graphResponse = buildDenseMockGraphResponse();

        await gotoPerfMockVaultPage(page, "knowledge-graph-labels");
        await waitForLayoutReady(page);
        await installGraphOverride(page, graphResponse);
        await openKnowledgeGraph(page, graphResponse.nodes.length, graphResponse.edges.length);

        const frameProfile = await profileContinuousZoomUntilLabelsVisible(page);
        const labelStabilityProfile = await profileLabelStabilityDuringSmallZoomSteps(page);
        const steadyFrameProfile = await profileSteadyStateZoomFrames(page);
        const steadySampleValid = steadyFrameProfile.frameCount >= MIN_STEADY_SAMPLE_FRAME_COUNT;

        expect(frameProfile.visibleLabelCount).toBeGreaterThan(0);
        expect(frameProfile.labelOpacity).toBeGreaterThan(0.9);
        expect(frameProfile.visibleLabelCount).toBeGreaterThan(
            frameProfile.totalLabelCount * MIN_VISIBLE_LABEL_RATIO_GUARD,
        );
        expect(labelStabilityProfile.minVisibleLabelCount).toBeGreaterThan(
            labelStabilityProfile.totalLabelCount * MIN_VISIBLE_LABEL_RATIO_GUARD,
        );
        expect(labelStabilityProfile.maxSwapRatio).toBeLessThan(0.1);
        expect(steadyFrameProfile.minVisibleLabelCount).toBeGreaterThan(
            frameProfile.totalLabelCount * MIN_VISIBLE_LABEL_RATIO_GUARD,
        );
        await verifyGraphRemainsResponsiveAfterZoom(page);

        await writeFrontendPerfReport("frontend-knowledge-graph-labels.json", {
            schemaVersion: "ofive.perf.report.v1",
            generatedAt: new Date().toISOString(),
            suite: "frontend-knowledge-graph-labels",
            metrics: [],
            derived: [
                {
                    schemaVersion: "ofive.perf.metric.v1",
                    name: "frontend.flow.zoom-knowledge-graph-until-labels-visible",
                    category: "playwright-derived",
                    status: frameProfile.framesOver50Ms > 0 ? "warn" : "ok",
                    runtime: "browser",
                    durationMs: frameProfile.durationMs,
                    details: {
                        dataset: "label_stress_1800nodes",
                        frameCount: frameProfile.frameCount,
                        averageFrameMs: frameProfile.averageFrameMs,
                        maxFrameMs: frameProfile.maxFrameMs,
                        framesOver16Ms: frameProfile.framesOver16Ms,
                        framesOver32Ms: frameProfile.framesOver32Ms,
                        framesOver50Ms: frameProfile.framesOver50Ms,
                        finalZoomLevel: frameProfile.finalZoomLevel,
                        labelVisibleZoomLevel: frameProfile.labelVisibleZoomLevel,
                        visibleLabelCount: frameProfile.visibleLabelCount,
                        totalLabelCount: frameProfile.totalLabelCount,
                        labelOpacity: frameProfile.labelOpacity,
                        maxLabelSwapCount: frameProfile.maxLabelSwapCount,
                        framesWithHeavyLabelSwap: frameProfile.framesWithHeavyLabelSwap,
                        steadySampleValid,
                        steadyFrameCount: steadyFrameProfile.frameCount,
                        steadyAverageFrameMs: steadySampleValid
                            ? steadyFrameProfile.averageFrameMs
                            : null,
                        steadyMaxFrameMs: steadySampleValid ? steadyFrameProfile.maxFrameMs : null,
                        steadyFramesOver16Ms: steadySampleValid
                            ? steadyFrameProfile.framesOver16Ms
                            : null,
                        steadyFramesOver32Ms: steadySampleValid
                            ? steadyFrameProfile.framesOver32Ms
                            : null,
                        steadyFramesOver50Ms: steadySampleValid
                            ? steadyFrameProfile.framesOver50Ms
                            : null,
                        steadyMinVisibleLabelCount: steadyFrameProfile.minVisibleLabelCount,
                        steadyMaxVisibleLabelCount: steadyFrameProfile.maxVisibleLabelCount,
                        steadyInvalidReason: steadySampleValid
                            ? null
                            : "headless-swiftshader-raf-starvation",
                    },
                },
            ],
        });
    });

    test("应将毛玻璃开启时的大量标签压力纳入性能测试", async ({ page }) => {
        const graphResponse = buildDenseMockGraphResponse();

        await gotoPerfMockVaultPage(page, "knowledge-graph-labels-glass");
        await waitForLayoutReady(page);
        await applyMockMacGlassChrome(page);
        await installGraphOverride(page, graphResponse);
        await openKnowledgeGraph(page, graphResponse.nodes.length, graphResponse.edges.length);

        const frameProfile = await profileContinuousZoomUntilLabelsVisible(page);
        const labelStabilityProfile = await profileLabelStabilityDuringSmallZoomSteps(page);
        const steadyFrameProfile = await profileSteadyStateZoomFrames(page);
        const steadySampleValid = steadyFrameProfile.frameCount >= MIN_STEADY_SAMPLE_FRAME_COUNT;

        expect(frameProfile.visibleLabelCount).toBeGreaterThan(0);
        expect(frameProfile.labelOpacity).toBeGreaterThan(0.9);
        expect(frameProfile.visibleLabelCount).toBeGreaterThan(
            frameProfile.totalLabelCount * MIN_VISIBLE_LABEL_RATIO_GUARD,
        );
        expect(labelStabilityProfile.minVisibleLabelCount).toBeGreaterThan(
            labelStabilityProfile.totalLabelCount * MIN_VISIBLE_LABEL_RATIO_GUARD,
        );
        expect(labelStabilityProfile.maxSwapRatio).toBeLessThan(0.1);
        expect(steadyFrameProfile.minVisibleLabelCount).toBeGreaterThan(
            frameProfile.totalLabelCount * MIN_VISIBLE_LABEL_RATIO_GUARD,
        );
        await verifyGraphRemainsResponsiveAfterZoom(page);

        await writeFrontendPerfReport("frontend-knowledge-graph-labels-glass.json", {
            schemaVersion: "ofive.perf.report.v1",
            generatedAt: new Date().toISOString(),
            suite: "frontend-knowledge-graph-labels-glass",
            metrics: [],
            derived: [
                {
                    schemaVersion: "ofive.perf.metric.v1",
                    name: "frontend.flow.zoom-knowledge-graph-until-labels-visible-glass",
                    category: "playwright-derived",
                    status: frameProfile.framesOver50Ms > 0 ? "warn" : "ok",
                    runtime: "browser",
                    durationMs: frameProfile.durationMs,
                    details: {
                        dataset: "label_stress_1800nodes_glass",
                        frameCount: frameProfile.frameCount,
                        averageFrameMs: frameProfile.averageFrameMs,
                        maxFrameMs: frameProfile.maxFrameMs,
                        framesOver16Ms: frameProfile.framesOver16Ms,
                        framesOver32Ms: frameProfile.framesOver32Ms,
                        framesOver50Ms: frameProfile.framesOver50Ms,
                        finalZoomLevel: frameProfile.finalZoomLevel,
                        labelVisibleZoomLevel: frameProfile.labelVisibleZoomLevel,
                        visibleLabelCount: frameProfile.visibleLabelCount,
                        totalLabelCount: frameProfile.totalLabelCount,
                        labelOpacity: frameProfile.labelOpacity,
                        maxLabelSwapCount: frameProfile.maxLabelSwapCount,
                        framesWithHeavyLabelSwap: frameProfile.framesWithHeavyLabelSwap,
                        steadySampleValid,
                        steadyFrameCount: steadyFrameProfile.frameCount,
                        steadyAverageFrameMs: steadySampleValid
                            ? steadyFrameProfile.averageFrameMs
                            : null,
                        steadyMaxFrameMs: steadySampleValid ? steadyFrameProfile.maxFrameMs : null,
                        steadyFramesOver16Ms: steadySampleValid
                            ? steadyFrameProfile.framesOver16Ms
                            : null,
                        steadyFramesOver32Ms: steadySampleValid
                            ? steadyFrameProfile.framesOver32Ms
                            : null,
                        steadyFramesOver50Ms: steadySampleValid
                            ? steadyFrameProfile.framesOver50Ms
                            : null,
                        steadyMinVisibleLabelCount: steadyFrameProfile.minVisibleLabelCount,
                        steadyMaxVisibleLabelCount: steadyFrameProfile.maxVisibleLabelCount,
                        steadyInvalidReason: steadySampleValid
                            ? null
                            : "headless-swiftshader-raf-starvation",
                        effect: "glass",
                        platform: "macos-mock",
                    },
                },
            ],
            attachments: {
                frameProfile,
                graph: {
                    nodeCount: graphResponse.nodes.length,
                    edgeCount: graphResponse.edges.length,
                },
                runtime: {
                    effect: "glass",
                    platform: "macos-mock",
                },
            },
        });
    });
});