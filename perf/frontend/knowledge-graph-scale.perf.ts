/**
 * @module perf/frontend/knowledge-graph-scale
 * @description 知识图谱前端性能场景：对不同节点规模的数据集测量图谱打开与可见耗时。
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/mockVault
 *   - ./helpers/frontendPerfReport
 *
 * @example
 *   bunx playwright test --config playwright.perf.config.ts perf/frontend/knowledge-graph-scale.perf.ts
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoPerfMockVaultPage } from "./helpers/mockVault";
import {
    readPerfMetrics,
    writeFrontendPerfReport,
} from "./helpers/frontendPerfReport";

/**
 * @interface MockGraphNode
 * @description 图谱 mock 节点。
 */
interface MockGraphNode {
    path: string;
    title: string;
}

/**
 * @interface MockGraphEdge
 * @description 图谱 mock 边。
 */
interface MockGraphEdge {
    sourcePath: string;
    targetPath: string;
    weight: number;
}

/**
 * @interface MockGraphResponse
 * @description 图谱 mock 响应。
 */
interface MockGraphResponse {
    nodes: MockGraphNode[];
    edges: MockGraphEdge[];
}

/**
 * @interface GraphScaleScenario
 * @description 图谱规模场景配置。
 */
interface GraphScaleScenario {
    name: string;
    nodeCount: number;
    edgesPerNode: number;
}

const GRAPH_SCALE_SCENARIOS: GraphScaleScenario[] = [
    {
        name: "small_60nodes",
        nodeCount: 60,
        edgesPerNode: 2,
    },
    {
        name: "medium_240nodes",
        nodeCount: 240,
        edgesPerNode: 3,
    },
    {
        name: "large_960nodes",
        nodeCount: 960,
        edgesPerNode: 4,
    },
];

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
 * @function buildMockGraphResponse
 * @description 生成指定规模的环状图谱数据集。
 * @param scenario 场景配置。
 * @returns 可供浏览器 mock 使用的图谱响应。
 */
function buildMockGraphResponse(scenario: GraphScaleScenario): MockGraphResponse {
    const nodes: MockGraphNode[] = Array.from({ length: scenario.nodeCount }, (_, index) => ({
        path: `test-resources/notes/graph-${scenario.name}-${String(index).padStart(4, "0")}.md`,
        title: `Graph ${scenario.name} ${index}`,
    }));

    const edges: MockGraphEdge[] = [];
    for (let sourceIndex = 0; sourceIndex < nodes.length; sourceIndex += 1) {
        const sourceNode = nodes[sourceIndex];
        if (!sourceNode) {
            continue;
        }

        for (let offset = 1; offset <= scenario.edgesPerNode; offset += 1) {
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
 * @function measureKnowledgeGraphOpen
 * @description 测量知识图谱打开到统计信息稳定展示的耗时。
 * @param page Playwright 页面对象。
 * @param expectedNodeCount 期望节点数。
 * @param expectedEdgeCount 期望边数。
 * @returns 浏览器侧测量结果。
 */
async function measureKnowledgeGraphOpen(
    page: Page,
    expectedNodeCount: number,
    expectedEdgeCount: number,
): Promise<number> {
    return page.evaluate(async ({ nodeCount, edgeCount }) => {
        const trigger = document.querySelector(
            '[data-testid="activity-bar-item-knowledge-graph"]',
        ) as HTMLElement | null;
        if (!trigger) {
            throw new Error("knowledge graph activity button not found");
        }

        const start = performance.now();
        trigger.click();

        await new Promise<void>((resolve, reject) => {
            const timeoutAt = performance.now() + 15_000;

            const tick = (): void => {
                const statsElement = document.querySelector(
                    ".knowledge-graph-tab__stats",
                ) as HTMLElement | null;
                const statusElement = document.querySelector(
                    ".knowledge-graph-tab__status",
                ) as HTMLElement | null;
                const statsText = statsElement?.textContent?.trim() ?? "";
                const expectedStats = `nodes: ${String(nodeCount)} | edges: ${String(edgeCount)}`;
                const statusText = statusElement?.textContent?.trim() ?? "";

                if (
                    statsText === expectedStats
                    && statusText.length > 0
                    && !/loading|加载中|载入中/i.test(statusText)
                ) {
                    resolve();
                    return;
                }

                if (performance.now() >= timeoutAt) {
                    reject(new Error(`knowledge graph did not stabilize for ${expectedStats}`));
                    return;
                }

                window.requestAnimationFrame(tick);
            };

            tick();
        });

        return Number((performance.now() - start).toFixed(3));
    }, {
        nodeCount: expectedNodeCount,
        edgeCount: expectedEdgeCount,
    });
}

test.describe("知识图谱性能", () => {
    test("应在不同规模下产出知识图谱前端基线", async ({ page }) => {
        await gotoPerfMockVaultPage(page, "knowledge-graph-scale");

        const derivedMetrics: Array<Record<string, unknown>> = [];

        for (const [index, scenario] of GRAPH_SCALE_SCENARIOS.entries()) {
            if (index > 0) {
                await page.reload();
            }

            await waitForLayoutReady(page);

            const graphResponse = buildMockGraphResponse(scenario);
            await installGraphOverride(page, graphResponse);

            const openDurationMs = await measureKnowledgeGraphOpen(
                page,
                graphResponse.nodes.length,
                graphResponse.edges.length,
            );

            await expect(page.locator(".knowledge-graph-tab__stats")).toHaveText(
                `nodes: ${String(graphResponse.nodes.length)} | edges: ${String(graphResponse.edges.length)}`,
            );

            derivedMetrics.push({
                schemaVersion: "ofive.perf.metric.v1",
                name: "frontend.flow.open-knowledge-graph",
                category: "playwright-derived",
                status: "ok",
                runtime: "browser",
                durationMs: openDurationMs,
                details: {
                    dataset: scenario.name,
                    nodeCount: graphResponse.nodes.length,
                    edgeCount: graphResponse.edges.length,
                },
            });
        }

        const metrics = await readPerfMetrics(page);
        expect(metrics.some((metric) => metric.name === "frontend.performance.navigation")).toBe(true);

        await writeFrontendPerfReport("frontend-knowledge-graph-scale.json", {
            schemaVersion: "ofive.perf.report.v1",
            generatedAt: new Date().toISOString(),
            suite: "frontend-knowledge-graph-scale",
            metrics: [],
            derived: derivedMetrics,
        });
    });
});