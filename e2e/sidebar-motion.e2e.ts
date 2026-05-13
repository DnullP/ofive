/**
 * @module e2e/sidebar-motion.e2e
 * @description 侧栏显隐回归测试（layout-v2）。
 *
 * 覆盖场景：
 * 1. 键盘快捷键切换左侧栏显隐
 * 2. 右侧 icon 点击可切换 active 项，键盘快捷键可隐藏/恢复右侧栏
 * 3. 左侧栏隐藏后，知识图谱入口仍可正常打开 tab
 *
 * @dependencies
 *   - @playwright/test
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const BROWSER_FALLBACK_CONFIG_PREFIX = "ofive:browser-fallback:vault-config:";
const LAST_VAULT_PATH_STORAGE_KEY = "ofive:last-vault-path";
const FRONTEND_REMEMBER_LAST_VAULT_KEY = "ofive:settings:remember-last-vault";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";
const NETWORK_NOTE_PATH = "test-resources/notes/network-segment.md";
const NOTE1_PATH = "test-resources/notes/note1.md";
const SPLIT_SETTLE_MS = 360;

function buildCollapsedSidebarVaultConfig(): Record<string, unknown> {
    const collapsedPanelLayout = {
        root: {
            id: "root",
            title: "Workbench Root",
            data: { role: "root", component: { type: "empty", props: { label: "Root", description: "workbench root" } } },
            resizableEdges: { top: true, right: true, bottom: true, left: true },
            split: {
                direction: "horizontal",
                ratio: 0.04,
                children: [
                    {
                        id: "left-activity-bar",
                        title: "Left Activity Bar",
                        data: { role: "activity-bar", component: { type: "activity-rail", props: {} } },
                        meta: { "layout-v2:fixedSize": 48 },
                        resizableEdges: { top: true, right: false, bottom: true, left: true },
                        split: null,
                    },
                    {
                        id: "workbench-shell",
                        title: "Workbench Shell",
                        data: { role: "container", component: { type: "empty", props: { label: "Workbench", description: "workbench container" } } },
                        resizableEdges: { top: true, right: true, bottom: true, left: true },
                        split: {
                            direction: "horizontal",
                            ratio: 0.15,
                            children: [
                                {
                                    id: "left-sidebar",
                                    title: "Left Sidebar",
                                    data: { role: "sidebar", component: { type: "panel-section", props: { panelSectionId: "left-panel-section" } } },
                                    meta: { "layout-v2:fixedSize": 86 },
                                    resizableEdges: { top: true, right: true, bottom: true, left: true },
                                    split: null,
                                },
                                {
                                    id: "center-shell",
                                    title: "Center Shell",
                                    data: { role: "container", component: { type: "empty", props: { label: "Center", description: "main region" } } },
                                    resizableEdges: { top: true, right: true, bottom: true, left: true },
                                    split: {
                                        direction: "horizontal",
                                        ratio: 0.78,
                                        children: [
                                            {
                                                id: "main-tabs",
                                                title: "Main Tabs",
                                                data: { role: "main", component: { type: "tab-section", props: { tabSectionId: "main-tabs" } } },
                                                resizableEdges: { top: true, right: true, bottom: true, left: true },
                                                split: null,
                                            },
                                            {
                                                id: "right-sidebar",
                                                title: "Right Sidebar",
                                                data: { role: "sidebar", component: { type: "panel-section", props: { panelSectionId: "right-panel-section" } } },
                                                resizableEdges: { top: true, right: true, bottom: true, left: true },
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
        sections: [
            {
                id: "left-panel-section",
                panelIds: ["files"],
                focusedPanelId: "files",
                isCollapsed: true,
                isRoot: true,
            },
            {
                id: "right-panel-section",
                panelIds: ["ai-chat", "backlinks", "calendar-panel", "outline"],
                focusedPanelId: "ai-chat",
                isCollapsed: false,
            },
        ],
    };

    return {
        schemaVersion: 1,
        entries: {
            features: { restoreWorkspaceLayout: true },
            sidebarLayout: {
                version: 1,
                left: {
                    width: 280,
                    visible: true,
                    activeActivityId: "files",
                    activePanelId: "files",
                },
                right: {
                    width: 260,
                    visible: true,
                    activeActivityId: null,
                    activePanelId: null,
                },
                panelStates: [],
                paneStates: [],
                convertiblePanelStates: [],
                sectionRatios: {
                    root: 0.04,
                    "workbench-shell": 0.15,
                    "center-shell": 0.78,
                },
                panelLayout: collapsedPanelLayout,
            },
        },
    };
}

function buildVerticalSplitRightSidebarVaultConfig(): Record<string, unknown> {
    const splitPanelLayout = {
        root: {
            id: "root",
            title: "Workbench Root",
            data: { role: "root", component: { type: "empty", props: { label: "Root", description: "workbench root" } } },
            resizableEdges: { top: true, right: true, bottom: true, left: true },
            split: {
                direction: "horizontal",
                ratio: 0.04,
                children: [
                    {
                        id: "left-activity-bar",
                        title: "Left Activity Bar",
                        data: { role: "activity-bar", component: { type: "activity-rail", props: {} } },
                        meta: { "layout-v2:fixedSize": 48 },
                        resizableEdges: { top: true, right: false, bottom: true, left: true },
                        split: null,
                    },
                    {
                        id: "workbench-shell",
                        title: "Workbench Shell",
                        data: { role: "container", component: { type: "empty", props: { label: "Workbench", description: "workbench container" } } },
                        resizableEdges: { top: true, right: true, bottom: true, left: true },
                        split: {
                            direction: "horizontal",
                            ratio: 0.15,
                            children: [
                                {
                                    id: "left-sidebar",
                                    title: "Left Sidebar",
                                    data: { role: "sidebar", component: { type: "panel-section", props: { panelSectionId: "left-panel-section" } } },
                                    resizableEdges: { top: true, right: true, bottom: true, left: true },
                                    split: null,
                                },
                                {
                                    id: "center-shell",
                                    title: "Center Shell",
                                    data: { role: "container", component: { type: "empty", props: { label: "Center", description: "main region" } } },
                                    resizableEdges: { top: true, right: true, bottom: true, left: true },
                                    split: {
                                        direction: "horizontal",
                                        ratio: 0.78,
                                        children: [
                                            {
                                                id: "main-tabs",
                                                title: "Main Tabs",
                                                data: { role: "main", component: { type: "tab-section", props: { tabSectionId: "main-tabs" } } },
                                                resizableEdges: { top: true, right: true, bottom: true, left: true },
                                                split: null,
                                            },
                                            {
                                                id: "right-sidebar",
                                                title: "Right Sidebar",
                                                data: { role: "sidebar", component: { type: "panel-section", props: { panelSectionId: "right-panel-section" } } },
                                                resizableEdges: { top: true, right: true, bottom: true, left: true },
                                                split: {
                                                    direction: "vertical",
                                                    ratio: 0.5,
                                                    children: [
                                                        {
                                                            id: "right-sidebar-section",
                                                            title: "AI Chat",
                                                            data: { role: "sidebar", component: { type: "panel-section", props: { panelSectionId: "right-panel-section" } } },
                                                            resizableEdges: { top: true, right: true, bottom: true, left: true },
                                                            split: null,
                                                        },
                                                        {
                                                            id: "right-sidebar-split",
                                                            title: "Right Sidebar Split",
                                                            data: { role: "sidebar", component: { type: "panel-section", props: { panelSectionId: "right-sidebar-panels" } } },
                                                            resizableEdges: { top: true, right: true, bottom: true, left: true },
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
                panelIds: ["ai-chat"],
                focusedPanelId: "ai-chat",
                isCollapsed: false,
            },
            {
                id: "right-sidebar-panels",
                panelIds: ["outline", "backlinks", "calendar-panel"],
                focusedPanelId: "outline",
                isCollapsed: false,
            },
        ],
    };

    return {
        schemaVersion: 1,
        entries: {
            features: { restoreWorkspaceLayout: true },
            sidebarLayout: {
                version: 1,
                left: {
                    width: 280,
                    visible: true,
                    activeActivityId: "files",
                    activePanelId: "files",
                },
                right: {
                    width: 260,
                    visible: true,
                    activeActivityId: null,
                    activePanelId: "ai-chat",
                },
                panelStates: [],
                paneStates: [],
                convertiblePanelStates: [],
                sectionRatios: {
                    root: 0.04,
                    "workbench-shell": 0.15,
                    "center-shell": 0.78,
                    "right-sidebar": 0.5,
                },
                panelLayout: splitPanelLayout,
            },
        },
    };
}

async function seedCollapsedSidebarVaultConfig(page: Page, vaultPath: string): Promise<void> {
    await page.addInitScript(({ storageKey, config, lastVaultKey, rememberKey, nextVaultPath }) => {
        window.localStorage.setItem(storageKey, JSON.stringify(config));
        window.localStorage.setItem(rememberKey, "true");
        window.localStorage.setItem(lastVaultKey, nextVaultPath);
    }, {
        storageKey: `${BROWSER_FALLBACK_CONFIG_PREFIX}${vaultPath}`,
        config: buildCollapsedSidebarVaultConfig(),
        lastVaultKey: LAST_VAULT_PATH_STORAGE_KEY,
        rememberKey: FRONTEND_REMEMBER_LAST_VAULT_KEY,
        nextVaultPath: vaultPath,
    });
}

async function seedVaultConfig(page: Page, vaultPath: string, config: Record<string, unknown>): Promise<void> {
    await page.addInitScript(({ storageKey, nextConfig, lastVaultKey, rememberKey, nextVaultPath }) => {
        window.localStorage.setItem(storageKey, JSON.stringify(nextConfig));
        window.localStorage.setItem(rememberKey, "true");
        window.localStorage.setItem(lastVaultKey, nextVaultPath);
    }, {
        storageKey: `${BROWSER_FALLBACK_CONFIG_PREFIX}${vaultPath}`,
        nextConfig: config,
        lastVaultKey: LAST_VAULT_PATH_STORAGE_KEY,
        rememberKey: FRONTEND_REMEMBER_LAST_VAULT_KEY,
        nextVaultPath: vaultPath,
    });
}

async function expectCollapsedSidebarControlsUsable(page: Page): Promise<void> {
    const leftSidebar = page.locator("[data-testid='sidebar-left']");
    const leftToggle = leftSidebar.getByRole("button", { name: "Expand pane content" });
    const rightToggle = page.locator("[data-testid='sidebar-right']").getByRole("button", { name: "Collapse pane content" });

    await expect(leftSidebar).toBeVisible();
    await expect(leftToggle).toBeVisible();
    await expect(rightToggle).toBeVisible();

    const before = await page.evaluate(() => {
        const left = document.querySelector<HTMLElement>("[data-testid='sidebar-left']");
        const leftBar = document.querySelector<HTMLElement>("[data-testid='sidebar-left'] .layout-v2-panel-section__bar");
        const leftToggleButton = document.querySelector<HTMLElement>("[data-testid='sidebar-left'] .layout-v2-panel-section__toggle");
        const rightToggleButton = document.querySelector<HTMLElement>("[data-testid='sidebar-right'] .layout-v2-panel-section__toggle");
        if (!left || !leftBar || !leftToggleButton || !rightToggleButton) {
            throw new Error("collapsed sidebar selectors missing");
        }

        const leftRect = left.getBoundingClientRect();
        const leftToggleRect = leftToggleButton.getBoundingClientRect();
        const rightToggleRect = rightToggleButton.getBoundingClientRect();
        const leftTopElement = document.elementFromPoint(
            leftToggleRect.left + leftToggleRect.width / 2,
            leftToggleRect.top + leftToggleRect.height / 2,
        );
        const rightTopElement = document.elementFromPoint(
            rightToggleRect.left + rightToggleRect.width / 2,
            rightToggleRect.top + rightToggleRect.height / 2,
        );

        return {
            leftWidth: leftRect.width,
            leftBarScrollWidth: leftBar.scrollWidth,
            leftToggleWidth: leftToggleRect.width,
            leftToggleInsideLeftSidebar: leftToggleRect.left >= leftRect.left && leftToggleRect.right <= leftRect.right,
            leftToggleReceivesPointer: Boolean(leftTopElement?.closest(".layout-v2-panel-section__toggle")),
            rightToggleReceivesPointer: Boolean(rightTopElement?.closest(".layout-v2-panel-section__toggle")),
        };
    });

    expect(before.leftWidth).toBeGreaterThanOrEqual(160);
    expect(before.leftBarScrollWidth).toBeLessThanOrEqual(before.leftWidth + 1);
    expect(before.leftToggleWidth).toBeGreaterThan(0);
    expect(before.leftToggleInsideLeftSidebar).toBe(true);
    expect(before.leftToggleReceivesPointer).toBe(true);
    expect(before.rightToggleReceivesPointer).toBe(true);

    await leftToggle.click();
    await expect(leftSidebar.getByRole("button", { name: "Collapse pane content" })).toBeVisible();
    await expect(leftSidebar.locator(".file-tree")).toBeVisible();
}

async function waitForMockLayoutReady(page: Page): Promise<void> {
    await page.locator("[data-testid='sidebar-left']").first().waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-right']").first().waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab-main").first().waitFor({ state: "visible" });
}

async function expandMockNotes(page: Page): Promise<void> {
    if (await page.locator(".tree-item[data-tree-path='test-resources/notes']").count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

async function openMockNote(page: Page, relativePath: string): Promise<void> {
    await expandMockNotes(page);
    const fileName = relativePath.split("/").pop() ?? relativePath;
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    await page.getByRole("button", { name: fileName, exact: true }).first().waitFor({ state: "visible" });
}

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

async function splitTabToBottom(page: Page, tabTitle: string, targetTabSectionId: string): Promise<void> {
    const sourceTab = page.locator(".layout-v2-tab-section__tab-main", { hasText: tabTitle }).first();
    const targetContent = page
        .locator(`.layout-v2-tab-section[data-tab-section-id="${targetTabSectionId}"] .layout-v2-tab-section__content`)
        .first();
    const targetBounds = await targetContent.boundingBox();
    if (!targetBounds) {
        throw new Error("splitTabToBottom: target bounds missing");
    }

    await dragLocatorToPoint(
        page,
        sourceTab,
        targetBounds.x + targetBounds.width / 2,
        targetBounds.y + targetBounds.height - 14,
    );
}

async function readTabStripMetrics(page: Page): Promise<Array<{
    id: string | null;
    stripLeft: number;
    stripTop: number;
    paddingLeft: number;
    tabOffsetLeft: number;
    firstTabLeft: number;
    stripBackground: string;
    activityBarBackground: string | null;
}>> {
    return page.evaluate(() => Array.from(
        document.querySelectorAll<HTMLElement>(".layout-v2-tab-section"),
    ).map((section) => {
        const strip = section.querySelector<HTMLElement>(".layout-v2-tab-section__strip");
        const firstTab = section.querySelector<HTMLElement>(".layout-v2-tab-section__tab-main");
        const activityBar = document.querySelector<HTMLElement>("[data-layout-role='activity-bar'][data-layout-bar-id='left-activity-bar']");
        if (!strip || !firstTab) {
            throw new Error("tab section strip metric selectors missing");
        }

        const stripRect = strip.getBoundingClientRect();
        const firstTabRect = firstTab.getBoundingClientRect();
        return {
            id: section.getAttribute("data-tab-section-id"),
            stripLeft: stripRect.left,
            stripTop: stripRect.top,
            paddingLeft: Number.parseFloat(getComputedStyle(strip).paddingLeft || "0"),
            tabOffsetLeft: firstTabRect.left - stripRect.left,
            firstTabLeft: firstTabRect.left,
            stripBackground: getComputedStyle(strip).backgroundImage !== "none"
                ? getComputedStyle(strip).backgroundImage
                : getComputedStyle(strip).backgroundColor,
            activityBarBackground: activityBar
                ? (getComputedStyle(activityBar).backgroundImage !== "none"
                    ? getComputedStyle(activityBar).backgroundImage
                    : getComputedStyle(activityBar).backgroundColor)
                : null,
        };
    }));
}

test.describe("sidebar toggle regression", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await waitForMockLayoutReady(page);
    });

    test("left sidebar can hide and reopen via keyboard shortcut", async ({ page }) => {
        const sidebarLeft = page.locator("[data-testid='sidebar-left']");
        await expect(sidebarLeft).toBeVisible();

        await page.keyboard.press("Meta+Shift+J");
        await expect(sidebarLeft).toHaveCount(0);

        await page.keyboard.press("Meta+Shift+J");
        await expect(sidebarLeft).toBeVisible();
    });

    test("right sidebar can switch active item and hide via shortcut", async ({ page }) => {
        const outlineTab = page.locator("[data-layout-panel-id='outline'][data-layout-role='panel']");
        const aiChatTab = page.locator("[data-layout-panel-id='ai-chat'][data-layout-role='panel']");
        const sidebarRight = page.locator("[data-testid='sidebar-right']");

        await expect(sidebarRight).toBeVisible();

        await outlineTab.click();
        await expect(outlineTab).toHaveClass(/--focused/);

        await aiChatTab.click();
        await expect(aiChatTab).toHaveClass(/--focused/);
        await expect(sidebarRight).toBeVisible();

        await page.keyboard.press("Meta+Shift+K");
        await expect(sidebarRight).toHaveCount(0);

        await page.keyboard.press("Meta+Shift+K");
        await expect(sidebarRight).toBeVisible();
        await expect(outlineTab).toBeVisible();
    });

    test("knowledge graph tab opens after sidebar toggle", async ({ page }) => {
        await page.keyboard.press("Meta+Shift+J");
        await expect(page.locator("[data-testid='sidebar-left']")).toHaveCount(0);

        await page.getByTestId("activity-bar-item-knowledge-graph").click();

        await expect(
            page.locator(".layout-v2-tab-section__tab-title", { hasText: "知识图谱" }),
        ).toBeVisible();
        await expect(page.locator(".knowledge-graph-tab").first()).toBeVisible();
    });

    test("collapsed sidebar panel bars stay visible and can expand after restore", async ({ page }) => {
        const vaultPath = `/mock/sidebar-collapsed-restore-${Date.now()}`;
        await seedCollapsedSidebarVaultConfig(page, vaultPath);

        await page.goto(`${MOCK_PAGE}&mockVaultPath=${encodeURIComponent(vaultPath)}`);
        await expectCollapsedSidebarControlsUsable(page);
    });

    test("collapsed panel in a vertical split releases height while sidebar width stays stable", async ({ page }) => {
        const vaultPath = `/mock/sidebar-vertical-collapse-${Date.now()}`;
        await seedVaultConfig(page, vaultPath, buildVerticalSplitRightSidebarVaultConfig());

        await page.goto(`${MOCK_PAGE}&mockVaultPath=${encodeURIComponent(vaultPath)}`);
        await waitForMockLayoutReady(page);

        const topSection = page.locator("[data-section-id='right-sidebar-section']");
        const bottomSection = page.locator("[data-section-id='right-sidebar-split']");
        const topCollapse = topSection.getByRole("button", { name: "Collapse pane content" });

        await expect(topSection).toBeVisible();
        await expect(bottomSection).toBeVisible();
        await expect(topCollapse).toBeVisible();

        const before = await page.evaluate(() => {
            const sidebar = document.querySelector<HTMLElement>("[data-testid='sidebar-right']");
            const top = document.querySelector<HTMLElement>("[data-section-id='right-sidebar-section']");
            const bottom = document.querySelector<HTMLElement>("[data-section-id='right-sidebar-split']");
            if (!sidebar || !top || !bottom) {
                throw new Error("vertical split sidebar selectors missing");
            }

            return {
                sidebarWidth: sidebar.getBoundingClientRect().width,
                topHeight: top.getBoundingClientRect().height,
                bottomHeight: bottom.getBoundingClientRect().height,
            };
        });

        expect(before.sidebarWidth).toBeGreaterThanOrEqual(160);
        expect(before.topHeight).toBeGreaterThan(120);
        expect(before.bottomHeight).toBeGreaterThan(120);

        await topCollapse.click();
        await expect(topSection.getByRole("button", { name: "Expand pane content" })).toBeVisible();

        const after = await page.evaluate(() => {
            const sidebar = document.querySelector<HTMLElement>("[data-testid='sidebar-right']");
            const top = document.querySelector<HTMLElement>("[data-section-id='right-sidebar-section']");
            const bottom = document.querySelector<HTMLElement>("[data-section-id='right-sidebar-split']");
            if (!sidebar || !top || !bottom) {
                throw new Error("vertical split sidebar selectors missing after collapse");
            }

            return {
                sidebarWidth: sidebar.getBoundingClientRect().width,
                topHeight: top.getBoundingClientRect().height,
                bottomHeight: bottom.getBoundingClientRect().height,
            };
        });

        expect(Math.abs(after.sidebarWidth - before.sidebarWidth)).toBeLessThanOrEqual(1);
        expect(after.topHeight).toBeLessThanOrEqual(44);
        expect(after.bottomHeight).toBeGreaterThan(before.bottomHeight + 80);
    });
});

test.describe("sidebar titlebar integration", () => {
    test("restored collapsed sidebar controls are not hidden by the mac titlebar", async ({ page }) => {
        const vaultPath = `/mock/sidebar-titlebar-restore-${Date.now()}`;
        await seedCollapsedSidebarVaultConfig(page, vaultPath);
        await page.addInitScript(() => {
            Object.defineProperty(window.navigator, "platform", {
                configurable: true,
                get: () => "MacIntel",
            });
        });

        await page.goto("/");
        await expect(page.locator(".app-titlebar--mac")).toBeVisible();
        await expect(page.locator(".app-titlebar__control--sidebar")).toHaveCount(0);
        await expect(page.locator(".app-titlebar--mac .app-titlebar__control")).toHaveCount(0);
        await expectCollapsedSidebarControlsUsable(page);
    });

    test("hidden left sidebar only adds mac titlebar padding to the leftmost tab strip", async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(window.navigator, "platform", {
                configurable: true,
                get: () => "MacIntel",
            });
        });

        await page.goto("/");
        await expect(page.locator(".app-titlebar--mac")).toBeVisible();
        await waitForMockLayoutReady(page);

        await openMockNote(page, GUIDE_NOTE_PATH);
        await openMockNote(page, NETWORK_NOTE_PATH);
        await splitTabToRight(page, "network-segment.md");
        await expect(page.locator(".layout-v2-tab-section")).toHaveCount(2);

        await page.keyboard.press("Meta+Shift+J");
        await expect(page.locator("[data-testid='sidebar-left']")).toHaveCount(0);

        const stripMetrics = (await readTabStripMetrics(page))
            .sort((left, right) => left.stripLeft - right.stripLeft);

        expect(stripMetrics).toHaveLength(2);
        expect(stripMetrics[0].paddingLeft).toBeGreaterThanOrEqual(48);
        expect(stripMetrics[0].paddingLeft).toBeLessThanOrEqual(64);
        expect(stripMetrics[0].tabOffsetLeft).toBeGreaterThanOrEqual(48);
        expect(stripMetrics[0].tabOffsetLeft).toBeLessThanOrEqual(72);
        expect(stripMetrics[0].firstTabLeft).toBeGreaterThanOrEqual(96);
        expect(stripMetrics[0].firstTabLeft).toBeLessThanOrEqual(128);
        expect(stripMetrics[0].activityBarBackground).not.toBeNull();
        expect(stripMetrics[0].stripBackground).toBe(stripMetrics[0].activityBarBackground);
        expect(stripMetrics[1].paddingLeft).toBeLessThanOrEqual(1);
        expect(stripMetrics[1].tabOffsetLeft).toBeLessThan(24);
        expect(stripMetrics[1].stripBackground).toBe(stripMetrics[0].activityBarBackground);
    });

    test("hidden left sidebar only pads the top-left tab strip inside nested splits", async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(window.navigator, "platform", {
                configurable: true,
                get: () => "MacIntel",
            });
        });

        await page.goto("/");
        await expect(page.locator(".app-titlebar--mac")).toBeVisible();
        await waitForMockLayoutReady(page);

        await openMockNote(page, GUIDE_NOTE_PATH);
        await openMockNote(page, NETWORK_NOTE_PATH);
        await openMockNote(page, NOTE1_PATH);
        await splitTabToRight(page, "network-segment.md");
        await expect(page.locator(".layout-v2-tab-section")).toHaveCount(2);
        await splitTabToBottom(page, "note1.md", "main-tabs");
        await expect(page.locator(".layout-v2-tab-section")).toHaveCount(3);

        await page.keyboard.press("Meta+Shift+J");
        await expect(page.locator("[data-testid='sidebar-left']")).toHaveCount(0);

        const stripMetrics = await readTabStripMetrics(page);
        const topLeftStrip = [...stripMetrics]
            .sort((left, right) => {
                const topDelta = left.stripTop - right.stripTop;
                return Math.abs(topDelta) > 2 ? topDelta : left.stripLeft - right.stripLeft;
            })[0];
        const paddedStrips = stripMetrics.filter((metric) => metric.paddingLeft >= 48);

        expect(stripMetrics).toHaveLength(3);
        expect(paddedStrips).toHaveLength(1);
        expect(paddedStrips[0].id).toBe(topLeftStrip.id);
        expect(paddedStrips[0].paddingLeft).toBeLessThanOrEqual(64);
        expect(paddedStrips[0].tabOffsetLeft).toBeGreaterThanOrEqual(48);
        expect(paddedStrips[0].firstTabLeft).toBeGreaterThanOrEqual(96);
        expect(paddedStrips[0].stripBackground).toBe(paddedStrips[0].activityBarBackground);
        for (const metric of stripMetrics.filter((item) => item.id !== paddedStrips[0].id)) {
            expect(metric.paddingLeft).toBeLessThanOrEqual(1);
            expect(metric.tabOffsetLeft).toBeLessThan(24);
            expect(metric.stripBackground).toBe(paddedStrips[0].activityBarBackground);
        }
    });
});
