/**
 * @module e2e/main-tab-layout-restore.e2e
 * @description 主编辑区 tab split 与 reload 回归：验证主区 split 使用独立 workspaceLayout 恢复，并且不会污染侧边栏 panelLayout。
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
const LATEX_NOTE_PATH = "test-resources/notes/latex-test.md";
const SCROLL_NOTE_PATH = "test-resources/notes/scroll-regression.md";
const CANVAS_NOTE_PATH = "test-resources/notes/glass-validation.canvas";
const IMAGE_NOTE_PATH = "test-resources/notes/mock-image.png";
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

interface PersistedWorkspaceLayoutProbe {
    hasWorkspaceLayout: boolean;
    tabCount: number;
    mainTabsHasSplit: boolean;
    hasPersistedContentParam: boolean;
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
        if (sessionStorage.getItem("__ofive_main_tab_layout_restore_initialized") !== "1") {
            localStorage.clear();
            sessionStorage.setItem("__ofive_main_tab_layout_restore_initialized", "1");
        }
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

async function reloadWorkbench(page: Page): Promise<void> {
    await page.reload();
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section").first().waitFor({ state: "visible" });
}

async function focusTab(page: Page, tabTitle: string): Promise<void> {
    await page.getByRole("button", { name: tabTitle, exact: true }).first().click();
}

async function closeTab(page: Page, tabTitle: string): Promise<void> {
    await page.getByRole("button", { name: `Close ${tabTitle}`, exact: true }).first().click();
    await page.waitForTimeout(120);
}

async function updateRestoreWorkspaceLayout(page: Page, enabled: boolean): Promise<void> {
    await page.evaluate(async (nextEnabled) => {
        const configStoreModule = await import("/src/host/config/configStore.ts");
        await configStoreModule.updateFeatureSetting("restoreWorkspaceLayout", nextEnabled);
    }, enabled);

    await expect.poll(
        async () => page.evaluate(async () => {
            const configStoreModule = await import("/src/host/config/configStore.ts");
            return configStoreModule.getConfigSnapshot().featureSettings.restoreWorkspaceLayout;
        }),
        { timeout: 2_000 },
    ).toBe(enabled);
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

async function readPersistedWorkspaceLayoutProbe(page: Page): Promise<PersistedWorkspaceLayoutProbe> {
    return page.evaluate(async () => {
        const configStoreModule = await import("/src/host/config/configStore.ts");
        const entries = configStoreModule.getConfigSnapshot().backendConfig?.entries ?? {};
        const workspaceLayout = entries.workspaceLayout as {
            root?: unknown;
            tabSections?: Array<{ tabs?: Array<{ params?: Record<string, unknown> }> }>;
        } | undefined;
        const workspaceRoot = workspaceLayout?.root ?? null;

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

        const tabSections = Array.isArray(workspaceLayout?.tabSections)
            ? workspaceLayout.tabSections
            : [];
        const tabs = tabSections.flatMap((section) => Array.isArray(section.tabs) ? section.tabs : []);

        return {
            hasWorkspaceLayout: Boolean(workspaceRoot),
            tabCount: tabs.length,
            mainTabsHasSplit: Boolean(findSection(workspaceRoot, "main-tabs")?.split),
            hasPersistedContentParam: tabs.some((tab) => Boolean(tab.params && "content" in tab.params)),
        };
    });
}

async function openSplitWorkspaceAndReload(page: Page): Promise<void> {
    await openMockNote(page, GUIDE_NOTE_PATH);
    await openMockNote(page, NETWORK_NOTE_PATH);
    await splitTabToRight(page, "network-segment.md");

    await expect.poll(
        async () => readPersistedWorkspaceLayoutProbe(page),
        { timeout: 3_000 },
    ).toEqual({
        hasWorkspaceLayout: true,
        tabCount: 3,
        mainTabsHasSplit: true,
        hasPersistedContentParam: false,
    });

    await reloadWorkbench(page);
    await expect.poll(
        async () => readTabSections(page),
        { timeout: 5_000 },
    ).toHaveLength(2);
}

test.describe("main tab layout restore regression", () => {
    test("main tab split should restore from workspace layout without poisoning panel layout", async ({ page }) => {
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
        ).toMatchObject({
            mainTabsHasSplit: false,
            hasMainTabsSplitLeaf: false,
        });

        await expect.poll(
            async () => readPersistedWorkspaceLayoutProbe(page),
            { timeout: 3_000 },
        ).toEqual({
            hasWorkspaceLayout: true,
            tabCount: 3,
            mainTabsHasSplit: true,
            hasPersistedContentParam: false,
        });
        await reloadWorkbench(page);

        await expect.poll(
            async () => {
                const sections = await readTabSections(page);
                const titles = sections.flatMap((section) => section.titles);
                return {
                    sectionCount: sections.length,
                    hasHome: titles.includes("首页"),
                    hasGuide: titles.includes("guide.md"),
                    hasNetwork: titles.includes("network-segment.md"),
                    hasEmptySection: sections.some((section) => section.titles.length === 0),
                };
            },
            { timeout: 5_000 },
        ).toEqual({
            sectionCount: 2,
            hasHome: true,
            hasGuide: true,
            hasNetwork: true,
            hasEmptySection: false,
        });
        await expect(page.locator(".layout-v2-tab-section", { hasText: "No open tabs" })).toHaveCount(0);
        expect(pageErrors).toEqual([]);
    });

    test("closing the restored right split tab should destroy the empty section and keep one final empty tab section", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        await waitForMockWorkbench(page);
        await openSplitWorkspaceAndReload(page);

        await closeTab(page, "network-segment.md");
        await expect.poll(
            async () => {
                const sections = await readTabSections(page);
                return {
                    sectionCount: sections.length,
                    titles: sections.flatMap((section) => section.titles),
                    hasEmptySection: sections.some((section) => section.titles.length === 0),
                };
            },
            { timeout: 3_000 },
        ).toEqual({
            sectionCount: 1,
            titles: ["首页", "guide.md"],
            hasEmptySection: false,
        });

        await closeTab(page, "guide.md");
        await closeTab(page, "首页");
        await expect.poll(
            async () => {
                const sections = await readTabSections(page);
                return {
                    sectionCount: sections.length,
                    tabCount: sections.reduce((sum, section) => sum + section.titles.length, 0),
                    hasEmptySection: sections.some((section) => section.titles.length === 0),
                };
            },
            { timeout: 3_000 },
        ).toEqual({
            sectionCount: 1,
            tabCount: 0,
            hasEmptySection: true,
        });
        await expect(page.locator(".layout-v2-tab-section", { hasText: "No open tabs" })).toHaveCount(1);
        expect(pageErrors).toEqual([]);
    });

    test("closing the restored left split tabs should merge into the right section", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        await waitForMockWorkbench(page);
        await openSplitWorkspaceAndReload(page);

        await closeTab(page, "guide.md");
        await closeTab(page, "首页");
        await expect.poll(
            async () => {
                const sections = await readTabSections(page);
                return {
                    sectionCount: sections.length,
                    titles: sections.flatMap((section) => section.titles),
                    hasEmptySection: sections.some((section) => section.titles.length === 0),
                };
            },
            { timeout: 3_000 },
        ).toEqual({
            sectionCount: 1,
            titles: ["network-segment.md"],
            hasEmptySection: false,
        });
        await expect(page.locator(".layout-v2-tab-section", { hasText: "No open tabs" })).toHaveCount(0);
        expect(pageErrors).toEqual([]);
    });

    test("restores multiple tabs in each split section", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        await waitForMockWorkbench(page);
        await openMockNote(page, GUIDE_NOTE_PATH);
        await openMockNote(page, NETWORK_NOTE_PATH);
        await splitTabToRight(page, "network-segment.md");

        await focusTab(page, "guide.md");
        await openMockNote(page, LATEX_NOTE_PATH);
        await focusTab(page, "network-segment.md");
        await openMockNote(page, SCROLL_NOTE_PATH);

        await expect.poll(
            async () => readPersistedWorkspaceLayoutProbe(page),
            { timeout: 3_000 },
        ).toEqual({
            hasWorkspaceLayout: true,
            tabCount: 5,
            mainTabsHasSplit: true,
            hasPersistedContentParam: false,
        });

        await reloadWorkbench(page);
        await expect.poll(
            async () => {
                const sections = await readTabSections(page);
                return sections.map((section) => section.titles);
            },
            { timeout: 5_000 },
        ).toEqual([
            ["首页", "guide.md", "latex-test.md"],
            ["network-segment.md", "scroll-regression.md"],
        ]);
        expect(pageErrors).toEqual([]);
    });

    test("restores canvas, image viewer, and knowledge graph tabs", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        await waitForMockWorkbench(page);
        await openMockNote(page, CANVAS_NOTE_PATH);
        await openMockNote(page, IMAGE_NOTE_PATH);
        await page.getByTestId("activity-bar-item-knowledge-graph").click();
        await page.getByRole("button", { name: "知识图谱", exact: true }).first().waitFor({ state: "visible" });

        await expect.poll(
            async () => readPersistedWorkspaceLayoutProbe(page),
            { timeout: 3_000 },
        ).toEqual({
            hasWorkspaceLayout: true,
            tabCount: 4,
            mainTabsHasSplit: false,
            hasPersistedContentParam: false,
        });

        await reloadWorkbench(page);
        await expect.poll(
            async () => {
                const sections = await readTabSections(page);
                return sections.flatMap((section) => section.titles);
            },
            { timeout: 5_000 },
        ).toEqual(["首页", "glass-validation.canvas", "mock-image.png", "知识图谱"]);

        await focusTab(page, "glass-validation.canvas");
        await expect(page.locator(".canvas-tab")).toBeVisible();
        await focusTab(page, "mock-image.png");
        await expect(page.locator(".image-viewer-tab")).toBeVisible();
        await expect(page.locator(".image-viewer-header")).toHaveText(IMAGE_NOTE_PATH);
        await focusTab(page, "知识图谱");
        await expect(page.locator(".knowledge-graph-tab")).toBeVisible();
        expect(pageErrors).toEqual([]);
    });

    test("restore workspace layout switch should ignore persisted layouts when disabled", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        await waitForMockWorkbench(page);
        await openMockNote(page, GUIDE_NOTE_PATH);
        await openMockNote(page, NETWORK_NOTE_PATH);
        await splitTabToRight(page, "network-segment.md");
        await expect.poll(
            async () => readPersistedWorkspaceLayoutProbe(page),
            { timeout: 3_000 },
        ).toEqual({
            hasWorkspaceLayout: true,
            tabCount: 3,
            mainTabsHasSplit: true,
            hasPersistedContentParam: false,
        });

        await updateRestoreWorkspaceLayout(page, false);
        await reloadWorkbench(page);

        await expect.poll(
            async () => readTabSections(page),
            { timeout: 5_000 },
        ).toEqual([
            {
                id: "main-tabs",
                titles: ["首页"],
            },
        ]);
        await expect.poll(
            async () => readPersistedWorkspaceLayoutProbe(page),
            { timeout: 3_000 },
        ).toEqual({
            hasWorkspaceLayout: true,
            tabCount: 3,
            mainTabsHasSplit: true,
            hasPersistedContentParam: false,
        });
        expect(pageErrors).toEqual([]);
    });
});
