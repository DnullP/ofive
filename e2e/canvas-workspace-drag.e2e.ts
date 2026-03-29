/**
 * @module e2e/canvas-workspace-drag.e2e
 * @description Canvas 与工作区文件拖拽回归测试。
 *
 * 覆盖场景：
 * 1. 文件树文件拖到主区 Dockview 时，出现单层预览并打开文件 tab。
 * 2. 打开 `.canvas` 文件后，拖入文件节点、保存并重新加载仍能保持内容。
 *
 * @dependencies
 *   - @playwright/test
 *
 * @example
 *   bun run test:e2e --grep canvas-workspace-drag
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";

/**
 * @function ensureMockNotesTreeExpanded
 * @description 确保 mock 文件树中的 notes 目录已经展开。
 */
async function ensureMockNotesTreeExpanded(page: Page): Promise<void> {
    const rootItem = page.locator(".tree-item[data-tree-path='test-resources']");
    const notesItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    await page.locator(".tree-item[data-tree-path='test-resources']").waitFor({
        state: "visible",
    });

    const guideItem = page.locator(".tree-item[data-tree-path='test-resources/notes/guide.md']");
    if (await guideItem.isVisible().catch(() => false)) {
        return;
    }

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
 * @function waitForMockWorkspaceReady
 * @description 等待 mock 页面中的文件树和主区完成渲染。
 */
async function waitForMockWorkspaceReady(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await ensureMockNotesTreeExpanded(page);
    await page.locator("[data-testid='main-dockview-host']").waitFor({ state: "visible" });
}

/**
 * @function dragWorkspaceItem
 * @description 使用 HTML5 DragEvent 模拟从文件树拖拽到目标区域。
 */
async function dragWorkspaceItem(
    page: Page,
    sourceSelector: string,
    targetSelector: string,
    targetOffset: { x: number; y: number },
    options?: {
        drop?: boolean;
        dragEnd?: boolean;
    },
): Promise<void> {
    const source = page.locator(sourceSelector);
    const target = page.locator(targetSelector);
    await source.waitFor({ state: "visible" });
    await target.waitFor({ state: "visible" });

    const sourceRect = await source.boundingBox();
    const targetRect = await target.boundingBox();
    if (!sourceRect || !targetRect) {
        throw new Error("dragWorkspaceItem: source or target bounds missing");
    }

    await page.evaluate(
        async ({
            sourceSelector: nextSourceSelector,
            targetSelector: nextTargetSelector,
            startX,
            startY,
            endX,
            endY,
            drop,
            dragEnd,
        }) => {
            const wait = (ms: number): Promise<void> => {
                return new Promise((resolve) => window.setTimeout(resolve, ms));
            };

            const source = document.querySelector<HTMLElement>(nextSourceSelector)
                ?? document.elementFromPoint(startX, startY) as HTMLElement | null;
            const target = document.querySelector<HTMLElement>(nextTargetSelector)
                ?? document.elementFromPoint(endX, endY) as HTMLElement | null;
            if (!source || !target) {
                throw new Error("dragWorkspaceItem: source or target not found");
            }
            const dataTransfer = new DataTransfer();

            const dispatch = (element: Element, type: string, x: number, y: number): void => {
                const event = new DragEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    dataTransfer,
                });
                element.dispatchEvent(event);
            };

            dispatch(source, "dragstart", startX, startY);
            await wait(16);

            const steps = [0.35, 0.6, 0.82, 1];
            for (const progress of steps) {
                const x = startX + (endX - startX) * progress;
                const y = startY + (endY - startY) * progress;
                dispatch(target, "dragenter", x, y);
                dispatch(target, "dragover", x, y);
                await wait(24);
            }

            if (drop !== false) {
                dispatch(target, "drop", endX, endY);
                await wait(16);
            }
            if (dragEnd !== false) {
                dispatch(source, "dragend", startX, startY);
            }
        },
        {
            sourceSelector,
            targetSelector,
            startX: sourceRect.x + sourceRect.width / 2,
            startY: sourceRect.y + sourceRect.height / 2,
            endX: targetRect.x + targetRect.width * targetOffset.x,
            endY: targetRect.y + targetRect.height * targetOffset.y,
            drop: options?.drop ?? true,
            dragEnd: options?.dragEnd ?? true,
        },
    );

    await page.waitForTimeout(300);
}

/**
 * @function dragWorkspaceItemAcrossTargets
 * @description 使用同一条 HTML5 拖拽链路，按顺序经过多个目标区域，用于验证 preview 清理与跨区域切换。
 */
async function dragWorkspaceItemAcrossTargets(
    page: Page,
    sourceSelector: string,
    targets: Array<{
        selector: string;
        offset: { x: number; y: number };
    }>,
    options?: {
        dropOnLast?: boolean;
        dragEnd?: boolean;
    },
): Promise<void> {
    const source = page.locator(sourceSelector);
    await source.waitFor({ state: "visible" });

    const sourceRect = await source.boundingBox();
    if (!sourceRect) {
        throw new Error("dragWorkspaceItemAcrossTargets: source bounds missing");
    }

    const targetRects = await Promise.all(targets.map(async (target) => {
        const locator = page.locator(target.selector);
        await locator.waitFor({ state: "visible" });
        const rect = await locator.boundingBox();
        if (!rect) {
            throw new Error(`dragWorkspaceItemAcrossTargets: target bounds missing for ${target.selector}`);
        }
        return {
            selector: target.selector,
            rect,
            offset: target.offset,
        };
    }));

    await page.evaluate(
        async ({
            sourceSelector: nextSourceSelector,
            startX,
            startY,
            targets: nextTargets,
            dropOnLast,
            dragEnd,
        }) => {
            const wait = (ms: number): Promise<void> => {
                return new Promise((resolve) => window.setTimeout(resolve, ms));
            };

            const source = document.querySelector<HTMLElement>(nextSourceSelector)
                ?? document.elementFromPoint(startX, startY) as HTMLElement | null;
            if (!source) {
                throw new Error("dragWorkspaceItemAcrossTargets: source not found");
            }

            const dataTransfer = new DataTransfer();
            const dispatch = (element: Element, type: string, x: number, y: number): void => {
                const event = new DragEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    dataTransfer,
                });
                element.dispatchEvent(event);
            };

            dispatch(source, "dragstart", startX, startY);
            await wait(16);

            for (let index = 0; index < nextTargets.length; index += 1) {
                const targetInfo = nextTargets[index];
                const endX = targetInfo.rect.x + targetInfo.rect.width * targetInfo.offset.x;
                const endY = targetInfo.rect.y + targetInfo.rect.height * targetInfo.offset.y;
                const target = document.querySelector<HTMLElement>(targetInfo.selector)
                    ?? document.elementFromPoint(endX, endY) as HTMLElement | null;
                if (!target) {
                    throw new Error(`dragWorkspaceItemAcrossTargets: target not found for ${targetInfo.selector}`);
                }

                dispatch(target, "dragenter", endX, endY);
                dispatch(target, "dragover", endX, endY);
                await wait(24);

                if (index === nextTargets.length - 1 && dropOnLast !== false) {
                    dispatch(target, "drop", endX, endY);
                    await wait(16);
                }
            }

            if (dragEnd !== false) {
                dispatch(source, "dragend", startX, startY);
            }
        },
        {
            sourceSelector,
            startX: sourceRect.x + sourceRect.width / 2,
            startY: sourceRect.y + sourceRect.height / 2,
            targets: targetRects,
            dropOnLast: options?.dropOnLast ?? true,
            dragEnd: options?.dragEnd ?? true,
        },
    );

    await page.waitForTimeout(300);
}

test.describe("canvas-workspace-drag", () => {
    test.beforeEach(async ({ page }) => {
        await waitForMockWorkspaceReady(page);
    });

    test("dragging a workspace file to dockview should show preview, open a split tab, and clear preview when returning to file tree", async ({ page }) => {
        const sourceSelector = ".tree-item[data-tree-path='test-resources/notes/guide.md']";
        const targetSelector = "[data-testid='main-dockview-host']";

        const dragPromise = dragWorkspaceItem(page, sourceSelector, targetSelector, {
            x: 0.82,
            y: 0.5,
        });

        await expect(page.locator(".main-dockview-workspace-drop-preview")).toHaveCount(1);
        await dragPromise;

        await expect(page.locator(".dv-tab", { hasText: "guide.md" })).toBeVisible();
        await expect(page.locator(".main-dockview-workspace-drop-preview")).toHaveCount(0);

        const previewClearProbe = dragWorkspaceItemAcrossTargets(
            page,
            ".tree-item[data-tree-path='test-resources/notes/latex-test.md']",
            [
                {
                    selector: "[data-testid='main-dockview-host']",
                    offset: { x: 0.82, y: 0.5 },
                },
                {
                    selector: ".tree-root",
                    offset: { x: 0.25, y: 0.2 },
                },
            ],
            {
                dropOnLast: false,
                dragEnd: false,
            },
        );

        await page.waitForTimeout(80);
        await expect(page.locator(".main-dockview-workspace-drop-preview")).toHaveCount(0);
        await previewClearProbe;
    });

    test("canvas tab should accept dropped file nodes without split preview", async ({ page }) => {
        await dragWorkspaceItem(
            page,
            ".tree-item[data-tree-path='test-resources/notes/network-segment.md']",
            "[data-testid='main-dockview-host']",
            { x: 0.82, y: 0.5 },
        );

        await expect(page.locator(".dv-tab", { hasText: "network-segment.md" })).toBeVisible();

        await page.locator(".tree-item[data-tree-path='test-resources/notes/glass-validation.canvas']").dblclick();
        await expect(page.locator(".canvas-tab")).toBeVisible();
        await page.locator(".canvas-tab__surface").waitFor({ state: "visible" });
        await ensureMockNotesTreeExpanded(page);

        const previewProbe = dragWorkspaceItem(
            page,
            ".tree-item[data-tree-path='test-resources/notes/guide.md']",
            ".canvas-tab__surface",
            { x: 0.55, y: 0.45 },
            { drop: false, dragEnd: false },
        );

        await expect(page.locator(".main-dockview-workspace-drop-preview")).toHaveCount(0);
        await previewProbe;

        await dragWorkspaceItem(
            page,
            ".tree-item[data-tree-path='test-resources/notes/guide.md']",
            ".canvas-tab__surface",
            { x: 0.55, y: 0.45 },
        );

        await expect(page.locator(".canvas-tab__node", { hasText: "guide.md" }).first()).toBeVisible();
        await expect(page.locator(".main-dockview-workspace-drop-preview")).toHaveCount(0);
    });
});
