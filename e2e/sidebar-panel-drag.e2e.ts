/**
 * @module e2e/sidebar-panel-drag.e2e
 * @description 侧栏面板跨容器拖拽 E2E 测试。
 *
 * 验证场景：
 * 1. 左侧栏面板拖拽到右侧栏：面板从左侧消失，出现在右侧
 * 2. 点击右侧栏 activity icon 切换面板
 * 3. 右侧栏面板拖拽回左侧栏（回归：拖回后不消失）
 * 4. Icon-Panel 解耦：拖拽面板时 icon 不跟随移动
 * 5. 面板加入目标 activity 分组：拖到右侧后归属目标 activity
 * 6. 面板往返拖拽后 icon 位置不变
 *
 * 前置条件（Mock 页面默认布局）：
 *   - 左侧栏：资源管理器（files activity）
 *   - 右侧栏：大纲 + 反向链接（outline activity）
 *
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/dockviewDrag
 *
 * @example
 *   bun run test:e2e
 */

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Mock 页面路径（不依赖 Tauri 后端）
 */
const MOCK_PAGE = "/web-mock/mock-tauri-test.html";

/* ══════════════════════════════════════════════════════════════════════
 *  右侧栏 icon 切换（layout-v2 迁移后，无需 DnD）
 * ══════════════════════════════════════════════════════════════════════ */
test.describe("右侧栏 activity icon 切换面板", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await page.locator("[data-testid='sidebar-right']").waitFor({ state: "visible" });
        await page.locator(".layout-v2-panel-section__panel-tab").first().waitFor({ state: "visible" });
    });

    test("Case 2: 键盘快捷键切换右侧栏显隐", async ({ page }) => {
        const rightSidebar = page.locator("[data-testid='sidebar-right']");

        await expect(rightSidebar).toBeVisible();

        const outlineTab = page.locator("[data-layout-panel-id='outline'][data-layout-role='panel']");
        await expect(outlineTab).toBeVisible();

        /* 通过键盘快捷键 Cmd+Shift+K 隐藏右侧栏 */
        await page.keyboard.press("Meta+Shift+K");
        await expect(rightSidebar).toHaveCount(0);

        /* 通过键盘快捷键 Cmd+Shift+K 恢复右侧栏 */
        await page.keyboard.press("Meta+Shift+K");
        await expect(rightSidebar).toBeVisible({ timeout: 3000 });

        /* 再次 toggle 回隐藏 */
        await page.keyboard.press("Meta+Shift+K");
        await expect(rightSidebar).toHaveCount(0);
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  layout-v2 panel icon split 持久化恢复
 * ══════════════════════════════════════════════════════════════════════ */

/** 浏览器 fallback vault config 的 localStorage key 前缀。 */
const BROWSER_FALLBACK_CONFIG_PREFIX = "ofive:browser-fallback:vault-config:";

async function dragLocatorToPoint(
    page: Page,
    locator: ReturnType<Page["locator"]>,
    target: { x: number; y: number },
): Promise<void> {
    const sourceBox = await locator.boundingBox();
    expect(sourceBox).not.toBeNull();

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 18 });
    await page.mouse.up();
}

async function dragSidebarDivider(page: Page, dividerIndex: number, deltaX: number): Promise<void> {
    const divider = page
        .locator(".layout-v2__divider--horizontal[aria-label='Resize sections']")
        .nth(dividerIndex);
    await expect(divider).toBeVisible();

    const box = await divider.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY, { steps: 8 });
    await page.mouse.up();
}

function buildLegacyWorkspaceLayoutWithRightPanelSplit(): Record<string, unknown> {
    return {
        version: 1,
        root: {
            id: "root",
            title: "Workbench Root",
            data: { role: "root", component: { type: "empty", props: { label: "Root", description: "workbench root" } } },
            split: {
                direction: "horizontal",
                ratio: 0.04,
                children: [
                    {
                        id: "left-activity-bar",
                        title: "Left Activity Bar",
                        data: { role: "activity-bar", component: { type: "activity-rail", props: {} } },
                        resizableEdges: { top: true, right: false, bottom: true, left: true },
                        meta: { fixedSizePx: 48 },
                        split: null,
                    },
                    {
                        id: "workbench-shell",
                        title: "Workbench Shell",
                        data: { role: "container", component: { type: "empty", props: { label: "Workbench", description: "workbench container" } } },
                        split: {
                            direction: "horizontal",
                            ratio: 0.22,
                            children: [
                                {
                                    id: "left-sidebar",
                                    title: "Left Sidebar",
                                    data: { role: "sidebar", component: { type: "panel-section", props: { panelSectionId: "left-panel-section" } } },
                                    split: null,
                                },
                                {
                                    id: "center-shell",
                                    title: "Center Shell",
                                    data: { role: "container", component: { type: "empty", props: { label: "Center", description: "main region" } } },
                                    split: {
                                        direction: "horizontal",
                                        ratio: 0.78,
                                        children: [
                                            {
                                                id: "main-tabs",
                                                title: "Main Tabs",
                                                data: { role: "main", component: { type: "tab-section", props: { tabSectionId: "main-tabs" } } },
                                                split: null,
                                            },
                                            {
                                                id: "right-sidebar",
                                                title: "Right Sidebar",
                                                data: { role: "sidebar", component: { type: "panel-section", props: { panelSectionId: "right-panel-section" } } },
                                                split: {
                                                    direction: "vertical",
                                                    ratio: 0.5,
                                                    children: [
                                                        {
                                                            id: "right-sidebar-section",
                                                            title: "Right Sidebar",
                                                            data: { role: "sidebar", component: { type: "panel-section", props: { panelSectionId: "right-panel-section" } } },
                                                            split: null,
                                                        },
                                                        {
                                                            id: "right-sidebar-split",
                                                            title: "Right Sidebar Split",
                                                            data: { role: "sidebar", component: { type: "panel-section", props: { panelSectionId: "right-sidebar-panels" } } },
                                                            split: null,
                                                        },
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        },
        tabSections: [
            {
                id: "main-tabs",
                tabs: [{ id: "mock-home", title: "Mock Home", component: "home" }],
                focusedTabId: "mock-home",
                isRoot: true,
            },
        ],
        activeGroupId: "main-tabs",
    };
}

function buildPanelLayoutWithUnreachableRightSatelliteSection(): Record<string, unknown> {
    const workspace = buildLegacyWorkspaceLayoutWithRightPanelSplit();
    const collapseRightSidebarSplit = (node: Record<string, unknown>): Record<string, unknown> => {
        if (node.id === "right-sidebar") {
            return { ...node, split: null };
        }

        const split = node.split as { children?: unknown[] } | null | undefined;
        if (!split || !Array.isArray(split.children)) {
            return node;
        }

        return {
            ...node,
            split: {
                ...split,
                children: split.children.map((child) =>
                    child && typeof child === "object" && !Array.isArray(child)
                        ? collapseRightSidebarSplit(child as Record<string, unknown>)
                        : child,
                ),
            },
        };
    };
    const root = collapseRightSidebarSplit(workspace.root as Record<string, unknown>);
    return {
        root,
        sections: [
            {
                id: "left-panel-section",
                panelIds: ["files"],
                focusedPanelId: "files",
                isCollapsed: false,
                isRoot: true,
            },
            {
                id: "right-panel-section",
                panelIds: ["ai-chat-mock", "backlinks", "calendar-panel"],
                focusedPanelId: "ai-chat-mock",
                isCollapsed: false,
            },
            {
                id: "right-sidebar-panels",
                panelIds: ["outline"],
                focusedPanelId: "outline",
                isCollapsed: false,
                isRoot: false,
            },
        ],
    };
}

function buildPersistedRightIconSplitPanelLayout(): Record<string, unknown> {
    const workspace = buildLegacyWorkspaceLayoutWithRightPanelSplit();
    return {
        root: workspace.root,
        sections: [
            {
                id: "left-panel-section",
                panelIds: ["files"],
                focusedPanelId: "files",
                isCollapsed: false,
                isRoot: true,
            },
            {
                id: "right-panel-section",
                panelIds: ["ai-chat-mock", "calendar-panel"],
                focusedPanelId: "ai-chat-mock",
                isCollapsed: false,
            },
            {
                id: "right-sidebar-panels",
                panelIds: ["outline"],
                focusedPanelId: "outline",
                isCollapsed: false,
            },
        ],
    };
}

function buildPersistedLeftIconSplitPanelLayout(): Record<string, unknown> {
    const workspace = buildLegacyWorkspaceLayoutWithRightPanelSplit();
    const makeLeftSidebarSplit = (node: Record<string, unknown>): Record<string, unknown> => {
        if (node.id === "left-sidebar") {
            return {
                ...node,
                split: {
                    direction: "vertical",
                    ratio: 0.57,
                    children: [
                        {
                            ...node,
                            id: "left-sidebar-section",
                            split: null,
                        },
                        {
                            ...node,
                            id: "left-sidebar-split",
                            title: "Backlinks",
                            data: {
                                role: "sidebar",
                                component: {
                                    type: "panel-section",
                                    props: { panelSectionId: "left-sidebar-panels" },
                                },
                            },
                            split: null,
                        },
                    ],
                },
            };
        }

        const split = node.split as { children?: unknown[] } | null | undefined;
        if (!split || !Array.isArray(split.children)) {
            return node;
        }

        return {
            ...node,
            split: {
                ...split,
                children: split.children.map((child) =>
                    child && typeof child === "object" && !Array.isArray(child)
                        ? makeLeftSidebarSplit(child as Record<string, unknown>)
                        : child,
                ),
            },
        };
    };

    return {
        root: makeLeftSidebarSplit(workspace.root as Record<string, unknown>),
        sections: [
            {
                id: "left-panel-section",
                panelIds: ["files"],
                focusedPanelId: "files",
                isCollapsed: false,
                isRoot: true,
            },
            {
                id: "right-panel-section",
                panelIds: ["ai-chat-mock", "calendar-panel", "outline"],
                focusedPanelId: "ai-chat-mock",
                isCollapsed: false,
            },
            {
                id: "left-sidebar-panels",
                panelIds: ["backlinks"],
                focusedPanelId: "backlinks",
                isCollapsed: false,
            },
        ],
    };
}

/**
 * 将 panel icon 拖到目标 panel content 边缘以触发 split。
 *
 * @param page - Playwright Page。
 * @param panelId - 被拖拽的 panel id。
 * @param targetPanelSectionId - 目标 panel section id。
 * @param edge - split 触发边缘。
 */
async function splitPanelToSectionEdge(
    page: Page,
    panelId: string,
    targetPanelSectionId: string,
    edge: "top" | "bottom",
): Promise<void> {
    const source = page.locator(
        `.layout-v2-panel-section__panel-tab[data-layout-panel-id='${panelId}']`,
    ).first();
    const target = page.locator(
        `[data-layout-role='panel-content'][data-layout-panel-section-id='${targetPanelSectionId}']`,
    ).first();

    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
        targetBox!.x + targetBox!.width / 2,
        edge === "top" ? targetBox!.y + 8 : targetBox!.y + targetBox!.height - 8,
        { steps: 12 },
    );
    await page.mouse.up();
}

async function splitPanelToBottom(
    page: Page,
    panelId: string,
    targetPanelSectionId: string,
): Promise<void> {
    await splitPanelToSectionEdge(page, panelId, targetPanelSectionId, "bottom");
}

test.describe("layout-v2 panel icon split 持久化恢复", () => {
    test("panel icon split 后 reload 应恢复拓扑且不触发 React <fa> 错误", async ({ page }) => {
        const pageErrors: string[] = [];
        const reactWarnings: string[] = [];
        const vaultPath = `/mock/panel-icon-split-restore-${Date.now()}`;
        const storageKey = `${BROWSER_FALLBACK_CONFIG_PREFIX}${vaultPath}`;

        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });
        page.on("console", (message) => {
            const text = message.text();
            if (text.includes("An error occurred in the <") || text.includes("<fa>")) {
                reactWarnings.push(text);
            }
        });

        await page.goto(`${MOCK_PAGE}?showControls=0&mockVaultPath=${encodeURIComponent(vaultPath)}`);
        await page.evaluate((key) => window.localStorage.removeItem(key), storageKey);
        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        await splitPanelToBottom(page, "backlinks", "right-panel-section");

        await expect.poll(async () => page.evaluate((key) => {
            const raw = window.localStorage.getItem(key);
            if (!raw) return false;
            const config = JSON.parse(raw) as {
                entries?: { sidebarLayout?: { panelLayout?: { sections?: Array<{ id?: string }> } } };
            };
            return config.entries?.sidebarLayout?.panelLayout?.sections?.some(
                (section) => section.id === "right-sidebar-panels",
            ) ?? false;
        }, storageKey)).toBe(true);

        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        const restoredSectionIds = await page.locator("[data-layout-role='panel-section']").evaluateAll(
            (elements) => elements.map((element) => element.getAttribute("data-layout-panel-section-id")),
        );

        expect(restoredSectionIds).toContain("right-sidebar-panels");
        await expect(page.locator(
            "[data-layout-role='panel'][data-layout-panel-section-id='right-sidebar-panels'][data-layout-panel-id='backlinks']",
        )).toBeVisible();
        expect(pageErrors).toEqual([]);
        expect(reactWarnings).toEqual([]);
    });

    test("旧 workspaceLayout 中的右侧空 panel split 不应在 resize 时刷缺失 state warning", async ({ page }) => {
        const panelMissingWarnings: string[] = [];
        const vaultPath = `/mock/orphan-right-panel-split-resize-${Date.now()}`;
        const storageKey = `${BROWSER_FALLBACK_CONFIG_PREFIX}${vaultPath}`;

        page.on("console", (message) => {
            const text = message.text();
            if (text.includes("[layout-v2] panel section state is missing")) {
                panelMissingWarnings.push(text);
            }
        });

        await page.goto(`${MOCK_PAGE}?showControls=0&mockVaultPath=${encodeURIComponent(vaultPath)}`);
        await page.evaluate((key) => window.localStorage.removeItem(key), storageKey);

        const workspaceLayout = buildLegacyWorkspaceLayoutWithRightPanelSplit();
        await page.evaluate(({ key, layout }) => {
            window.localStorage.setItem(key, JSON.stringify({
                schemaVersion: 1,
                entries: {
                    features: { restoreWorkspaceLayout: true },
                    workspaceLayout: layout,
                },
            }));
        }, { key: storageKey, layout: workspaceLayout });

        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        await expect(page.locator("[data-layout-leaf-section-id='right-sidebar-split']")).toHaveCount(0);
        await dragSidebarDivider(page, 1, 24);
        await page.waitForTimeout(120);

        expect(panelMissingWarnings).toEqual([]);
    });

    test("旧半坏 panelLayout 不应在启动后继续保存不可达右侧 split section", async ({ page }) => {
        const panelMissingWarnings: string[] = [];
        const vaultPath = `/mock/unreachable-right-panel-split-restore-${Date.now()}`;
        const storageKey = `${BROWSER_FALLBACK_CONFIG_PREFIX}${vaultPath}`;

        page.on("console", (message) => {
            const text = message.text();
            if (text.includes("[layout-v2] panel section state is missing")) {
                panelMissingWarnings.push(text);
            }
        });

        await page.goto(`${MOCK_PAGE}?showControls=0&mockVaultPath=${encodeURIComponent(vaultPath)}`);
        await page.evaluate((key) => window.localStorage.removeItem(key), storageKey);

        const panelLayout = buildPanelLayoutWithUnreachableRightSatelliteSection();
        await page.evaluate(({ key, layout }) => {
            window.localStorage.setItem(key, JSON.stringify({
                schemaVersion: 1,
                entries: {
                    features: { restoreWorkspaceLayout: true },
                    sidebarLayout: {
                        version: 1,
                        left: { width: 280, visible: true, activeActivityId: "files", activePanelId: "files" },
                        right: { width: 260, visible: true, activeActivityId: null, activePanelId: "ai-chat-mock" },
                        panelStates: [],
                        paneStates: [],
                        convertiblePanelStates: [],
                        panelLayout: layout,
                    },
                },
            }));
        }, { key: storageKey, layout: panelLayout });

        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        await expect(page.locator("[data-layout-panel-section-id='right-sidebar-panels']")).toHaveCount(0);
        await expect(page.locator(
            "[data-layout-role='panel'][data-layout-panel-section-id='right-panel-section'][data-layout-panel-id='outline']",
        )).toBeVisible();
        await dragSidebarDivider(page, 1, 18);
        await page.waitForTimeout(500);

        await expect.poll(async () => page.evaluate((key) => {
            const raw = window.localStorage.getItem(key);
            if (!raw) return false;
            const config = JSON.parse(raw) as {
                entries?: { sidebarLayout?: { panelLayout?: { sections?: Array<{ id?: string }> } } };
            };
            return config.entries?.sidebarLayout?.panelLayout?.sections?.some(
                (section) => section.id === "right-sidebar-panels",
            ) ?? false;
        }, storageKey)).toBe(false);
        expect(panelMissingWarnings).toEqual([]);
    });

    test("配置异步加载期间不应把已保存的右侧 icon split 覆盖为默认 panelLayout", async ({ page }) => {
        const vaultPath = `/mock/async-config-right-icon-split-${Date.now()}`;
        const storageKey = `${BROWSER_FALLBACK_CONFIG_PREFIX}${vaultPath}`;
        const panelLayout = buildPersistedRightIconSplitPanelLayout();
        const workspaceLayout = buildLegacyWorkspaceLayoutWithRightPanelSplit();

        await page.goto(`${MOCK_PAGE}?showControls=0&mockVaultPath=${encodeURIComponent(vaultPath)}&mockConfigReadDelayMs=350`);
        await page.evaluate(({ key, layout, workspace }) => {
            window.localStorage.setItem(key, JSON.stringify({
                schemaVersion: 1,
                entries: {
                    features: { restoreWorkspaceLayout: true },
                    sidebarLayout: {
                        version: 1,
                        left: { width: 280, visible: true, activeActivityId: "files", activePanelId: "files" },
                        right: { width: 260, visible: true, activeActivityId: null, activePanelId: "outline" },
                        panelStates: [],
                        paneStates: [],
                        convertiblePanelStates: [],
                        panelLayout: layout,
                    },
                    workspaceLayout: workspace,
                },
            }));
        }, { key: storageKey, layout: panelLayout, workspace: workspaceLayout });

        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        await expect(page.locator(
            "[data-layout-role='panel-section'][data-layout-panel-section-id='right-sidebar-panels']",
        )).toBeVisible();
        await expect(page.locator(
            "[data-layout-role='panel'][data-layout-panel-section-id='right-sidebar-panels'][data-layout-panel-id='outline']",
        )).toBeVisible();

        await page.waitForTimeout(900);

        const persistedPanelLayoutProbe = await page.evaluate((key) => {
            const raw = window.localStorage.getItem(key);
            if (!raw) return null;
            const config = JSON.parse(raw) as {
                entries?: { sidebarLayout?: { panelLayout?: { root?: unknown; sections?: Array<{ id?: string; panelIds?: string[] }> } } };
            };
            const panelLayoutSnapshot = config.entries?.sidebarLayout?.panelLayout;
            const findNode = (node: unknown, id: string): unknown => {
                if (!node || typeof node !== "object") return null;
                const current = node as { id?: string; split?: { children?: unknown[] } };
                if (current.id === id) return current;
                const children = current.split?.children;
                if (!Array.isArray(children)) return null;
                for (const child of children) {
                    const found = findNode(child, id);
                    if (found) return found;
                }
                return null;
            };
            return {
                hasRightSplitLeaf: Boolean(findNode(panelLayoutSnapshot?.root, "right-sidebar-split")),
                hasSatelliteSection: panelLayoutSnapshot?.sections?.some(
                    (section) => section.id === "right-sidebar-panels" && section.panelIds?.includes("outline"),
                ) ?? false,
            };
        }, storageKey);

        expect(persistedPanelLayoutProbe).toEqual({
            hasRightSplitLeaf: true,
            hasSatelliteSection: true,
        });
    });

    test("右侧 icon 拖到左侧形成的 split 重启后应恢复且旧 ratio 不应导致启动崩溃", async ({ page }) => {
        const pageErrors: string[] = [];
        const reactWarnings: string[] = [];
        const vaultPath = `/mock/left-sidebar-icon-split-restore-${Date.now()}`;
        const storageKey = `${BROWSER_FALLBACK_CONFIG_PREFIX}${vaultPath}`;
        const panelLayout = buildPersistedLeftIconSplitPanelLayout();
        const workspaceLayout = buildLegacyWorkspaceLayoutWithRightPanelSplit();

        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });
        page.on("console", (message) => {
            const text = message.text();
            if (text.includes("An error occurred in the <") || text.includes("[layout-v2] section is not split")) {
                reactWarnings.push(text);
            }
        });

        await page.goto(`${MOCK_PAGE}?showControls=0&mockVaultPath=${encodeURIComponent(vaultPath)}&mockConfigReadDelayMs=350`);
        await page.evaluate(({ key, layout, workspace }) => {
            window.localStorage.setItem(key, JSON.stringify({
                schemaVersion: 1,
                entries: {
                    features: { restoreWorkspaceLayout: true },
                    sidebarLayout: {
                        version: 1,
                        left: { width: 280, visible: true, activeActivityId: "files", activePanelId: "files" },
                        right: { width: 260, visible: true, activeActivityId: null, activePanelId: "ai-chat-mock" },
                        panelStates: [],
                        paneStates: [],
                        convertiblePanelStates: [],
                        sectionRatios: {
                            root: 0.15,
                            "workbench-shell": 0.15,
                            "center-shell": 0.75,
                            "left-sidebar": 0.57,
                        },
                        panelLayout: layout,
                    },
                    workspaceLayout: workspace,
                },
            }));
        }, { key: storageKey, layout: panelLayout, workspace: workspaceLayout });

        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        await expect(page.locator(
            "[data-layout-role='panel-section'][data-layout-panel-section-id='left-sidebar-panels']",
        )).toBeVisible();
        await expect(page.locator(
            "[data-layout-role='panel'][data-layout-panel-section-id='left-sidebar-panels'][data-layout-panel-id='backlinks']",
        )).toBeVisible();
        await page.waitForTimeout(900);

        const persistedPanelLayoutProbe = await page.evaluate((key) => {
            const raw = window.localStorage.getItem(key);
            if (!raw) return null;
            const config = JSON.parse(raw) as {
                entries?: { sidebarLayout?: { panelLayout?: { root?: unknown; sections?: Array<{ id?: string; panelIds?: string[] }> } } };
            };
            const panelLayoutSnapshot = config.entries?.sidebarLayout?.panelLayout;
            const findNode = (node: unknown, id: string): unknown => {
                if (!node || typeof node !== "object") return null;
                const current = node as { id?: string; split?: { children?: unknown[] } };
                if (current.id === id) return current;
                const children = current.split?.children;
                if (!Array.isArray(children)) return null;
                for (const child of children) {
                    const found = findNode(child, id);
                    if (found) return found;
                }
                return null;
            };
            return {
                hasLeftSplitLeaf: Boolean(findNode(panelLayoutSnapshot?.root, "left-sidebar-split")),
                hasSatelliteSection: panelLayoutSnapshot?.sections?.some(
                    (section) => section.id === "left-sidebar-panels" && section.panelIds?.includes("backlinks"),
                ) ?? false,
            };
        }, storageKey);

        expect(persistedPanelLayoutProbe).toEqual({
            hasLeftSplitLeaf: true,
            hasSatelliteSection: true,
        });
        expect(pageErrors).toEqual([]);
        expect(reactWarnings).toEqual([]);
    });

    test("拖动右侧上半单 panel section 的唯一 icon 不应触发更新风暴或页面崩溃", async ({ page }) => {
        const pageErrors: string[] = [];
        const consoleProblems: string[] = [];
        let contextMenuLifecycleLogs = 0;
        let calendarLoadStartLogs = 0;
        const vaultPath = `/mock/right-sidebar-single-panel-drag-${Date.now()}`;
        const storageKey = `${BROWSER_FALLBACK_CONFIG_PREFIX}${vaultPath}`;

        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });
        page.on("console", (message) => {
            const text = message.text();
            if (
                text.includes("Maximum update depth exceeded") ||
                text.includes("Minified React error") ||
                text.includes("An error occurred in the <")
            ) {
                consoleProblems.push(text);
            }
            if (text.includes("[context-menu-center] provider registered") || text.includes("[context-menu-center] provider unregistered")) {
                contextMenuLifecycleLogs += 1;
            }
            if (text.includes("[calendar-view] load start")) {
                calendarLoadStartLogs += 1;
            }
        });

        await page.goto(`${MOCK_PAGE}?showControls=0&mockVaultPath=${encodeURIComponent(vaultPath)}`);
        await page.evaluate((key) => window.localStorage.removeItem(key), storageKey);
        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        await splitPanelToSectionEdge(page, "calendar-panel", "right-panel-section", "top");

        await expect.poll(async () => page.evaluate((key) => {
            const raw = window.localStorage.getItem(key);
            if (!raw) return false;
            const config = JSON.parse(raw) as {
                entries?: { sidebarLayout?: { panelLayout?: { sections?: Array<{ panelIds?: string[] }> } } };
            };
            return config.entries?.sidebarLayout?.panelLayout?.sections?.some(
                (section) => section.panelIds?.length === 1 && section.panelIds[0] === "calendar-panel",
            ) ?? false;
        }, storageKey)).toBe(true);

        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        const topCalendarPanel = page.locator(
            "[data-layout-role='panel-section']:has(.layout-v2-panel-section__panel-tab[data-layout-panel-id='calendar-panel'])",
        ).first();
        const bottomRightPanel = page.locator(
            "[data-layout-role='panel-section'][data-layout-panel-section-id='right-panel-section']",
        ).first();
        const calendarTab = topCalendarPanel.locator(
            ".layout-v2-panel-section__panel-tab[data-layout-panel-id='calendar-panel']",
        ).first();

        await expect(topCalendarPanel).toBeVisible();
        await expect(bottomRightPanel).toBeVisible();
        await expect(calendarTab).toBeVisible();
        await page.waitForTimeout(300);
        pageErrors.length = 0;
        consoleProblems.length = 0;
        contextMenuLifecycleLogs = 0;
        calendarLoadStartLogs = 0;

        const topBox = await topCalendarPanel.boundingBox();
        expect(topBox).not.toBeNull();

        await dragLocatorToPoint(page, calendarTab, {
            x: topBox!.x + topBox!.width / 2,
            y: topBox!.y + Math.max(56, topBox!.height * 0.32),
        });

        await expect(page.locator(
            ".layout-v2-panel-section__panel-tab[data-layout-panel-id='calendar-panel']",
        ).first()).toBeVisible({ timeout: 3000 });
        await expect(bottomRightPanel).toBeVisible();

        await page.waitForTimeout(700);
        expect(pageErrors).toEqual([]);
        expect(consoleProblems).toEqual([]);
        expect(contextMenuLifecycleLogs).toBeLessThan(40);
        expect(calendarLoadStartLogs).toBeLessThan(8);
    });

    test("拖动唯一 panel icon 的中间帧应保留预销毁 preview 语义且不触发 provider 风暴", async ({ page }) => {
        const consoleProblems: string[] = [];
        let contextMenuLifecycleLogs = 0;
        const vaultPath = `/mock/right-sidebar-single-panel-preview-${Date.now()}`;
        const storageKey = `${BROWSER_FALLBACK_CONFIG_PREFIX}${vaultPath}`;

        page.on("pageerror", (error) => {
            consoleProblems.push(error.message);
        });
        page.on("console", (message) => {
            const text = message.text();
            if (
                text.includes("Maximum update depth exceeded") ||
                text.includes("Minified React error") ||
                text.includes("An error occurred in the <")
            ) {
                consoleProblems.push(text);
            }
            if (text.includes("[context-menu-center] provider registered") || text.includes("[context-menu-center] provider unregistered")) {
                contextMenuLifecycleLogs += 1;
            }
        });

        await page.goto(`${MOCK_PAGE}?showControls=0&mockVaultPath=${encodeURIComponent(vaultPath)}`);
        await page.evaluate((key) => window.localStorage.removeItem(key), storageKey);
        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        await splitPanelToSectionEdge(page, "calendar-panel", "right-panel-section", "top");
        await expect.poll(async () => page.evaluate((key) => {
            const raw = window.localStorage.getItem(key);
            if (!raw) return false;
            const config = JSON.parse(raw) as {
                entries?: { sidebarLayout?: { panelLayout?: { sections?: Array<{ panelIds?: string[] }> } } };
            };
            return config.entries?.sidebarLayout?.panelLayout?.sections?.some(
                (section) => section.panelIds?.length === 1 && section.panelIds[0] === "calendar-panel",
            ) ?? false;
        }, storageKey)).toBe(true);

        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        const topCalendarPanel = page.locator(
            "[data-layout-role='panel-section']:has(.layout-v2-panel-section__panel-tab[data-layout-panel-id='calendar-panel'])",
        ).first();
        const calendarTab = topCalendarPanel.locator(
            ".layout-v2-panel-section__panel-tab[data-layout-panel-id='calendar-panel']",
        ).first();
        const sourcePanelSectionId = await topCalendarPanel.getAttribute("data-layout-panel-section-id");
        expect(sourcePanelSectionId).toBeTruthy();
        await page.waitForTimeout(300);
        contextMenuLifecycleLogs = 0;
        consoleProblems.length = 0;

        const sourceBox = await calendarTab.boundingBox();
        expect(sourceBox).not.toBeNull();

        await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
        await page.mouse.down();
        await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height + 80, { steps: 8 });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

        await expect(page.locator(
            `[data-layout-role='panel-section'][data-layout-panel-section-id='${sourcePanelSectionId}']`,
        )).toHaveCount(0);
        await expect(page.locator(".layout-v2-panel-section-drag-preview")).toBeVisible();
        expect(consoleProblems).toEqual([]);
        expect(contextMenuLifecycleLogs).toBeLessThan(10);

        await page.mouse.up();
    });
});
