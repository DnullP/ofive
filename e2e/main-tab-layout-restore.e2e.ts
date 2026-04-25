/**
 * @module e2e/main-tab-layout-restore.e2e
 * @description 主编辑区 tab split 与 reload 回归：验证主区 split 不会污染侧边栏 panelLayout 持久化，reload 后仍可正常打开文章。
 * @dependencies
 *   - @playwright/test
 *   - web-mock/mock-tauri-test.html
 *
 * @example
 *   bunx playwright test e2e/main-tab-layout-restore.e2e.ts --reporter=line
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";
const NETWORK_NOTE_PATH = "test-resources/notes/network-segment.md";
const SPLIT_SETTLE_MS = 360;

interface TabSectionSnapshot {
    id: string | null;
    titles: string[];
}

interface PersistedPanelLayoutProbe {
    hasPanelLayout: boolean;
    mainTabsHasSplit: boolean;
    hasMainTabsSplitLeaf: boolean;
}

/**
 * @function waitForMockWorkbench
 * @description 打开 mock 工作台并等待 layout-v2 主体可见。
 * @param page Playwright 页面。
 * @returns Promise 完成后页面可交互。
 * @throws 若页面或工作台未能按时加载则由 Playwright 抛出。
 */
async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.addInitScript(() => {
        localStorage.clear();
    });
    await page.goto(MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section").first().waitFor({ state: "visible" });
}

/**
 * @function expandMockNotes
 * @description 展开 mock vault 中的 notes 目录。
 * @param page Playwright 页面。
 * @returns Promise 完成后 notes 下文件项可见。
 * @throws 若文件树结构未能按时加载则由 Playwright 抛出。
 */
async function expandMockNotes(page: Page): Promise<void> {
    if (await page.locator(".tree-item[data-tree-path='test-resources/notes']").count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

/**
 * @function openMockNote
 * @description 从文件树打开指定 mock Markdown 文件。
 * @param page Playwright 页面。
 * @param relativePath mock 文件相对路径。
 * @returns Promise 完成后对应 tab 可见。
 * @throws 若文件树或 tab 未能按时出现则由 Playwright 抛出。
 */
async function openMockNote(page: Page, relativePath: string): Promise<void> {
    await expandMockNotes(page);
    const fileName = relativePath.split("/").pop() ?? relativePath;
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    await page.getByRole("button", { name: fileName }).first().waitFor({ state: "visible" });
}

/**
 * @function readTabSections
 * @description 读取当前主工作台中的 tab section 摘要。
 * @param page Playwright 页面。
 * @returns 当前 tab section id 与标题列表。
 * @throws 无显式异常；DOM 缺失时返回空列表。
 */
async function readTabSections(page: Page): Promise<TabSectionSnapshot[]> {
    return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".layout-v2-tab-section")).map((node) => ({
        id: node.getAttribute("data-tab-section-id"),
        titles: Array.from(node.querySelectorAll<HTMLElement>(".layout-v2-tab-section__tab-title")).map(
            (title) => title.textContent ?? "",
        ),
    })));
}

/**
 * @function dragLocatorToPoint
 * @description 使用真实鼠标事件将 locator 拖到指定坐标，覆盖 tab split 的 pointer 生命周期。
 * @param page Playwright 页面。
 * @param locator 拖拽源。
 * @param targetX 目标 x 坐标。
 * @param targetY 目标 y 坐标。
 * @returns Promise 完成后拖拽提交。
 * @throws 若源元素缺少布局信息则抛出异常。
 */
async function dragLocatorToPoint(
    page: Page,
    locator: Locator,
    targetX: number,
    targetY: number,
): Promise<void> {
    await locator.waitFor({ state: "visible" });
    const sourceBounds = await locator.boundingBox();
    if (!sourceBounds) {
        throw new Error("dragLocatorToPoint: source bounds missing");
    }

    await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 12 });
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(SPLIT_SETTLE_MS);
}

/**
 * @function splitTabToRight
 * @description 将指定 tab 拖到 main-tabs 内容区右侧边缘以创建左右 split。
 * @param page Playwright 页面。
 * @param tabTitle 待拖拽 tab 标题。
 * @returns Promise 完成后 split 提交。
 * @throws 若目标内容区缺少布局信息则抛出异常。
 */
async function splitTabToRight(page: Page, tabTitle: string): Promise<void> {
    const sourceTab = page.locator(".layout-v2-tab-section__tab-main", { hasText: tabTitle }).first();
    const targetContent = page
        .locator('.layout-v2-tab-section[data-tab-section-id="main-tabs"] .layout-v2-tab-section__content')
        .first();
    const targetBounds = await targetContent.boundingBox();
    if (!targetBounds) {
        throw new Error("splitTabToRight: target bounds missing");
    }

    await dragLocatorToPoint(
        page,
        sourceTab,
        targetBounds.x + targetBounds.width - 14,
        targetBounds.y + targetBounds.height / 2,
    );
}

/**
 * @function readPersistedPanelLayoutProbe
 * @description 从 mock config store 读取 panelLayout 持久化中是否混入主区 tab split。
 * @param page Playwright 页面。
 * @returns panelLayout 探针状态。
 * @throws 若动态导入配置 store 失败则由浏览器侧抛出。
 */
async function readPersistedPanelLayoutProbe(page: Page): Promise<PersistedPanelLayoutProbe> {
    return page.evaluate(async () => {
        const configStoreModule = await import("/src/host/config/configStore.ts");
        const entries = configStoreModule.getConfigSnapshot().backendConfig?.entries ?? {};
        const sidebarLayout = entries.sidebarLayout as { panelLayout?: { root?: unknown } } | undefined;
        const panelLayoutRoot = sidebarLayout?.panelLayout?.root ?? null;

        function findSection(node: unknown, id: string): { split?: unknown } | null {
            if (!node || typeof node !== "object") {
                return null;
            }

            const item = node as { id?: unknown; split?: { children?: unknown[] } | null };
            if (item.id === id) {
                return item;
            }

            const children = Array.isArray(item.split?.children) ? item.split.children : [];
            for (const child of children) {
                const matched = findSection(child, id);
                if (matched) {
                    return matched;
                }
            }

            return null;
        }

        return {
            hasPanelLayout: Boolean(panelLayoutRoot),
            mainTabsHasSplit: Boolean(findSection(panelLayoutRoot, "main-tabs")?.split),
            hasMainTabsSplitLeaf: Boolean(findSection(panelLayoutRoot, "main-tabs-split")),
        };
    });
}

test.describe("main tab layout restore regression", () => {
    test("main tab split should not poison panel layout restore after reload", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        await waitForMockWorkbench(page);
        await openMockNote(page, GUIDE_NOTE_PATH);
        await openMockNote(page, NETWORK_NOTE_PATH);

        await splitTabToRight(page, "network-segment.md");
        const splitSections = await readTabSections(page);
        expect(splitSections).toHaveLength(2);
        expect(splitSections.some((section) => section.titles.includes("network-segment.md"))).toBe(true);

        await expect.poll(
            async () => readPersistedPanelLayoutProbe(page),
            { timeout: 3_000 },
        ).toEqual({
            hasPanelLayout: true,
            mainTabsHasSplit: false,
            hasMainTabsSplitLeaf: false,
        });

        await page.reload();
        await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
        await page.locator(".layout-v2-tab-section").first().waitFor({ state: "visible" });

        const restoredSections = await readTabSections(page);
        expect(restoredSections).toHaveLength(1);
        expect(restoredSections[0]?.id).toBe("main-tabs");
        expect(restoredSections[0]?.titles).toEqual(["首页"]);
        await expect(page.locator(".layout-v2-tab-section", { hasText: "No open tabs" })).toHaveCount(0);

        await openMockNote(page, NETWORK_NOTE_PATH);
        const afterOpenSections = await readTabSections(page);
        expect(afterOpenSections).toHaveLength(1);
        expect(afterOpenSections[0]?.titles).toContain("network-segment.md");
        expect(pageErrors).toEqual([]);
    });
});
