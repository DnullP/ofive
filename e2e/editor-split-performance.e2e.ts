/**
 * @module e2e/editor-split-performance
 * @description Markdown 编辑器 split 性能回归测试。
 *   验证打开多个笔记后，工作台只挂载每个可见 tab section 的 active editor，避免 split 时批量销毁/重建所有已打开笔记导致卡顿。
 *
 * @dependencies
 *   - @playwright/test
 *
 * @example
 *   bunx playwright test --config playwright.config.ts e2e/editor-split-performance.e2e.ts --reporter=line
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const MOUSE_DRAG_TAG = "@mouse-drag";
const LIVE_EDITOR_SELECTOR = ".cm-editor:not([data-editor-preview-mirror-node='true'])";
const PREVIEW_MIRROR_SELECTOR = "[data-editor-preview-mirror='true']";
const PREVIEW_MIRROR_EDITOR_SELECTOR = ".cm-editor[data-editor-preview-mirror-node='true']";
const PREVIEW_MIRROR_FALLBACK_SELECTOR = ".cm-editor-preview-mirror__fallback";
const NOTES_TO_OPEN = [
    "test-resources/notes/guide.md",
    "test-resources/notes/network-segment.md",
    "test-resources/notes/table-editor.md",
    "test-resources/notes/table-vim-boundary.md",
];

/**
 * @function waitForMockWorkbench
 * @description 打开 mock 工作台并等待主布局可交互。
 * @param page Playwright 页面对象。
 * @returns Promise<void>。
 */
async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: "首页" }).first().waitFor({ state: "visible" });
}

/**
 * @function expandMockNotes
 * @description 展开 mock 文件树中的 notes 目录。
 * @param page Playwright 页面对象。
 * @returns Promise<void>。
 */
async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

/**
 * @function openMockNote
 * @description 从 mock 文件树打开指定笔记。
 * @param page Playwright 页面对象。
 * @param relativePath mock vault 内的相对路径。
 * @returns Promise<void>。
 */
async function openMockNote(page: Page, relativePath: string): Promise<void> {
    await expandMockNotes(page);
    const fileName = relativePath.split("/").pop() ?? relativePath;
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: fileName }).first().waitFor({ state: "visible" });
}

/**
 * @function dragLocatorToPoint
 * @description 使用真实鼠标将 locator 拖到目标坐标。
 * @param page Playwright 页面对象。
 * @param locator 拖拽源元素。
 * @param targetX 目标 x 坐标。
 * @param targetY 目标 y 坐标。
 * @returns Promise<void>。
 */
async function dragLocatorToPoint(
    page: Page,
    locator: Locator,
    targetX: number,
    targetY: number,
): Promise<void> {
    const sourceBounds = await locator.boundingBox();
    if (!sourceBounds) {
        throw new Error("dragLocatorToPoint: source bounds missing");
    }

    await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(200);
}

/**
 * @function moveLocatorToPointWithoutDrop
 * @description 使用真实鼠标将 locator 拖到目标坐标但不释放，用于观察 split preview 中间帧。
 * @param page Playwright 页面对象。
 * @param locator 拖拽源元素。
 * @param targetX 目标 x 坐标。
 * @param targetY 目标 y 坐标。
 * @returns Promise<void>。
 */
async function moveLocatorToPointWithoutDrop(
    page: Page,
    locator: Locator,
    targetX: number,
    targetY: number,
): Promise<void> {
    const sourceBounds = await locator.boundingBox();
    if (!sourceBounds) {
        throw new Error("moveLocatorToPointWithoutDrop: source bounds missing");
    }

    await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 16 });
    await page.evaluate(() => new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
    }));
}

/**
 * @function splitActiveTabToRight
 * @description 将当前 active tab 拖到主内容区右侧创建 split。
 * @param page Playwright 页面对象。
 * @param tabTitle 要 split 的 tab 标题。
 * @returns Promise<void>。
 */
async function splitActiveTabToRight(page: Page, tabTitle: string): Promise<void> {
    const sourceTab = page.locator(".layout-v2-tab-section__tab-main", { hasText: tabTitle }).first();
    const targetContent = page.locator(".layout-v2-tab-section__content").first();
    const targetBounds = await targetContent.boundingBox();
    if (!targetBounds) {
        throw new Error("splitActiveTabToRight: target bounds missing");
    }

    await dragLocatorToPoint(
        page,
        sourceTab,
        targetBounds.x + targetBounds.width - 16,
        targetBounds.y + targetBounds.height / 2,
    );
}

/**
 * @function previewSplitActiveTabToRight
 * @description 将当前 active tab 拖到主内容区右侧并停在 split preview 状态。
 * @param page Playwright 页面对象。
 * @param tabTitle 要 split 的 tab 标题。
 * @returns Promise<void>。
 */
async function previewSplitActiveTabToRight(page: Page, tabTitle: string): Promise<void> {
    const sourceTab = page.locator(".layout-v2-tab-section__tab-main", { hasText: tabTitle }).first();
    const targetContent = page.locator(".layout-v2-tab-section__content").first();
    const targetBounds = await targetContent.boundingBox();
    if (!targetBounds) {
        throw new Error("previewSplitActiveTabToRight: target bounds missing");
    }

    await moveLocatorToPointWithoutDrop(
        page,
        sourceTab,
        targetBounds.x + targetBounds.width - 16,
        targetBounds.y + targetBounds.height / 2,
    );
}

test.describe("editor split performance", () => {
    test(`splitting with multiple notes open should not keep every inactive editor mounted ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        await waitForMockWorkbench(page);
        for (const notePath of NOTES_TO_OPEN) {
            await openMockNote(page, notePath);
        }

        await expect(page.locator(".layout-v2-tab-section__tab-main", { hasText: "table-vim-boundary.md" })).toBeVisible();
        await expect(page.locator(LIVE_EDITOR_SELECTOR)).toHaveCount(1);

        await previewSplitActiveTabToRight(page, "table-vim-boundary.md");

        const previewOverlay = page.locator("[data-layout-tab-preview-overlay='true']");
        await expect(previewOverlay).toBeVisible();
        await expect(previewOverlay.locator(".layout-v2-tab-section")).toHaveCount(2);
        const previewTabSection = previewOverlay.locator(".layout-v2-tab-section[data-tab-section-id^='preview-tab-section']", {
            hasText: "table-vim-boundary.md",
        });
        await expect(previewTabSection).toBeVisible();
        await expect(previewTabSection.locator(PREVIEW_MIRROR_SELECTOR)).toBeVisible();
        await expect(previewTabSection.locator(PREVIEW_MIRROR_EDITOR_SELECTOR)).toHaveCount(1);
        await expect(previewOverlay.locator(PREVIEW_MIRROR_FALLBACK_SELECTOR)).toHaveCount(0);
        await expect(previewOverlay).not.toContainText("Preview:");
        await expect(previewOverlay.locator(LIVE_EDITOR_SELECTOR)).toHaveCount(0);
        await expect(page.locator(LIVE_EDITOR_SELECTOR)).toHaveCount(1);

        await page.mouse.up();
        await page.waitForTimeout(200);

        await expect(page.locator(".layout-v2-tab-section")).toHaveCount(2);
        await expect(page.locator(PREVIEW_MIRROR_SELECTOR)).toHaveCount(0);
        await expect(page.locator(LIVE_EDITOR_SELECTOR)).toHaveCount(2);
        expect(pageErrors).toEqual([]);
    });
});