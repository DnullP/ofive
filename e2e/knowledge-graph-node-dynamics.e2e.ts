/**
 * @module e2e/knowledge-graph-node-dynamics
 * @description 知识图谱节点动态效果回归测试。
 *
 * 覆盖场景：
 * 1. 使用固定 mock 图谱打开知识图谱。
 * 2. 通过节点坐标采样确认仿真补能后节点会持续运动并逐步稳定。
 * 3. 通过 canvas 像素采样确认节点聚焦/高亮环会产生可见渲染变化。
 *
 * @dependencies
 *   - @playwright/test
 *
 * @example
 *   bunx playwright test --config playwright.config.ts e2e/knowledge-graph-node-dynamics.e2e.ts --reporter=line
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const EXPECTED_NODE_COUNT = 14;
const EXPECTED_EDGE_COUNT = 21;

interface MockGraphNode {
    path: string;
    title: string;
    tags?: string[];
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

interface ScreenPoint {
    index: number;
    x: number;
    y: number;
    radius: number;
}

interface PixelEnergy {
    alpha: number;
    brightness: number;
    sampleCount: number;
}

type PointPositions = number[];

/**
 * @function waitForMockLayoutReady
 * @description 等待 mock workbench 完成初始布局。
 * @param page Playwright 页面对象。
 */
async function waitForMockLayoutReady(page: Page): Promise<void> {
    await page.locator("[data-testid='main-dockview-host']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-left']").waitFor({ state: "visible" });
}

/**
 * @function buildObsidianLikeMockGraph
 * @description 构造中心节点、主题节点和交叉边，模拟 Obsidian 本地知识库常见的 hub-and-spoke 图谱。
 * @returns mock 图谱响应。
 */
function buildObsidianLikeMockGraph(): MockGraphResponse {
    const nodes: MockGraphNode[] = Array.from({ length: EXPECTED_NODE_COUNT }, (_, index) => {
        const directory = index % 2 === 0 ? "projects" : "areas";
        return {
            path: `test-resources/notes/${directory}/obsidian-like-graph-${String(index).padStart(2, "0")}.md`,
            title: index === 0 ? "Index" : `Topic ${String(index)}`,
            tags: [index % 3 === 0 ? "project" : "area"],
        };
    });

    const edges: MockGraphEdge[] = [];
    const addEdge = (sourceIndex: number, targetIndex: number): void => {
        const sourceNode = nodes[sourceIndex];
        const targetNode = nodes[targetIndex];
        if (!sourceNode || !targetNode) {
            return;
        }

        edges.push({
            sourcePath: sourceNode.path,
            targetPath: targetNode.path,
            weight: 1,
        });
    };

    for (let index = 1; index < nodes.length; index += 1) {
        addEdge(0, index);
    }

    [
        [1, 2],
        [2, 3],
        [3, 4],
        [5, 6],
        [6, 7],
        [8, 9],
        [9, 10],
        [10, 11],
    ].forEach(([sourceIndex, targetIndex]) => addEdge(sourceIndex, targetIndex));

    return {
        nodes,
        edges,
    };
}

/**
 * @function installGraphOverride
 * @description 注入知识图谱 mock 数据。
 * @param page Playwright 页面对象。
 * @param graphResponse mock 图谱响应。
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
 * @function waitForKnowledgeGraphHook
 * @description 等待知识图谱测试 hook 可用。
 * @param page Playwright 页面对象。
 */
async function waitForKnowledgeGraphHook(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: unknown;
        };

        return Boolean(runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__);
    });
}

/**
 * @function getPointPositions
 * @description 从浏览器侧读取当前节点坐标。
 * @param page Playwright 页面对象。
 * @returns 节点坐标扁平数组。
 */
async function getPointPositions(page: Page): Promise<PointPositions> {
    return page.evaluate(() => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                getPointPositions: () => number[];
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph hook is unavailable");
        }

        return hook.getPointPositions();
    });
}

async function getSimulationRunning(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                getSimulationRunning: () => boolean;
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph hook is unavailable");
        }

        return hook.getSimulationRunning();
    });
}

/**
 * @function getVisibleScreenPoint
 * @description 选择一个位于画布内且留有采样边距的节点。
 * @param page Playwright 页面对象。
 * @returns 可见节点屏幕坐标。
 */
async function getVisibleScreenPoint(page: Page): Promise<ScreenPoint> {
    return page.evaluate(() => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                getHostRect: () => { width: number; height: number } | null;
                getPointScreenPositions: () => ScreenPoint[];
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph hook is unavailable");
        }

        const hostRect = hook.getHostRect();
        if (!hostRect) {
            throw new Error("knowledge graph host rect is unavailable");
        }

        const margin = 24;
        const point = hook.getPointScreenPositions().find((candidate) => (
            candidate.x >= margin
            && candidate.y >= margin
            && candidate.x <= hostRect.width - margin
            && candidate.y <= hostRect.height - margin
        ));
        if (!point) {
            throw new Error("no visible knowledge graph point can be sampled");
        }

        return point;
    });
}

/**
 * @function getPointScreenPositions
 * @description 读取当前节点屏幕坐标与半径。
 * @param page Playwright 页面对象。
 * @returns 节点屏幕坐标。
 */
async function getPointScreenPositions(page: Page): Promise<ScreenPoint[]> {
    return page.evaluate(() => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                getPointScreenPositions: () => ScreenPoint[];
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph hook is unavailable");
        }

        return hook.getPointScreenPositions();
    });
}

async function getGraphRenderSnapshot(page: Page): Promise<{
    colors: number[];
    settings: {
        linkDefaultWidth: number;
        linkOpacity: number;
        nodeColorGroups: Array<{
            id: string;
            query: string;
            color: string;
        }>;
    };
}> {
    return page.evaluate(() => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                getPointColors: () => number[];
                getRenderSettings: () => {
                    linkDefaultWidth: number;
                    linkOpacity: number;
                    nodeColorGroups: Array<{
                        id: string;
                        query: string;
                        color: string;
                    }>;
                };
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph hook is unavailable");
        }

        return {
            colors: hook.getPointColors(),
            settings: hook.getRenderSettings(),
        };
    });
}

function colorTupleAt(colors: number[], index: number): number[] {
    return colors.slice(index * 4, index * 4 + 4).map((value) => Math.round(value * 1000) / 1000);
}

async function selectColorGroupQueryWithKeyboard(
    page: Page,
    index: number,
    scope: "tag:" | "path:",
    prefix: string,
): Promise<void> {
    const input = page.getByTestId(`knowledge-graph-color-query-${index}`);
    const suggestions = page.getByTestId(`knowledge-graph-color-query-suggestions-${index}`);

    await input.click();
    await input.fill("");
    await expect(suggestions).toBeVisible();
    if (scope === "path:") {
        await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue(scope);

    await page.keyboard.type(prefix);
    await expect(suggestions).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue(new RegExp(`^${scope.replace(":", ":")}`));
}

/**
 * @function startSimulationAndWait
 * @description 触发仿真补能并等待若干帧，供位置采样。
 * @param page Playwright 页面对象。
 */
async function startSimulationAndWait(page: Page): Promise<void> {
    await startSimulation(page, 0.42);
    await waitForAnimationFrames(page, 16);
}

async function startSimulation(page: Page, alpha: number): Promise<void> {
    await page.evaluate((nextAlpha) => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                startSimulation: (alpha?: number) => void;
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph hook is unavailable");
        }

        hook.startSimulation(nextAlpha);
    }, alpha);
}

async function waitForAnimationFrames(page: Page, frameCount: number): Promise<void> {
    await page.evaluate(async (targetFrameCount) => {
        await new Promise<void>((resolve) => {
            let frames = 0;
            const tick = (): void => {
                frames += 1;
                if (frames >= targetFrameCount) {
                    resolve();
                    return;
                }

                window.requestAnimationFrame(tick);
            };

            window.requestAnimationFrame(tick);
        });
    }, frameCount);
}

/**
 * @function computeMaxDisplacement
 * @description 计算两次位置采样之间的最大节点位移。
 * @param before 起始位置。
 * @param after 结束位置。
 * @returns 最大位移。
 */
function computeMaxDisplacement(before: PointPositions, after: PointPositions): number {
    let maxDistance = 0;
    const pairCount = Math.min(before.length, after.length) / 2;
    for (let index = 0; index < pairCount; index += 1) {
        const beforeX = before[index * 2] ?? 0;
        const beforeY = before[index * 2 + 1] ?? 0;
        const afterX = after[index * 2] ?? 0;
        const afterY = after[index * 2 + 1] ?? 0;
        const distance = Math.hypot(afterX - beforeX, afterY - beforeY);
        maxDistance = Math.max(maxDistance, distance);
    }

    return maxDistance;
}

/**
 * @function sampleFocusedPointEnergy
 * @description 采样聚焦节点周围像素能量。
 * @param page Playwright 页面对象。
 * @param pointIndex 节点索引。
 * @param focused 是否启用聚焦环。
 * @returns 像素能量。
 */
async function sampleFocusedPointEnergy(
    page: Page,
    pointIndex: number,
    focused: boolean,
): Promise<PixelEnergy> {
    return page.evaluate(async ({ index, shouldFocus }) => {
        const runtimeWindow = window as Window & {
            __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                focusPoint: (index: number | null) => void;
                renderFrame: (alpha?: number) => void;
                samplePointPixelEnergy: (index: number, radius?: number) => PixelEnergy | null;
            };
        };

        const hook = runtimeWindow.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
        if (!hook) {
            throw new Error("knowledge graph hook is unavailable");
        }

        hook.focusPoint(shouldFocus ? index : null);
        hook.renderFrame(0);

        await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
        });

        const energy = hook.samplePointPixelEnergy(index, 12);
        if (!energy) {
            throw new Error("knowledge graph point pixel energy is unavailable");
        }

        return energy;
    }, {
        index: pointIndex,
        shouldFocus: focused,
    });
}

test.describe("knowledge graph node dynamics", () => {
    test("samples Obsidian-like node motion and highlight rendering", async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await waitForMockLayoutReady(page);
        await installGraphOverride(page, buildObsidianLikeMockGraph());

        await page.getByTestId("activity-bar-item-knowledge-graph").click();
        await expect(page.locator(".knowledge-graph-tab__stats")).toHaveText(
            `nodes: ${String(EXPECTED_NODE_COUNT)} | edges: ${String(EXPECTED_EDGE_COUNT)}`,
            { timeout: 10_000 },
        );
        await waitForKnowledgeGraphHook(page);

        const screenPoints = await getPointScreenPositions(page);
        const hubPoint = screenPoints.find((item) => item.index === 0);
        const leafPoint = screenPoints.find((item) => item.index === 12);
        expect(hubPoint?.radius).toBeGreaterThan(leafPoint?.radius ?? 0);
        expect((hubPoint?.radius ?? 0) / (leafPoint?.radius ?? 1)).toBeLessThan(3);

        await page.getByRole("button", { name: /图谱渲染设置|Graph render settings/ }).click();
        await page.getByTestId("knowledge-graph-link-opacity-input").fill("0.25");
        await page.getByTestId("knowledge-graph-link-width-input").fill("2.4");
        await page.getByTestId("knowledge-graph-add-color-group").click();
        await selectColorGroupQueryWithKeyboard(page, 0, "tag:", "#pr");
        await page.getByTestId("knowledge-graph-color-swatch-0").fill("#ff0000");
        await page.getByTestId("knowledge-graph-add-color-group").click();
        await selectColorGroupQueryWithKeyboard(page, 1, "tag:", "#ar");
        await page.getByTestId("knowledge-graph-color-swatch-1").fill("#00ff00");
        await expect.poll(async () => (await getGraphRenderSnapshot(page)).settings.nodeColorGroups.length).toBe(2);
        await expect.poll(async () => (await getGraphRenderSnapshot(page)).settings.nodeColorGroups[0]?.query).toBe("tag:#project");
        await expect.poll(async () => (await getGraphRenderSnapshot(page)).settings.nodeColorGroups[1]?.query).toBe("tag:#area");
        const tagSnapshot = await getGraphRenderSnapshot(page);
        expect(tagSnapshot.settings.linkOpacity).toBeCloseTo(0.25, 2);
        expect(tagSnapshot.settings.linkDefaultWidth).toBeCloseTo(2.4, 1);
        expect(colorTupleAt(tagSnapshot.colors, 0)).toEqual(colorTupleAt(tagSnapshot.colors, 3));
        expect(colorTupleAt(tagSnapshot.colors, 0)).not.toEqual(colorTupleAt(tagSnapshot.colors, 1));

        await selectColorGroupQueryWithKeyboard(page, 0, "path:", "pro");
        await page.getByTestId("knowledge-graph-color-swatch-0").fill("#0000ff");
        await selectColorGroupQueryWithKeyboard(page, 1, "path:", "are");
        await page.getByTestId("knowledge-graph-color-swatch-1").fill("#ffff00");
        await expect.poll(async () => (await getGraphRenderSnapshot(page)).settings.nodeColorGroups[0]?.query).toBe("path:projects");
        await expect.poll(async () => (await getGraphRenderSnapshot(page)).settings.nodeColorGroups[1]?.query).toBe("path:areas");
        const directorySnapshot = await getGraphRenderSnapshot(page);
        expect(colorTupleAt(directorySnapshot.colors, 0)).toEqual(colorTupleAt(directorySnapshot.colors, 2));
        expect(colorTupleAt(directorySnapshot.colors, 0)).not.toEqual(colorTupleAt(directorySnapshot.colors, 1));

        const runningColorUpdatePositionsBefore = await getPointPositions(page);
        await startSimulation(page, 0.42);
        await page.getByTestId("knowledge-graph-color-swatch-0").fill("#ff00ff");
        await expect.poll(async () => getSimulationRunning(page)).toBe(true);
        await waitForAnimationFrames(page, 16);
        const runningColorUpdatePositionsAfter = await getPointPositions(page);
        expect(
            computeMaxDisplacement(
                runningColorUpdatePositionsBefore,
                runningColorUpdatePositionsAfter,
            ),
        ).toBeGreaterThan(0.5);

        const positionsBefore = await getPointPositions(page);
        await startSimulationAndWait(page);
        const positionsAfter = await getPointPositions(page);
        expect(computeMaxDisplacement(positionsBefore, positionsAfter)).toBeGreaterThan(0.5);

        const point = await getVisibleScreenPoint(page);
        const energyBeforeFocus = await sampleFocusedPointEnergy(page, point.index, false);
        const energyAfterFocus = await sampleFocusedPointEnergy(page, point.index, true);
        const brightnessDelta = energyAfterFocus.brightness - energyBeforeFocus.brightness;
        const alphaDelta = energyAfterFocus.alpha - energyBeforeFocus.alpha;

        expect(energyBeforeFocus.sampleCount).toBeGreaterThan(0);
        expect(energyAfterFocus.sampleCount).toBeGreaterThan(0);
        expect(Math.max(brightnessDelta, alphaDelta)).toBeGreaterThan(0.1);
    });
});
