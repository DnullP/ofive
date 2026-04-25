/**
 * @module e2e/knowledge-graph-tab-lifecycle
 * @description 知识图谱 tab 生命周期回归测试。
 *
 * 覆盖场景：
 * 1. 打开知识图谱后切换到 Markdown tab，图谱内容应保持 inactive 挂载。
 * 2. 再切回知识图谱，不应重新初始化图实例或重新加载图数据。
 *
 * @dependencies
 *   - @playwright/test
 *
 * @example
 *   bunx playwright test --config playwright.config.ts e2e/knowledge-graph-tab-lifecycle.e2e.ts --reporter=line
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";

interface KnowledgeGraphLifecycleCounters {
    init: number;
    destroy: number;
    load: number;
}

/**
 * @function waitForMockLayoutReady
 * @description 等待 mock workbench 与左右侧栏完成初始渲染。
 * @param page Playwright 页面对象。
 * @returns Promise<void>
 */
async function waitForMockLayoutReady(page: Page): Promise<void> {
    await page.locator("[data-testid='sidebar-left']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab-main").first().waitFor({ state: "visible" });
}

/**
 * @function ensureMockNotesTreeExpanded
 * @description 确保 mock 文件树中的 notes 目录已展开，便于打开 Markdown tab。
 * @param page Playwright 页面对象。
 * @returns Promise<void>
 */
async function ensureMockNotesTreeExpanded(page: Page): Promise<void> {
    const rootItem = page.locator(".tree-item[data-tree-path='test-resources']");
    const notesItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    const guideItem = page.locator(`.tree-item[data-tree-path='${GUIDE_NOTE_PATH}']`);

    await rootItem.waitFor({ state: "visible" });

    if (!await notesItem.isVisible().catch(() => false)) {
        await rootItem.click();
        await notesItem.waitFor({ state: "visible" });
    }

    if (!await guideItem.isVisible().catch(() => false)) {
        await notesItem.click();
    }

    await guideItem.waitFor({ state: "visible" });
}

/**
 * @function collectKnowledgeGraphLifecycleCounters
 * @description 收集知识图谱关键生命周期日志计数，用于判断切换 tab 是否触发重载。
 * @param page Playwright 页面对象。
 * @returns 生命周期计数器。
 */
function collectKnowledgeGraphLifecycleCounters(page: Page): KnowledgeGraphLifecycleCounters {
    const counters: KnowledgeGraphLifecycleCounters = {
        init: 0,
        destroy: 0,
        load: 0,
    };

    page.on("console", (message) => {
        const text = message.text();
        if (text.includes("[knowledge-graph] graph instance initialized")) {
            counters.init += 1;
        }
        if (text.includes("[knowledge-graph] graph instance destroyed")) {
            counters.destroy += 1;
        }
        if (text.includes("[knowledge-graph] loading markdown graph data")) {
            counters.load += 1;
        }
    });

    return counters;
}

test.describe("knowledge graph tab lifecycle", () => {
    test("switching tabs should keep the graph mounted without reloading data", async ({ page }) => {
        const lifecycle = collectKnowledgeGraphLifecycleCounters(page);

        await page.goto(MOCK_PAGE);
        await waitForMockLayoutReady(page);

        await page.getByTestId("activity-bar-item-knowledge-graph").click();
        await expect(page.locator(".layout-v2-tab-section__tab-title", { hasText: "知识图谱" })).toBeVisible();
        await expect(page.locator(".knowledge-graph-tab").first()).toBeVisible();
        await expect(page.locator(".knowledge-graph-tab__empty--status")).toHaveCount(0, { timeout: 10_000 });
        await expect.poll(() => lifecycle.load, { timeout: 10_000 }).toBeGreaterThan(0);
        await expect.poll(() => lifecycle.init, { timeout: 10_000 }).toBeGreaterThan(0);

        const baseline = { ...lifecycle };

        await ensureMockNotesTreeExpanded(page);
        await page.locator(`.tree-item[data-tree-path='${GUIDE_NOTE_PATH}']`).dblclick();
        await page.locator(".layout-v2-tab-section__tab-main", { hasText: "guide.md" }).click();

        await expect(page.locator(".layout-v2-tab-section__tab--focused", { hasText: "guide.md" })).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__card--inactive", {
            has: page.locator(".knowledge-graph-tab"),
        })).toHaveCount(1);
        await expect.poll(() => lifecycle.destroy, { timeout: 2_000 }).toBe(baseline.destroy);
        await expect.poll(() => lifecycle.load, { timeout: 2_000 }).toBe(baseline.load);
        await expect.poll(() => lifecycle.init, { timeout: 2_000 }).toBe(baseline.init);

        await page.locator(".layout-v2-tab-section__tab-main", { hasText: "知识图谱" }).click();

        await expect(page.locator(".layout-v2-tab-section__tab--focused", { hasText: "知识图谱" })).toBeVisible();
        await expect(page.locator(".knowledge-graph-tab").first()).toBeVisible();
        await expect.poll(() => lifecycle.destroy, { timeout: 2_000 }).toBe(baseline.destroy);
        await expect.poll(() => lifecycle.load, { timeout: 2_000 }).toBe(baseline.load);
        await expect.poll(() => lifecycle.init, { timeout: 2_000 }).toBe(baseline.init);
    });
});
