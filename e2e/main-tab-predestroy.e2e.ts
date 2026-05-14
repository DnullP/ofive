/**
 * @module e2e/main-tab-predestroy
 * @description 主区 tab 从右向左拖拽时的预销毁回归测试。
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const MOUSE_DRAG_TAG = "@mouse-drag";

async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await page.locator("[data-testid='main-dockview-host']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: "首页" }).first().waitFor({ state: "visible" });
}

async function openMockGuideTab(page: Page): Promise<void> {
    await expandMockNotes(page);
    await page.locator(".tree-item[data-tree-path='test-resources/notes/guide.md']").click();
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: "guide.md" }).first().waitFor({ state: "visible" });
}

async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await notesTreeItem.waitFor({ state: "visible" });
    await notesTreeItem.click();
}

async function openMockNote(page: Page, relativePath: string): Promise<void> {
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    const fileName = relativePath.split("/").pop() ?? relativePath;
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: fileName }).first().waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__card--active .cm-editor").waitFor({ state: "visible" });
}

async function dragLocatorToPoint(
    page: Page,
    locator: Locator,
    targetX: number,
    targetY: number,
): Promise<void> {
    const box = await locator.boundingBox();
    if (!box) {
        throw new Error("dragLocatorToPoint: source bounds missing");
    }

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(200);
}

async function createRightSideSplit(page: Page): Promise<void> {
    const sourceTab = page.locator(".layout-v2-tab-section__tab-main", { hasText: "guide.md" }).first();
    const targetContent = page.locator('.layout-v2-tab-section[data-tab-section-id="main-tabs"] .layout-v2-tab-section__content').first();
    const targetBounds = await targetContent.boundingBox();
    if (!targetBounds) {
        throw new Error("createRightSideSplit: target bounds missing");
    }

    await dragLocatorToPoint(
        page,
        sourceTab,
        targetBounds.x + targetBounds.width - 16,
        targetBounds.y + targetBounds.height / 2,
    );
}

async function createRightSideSplitForTab(page: Page, tabTitle: string): Promise<void> {
    const sourceTab = page.locator(".layout-v2-tab-section__tab-main", { hasText: tabTitle }).first();
    const targetContent = page.locator('.layout-v2-tab-section[data-tab-section-id="main-tabs"] .layout-v2-tab-section__content').first();
    const targetBounds = await targetContent.boundingBox();
    if (!targetBounds) {
        throw new Error("createRightSideSplitForTab: target bounds missing");
    }

    await dragLocatorToPoint(
        page,
        sourceTab,
        targetBounds.x + targetBounds.width - 16,
        targetBounds.y + targetBounds.height / 2,
    );
}

async function readProjectedTabSections(page: Page): Promise<Array<{ id: string | null; titles: string[] }>> {
    return page.evaluate(() => {
        const overlayRoot = document.querySelector<HTMLElement>("[data-layout-tab-preview-overlay='true']");
        const queryRoot: ParentNode = overlayRoot ?? document;
        return Array.from(queryRoot.querySelectorAll<HTMLElement>(".layout-v2-tab-section")).map((node) => ({
            id: node.getAttribute("data-tab-section-id"),
            titles: Array.from(node.querySelectorAll<HTMLElement>(".layout-v2-tab-section__tab-title")).map((item) => item.textContent ?? ""),
        }));
    });
}

async function readPreviewSectionRects(page: Page): Promise<Array<{
    id: string | null;
    left: number;
    right: number;
    width: number;
    titles: string[];
}>> {
    return page.evaluate(() => {
        const overlayRoot = document.querySelector<HTMLElement>("[data-layout-tab-preview-overlay='true']");
        const overlaySections = overlayRoot
            ? Array.from(overlayRoot.querySelectorAll<HTMLElement>(".layout-v2-tab-section"))
            : [];
        const sectionNodes = overlaySections.length > 0
            ? overlaySections
            : Array.from(document.querySelectorAll<HTMLElement>(".layout-v2-tab-section"));
        return sectionNodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return {
                id: node.getAttribute("data-tab-section-id"),
                left: rect.left,
                right: rect.right,
                width: rect.width,
                titles: Array.from(node.querySelectorAll<HTMLElement>(".layout-v2-tab-section__tab-title")).map((item) => item.textContent ?? ""),
            };
        });
    });
}

test.describe("main tab pre-destroy", () => {
    test(`right-to-left lone-tab drag should not leave an empty shell ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        await waitForMockWorkbench(page);
        await openMockGuideTab(page);
        await createRightSideSplit(page);

        const sourceTab = page.locator('.layout-v2-tab-section[data-tab-section-id="main-tabs-tabs"] .layout-v2-tab-section__tab-main', {
            hasText: "guide.md",
        }).first();
        const sourceBounds = await sourceTab.boundingBox();
        if (!sourceBounds) {
            throw new Error("right-to-left pre-destroy: source bounds missing");
        }

        const startX = sourceBounds.x + sourceBounds.width / 2;
        const startY = sourceBounds.y + sourceBounds.height / 2;

        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX - 24, startY, { steps: 10 });
        await page.waitForTimeout(120);

        const sections = await readProjectedTabSections(page);
        expect(sections).toHaveLength(1);
        expect(sections[0]?.id).toBe("main-tabs");
        expect(sections.some((section) => section.titles.length === 0)).toBe(false);
        await expect(page.getByText("No open tabs")).toHaveCount(0);

        await page.mouse.up();
    });

    test(`splitting ready editor should enter pending presentation before remounted editor is committed ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        await waitForMockWorkbench(page);
        await openMockNote(page, "test-resources/notes/network-segment.md");

        const observedStates: string[] = [];
        await page.exposeFunction("__recordSplitPresentationState", (state: string) => {
            observedStates.push(state);
        });
        await page.evaluate(() => {
            const callback = (window as unknown as {
                __recordSplitPresentationState?: (state: string) => void;
            }).__recordSplitPresentationState;
            let frameId = 0;
            const sample = (): void => {
                document
                    .querySelectorAll<HTMLElement>(".layout-v2-tab-section__card")
                    .forEach((card) => {
                        if (card.querySelector(".cm-editor")) {
                            callback?.(card.dataset.layoutPresentationState ?? "missing");
                        }
                    });
                frameId = window.requestAnimationFrame(sample);
            };
            frameId = window.requestAnimationFrame(sample);
            (window as unknown as { __stopSplitPresentationMonitor?: () => void }).__stopSplitPresentationMonitor = () => {
                window.cancelAnimationFrame(frameId);
            };
        });

        const sourceTab = page.locator(".layout-v2-tab-section__tab-main", { hasText: "network-segment.md" }).first();
        const targetContent = page.locator(".layout-v2-tab-section__content").first();
        const targetBounds = await targetContent.boundingBox();
        if (!targetBounds) {
            throw new Error("splitting ready editor: target bounds missing");
        }

        await dragLocatorToPoint(
            page,
            sourceTab,
            targetBounds.x + targetBounds.width - 16,
            targetBounds.y + targetBounds.height / 2,
        );
        await page.evaluate(() => {
            (window as unknown as { __stopSplitPresentationMonitor?: () => void }).__stopSplitPresentationMonitor?.();
        });

        expect(observedStates).toContain("pending");
        await expect(page.locator(".layout-v2-tab-section")).toHaveCount(2);
    });

    test(`right lone-tab pre-destroy should hit-test against the merged preview area ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });
        page.on("console", (message) => {
            if (message.type() === "error") {
                consoleErrors.push(message.text());
            }
        });

        await waitForMockWorkbench(page);
        await openMockNote(page, "test-resources/notes/network-segment.md");
        await openMockNote(page, "test-resources/notes/guide.md");
        await createRightSideSplitForTab(page, "guide.md");

        const leftSectionBefore = await page.locator('.layout-v2-tab-section[data-tab-section-id="main-tabs"]').boundingBox();
        const rightSectionBefore = await page.locator('.layout-v2-tab-section[data-tab-section-id="main-tabs-tabs"]').boundingBox();
        if (!leftSectionBefore || !rightSectionBefore) {
            throw new Error("right lone-tab merged preview hit-test: initial split bounds missing");
        }

        const sourceTab = page.locator('.layout-v2-tab-section[data-tab-section-id="main-tabs-tabs"] .layout-v2-tab-section__tab-main', {
            hasText: "guide.md",
        }).first();
        const sourceBounds = await sourceTab.boundingBox();
        if (!sourceBounds) {
            throw new Error("right lone-tab merged preview hit-test: source bounds missing");
        }

        const startX = sourceBounds.x + sourceBounds.width / 2;
        const startY = sourceBounds.y + sourceBounds.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();

        // User expectation:
        // The right section has only one tab. Once that tab starts dragging, the source
        // section is pre-destroyed and the left multi-tab section is preview-merged into
        // the whole main area. From this frame on, split hit-testing must use that merged
        // preview area. Moving inside the old right-half area should therefore still
        // trigger a split preview against the survivor section, not wait until the cursor
        // re-enters the old left-half bounds.
        await page.mouse.move(startX - 24, startY, { steps: 10 });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        const mergedOnlySections = await readPreviewSectionRects(page);
        expect(mergedOnlySections).toHaveLength(1);
        expect(mergedOnlySections[0]?.id).toBe("main-tabs");
        expect(mergedOnlySections[0]?.width).toBeGreaterThan(leftSectionBefore.width + rightSectionBefore.width * 0.6);

        const oldRightAreaX = rightSectionBefore.x + rightSectionBefore.width - 16;
        await page.mouse.move(oldRightAreaX, rightSectionBefore.y + rightSectionBefore.height / 2, { steps: 6 });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

        const splitPreviewSections = await readPreviewSectionRects(page);
        expect({ pageErrors, consoleErrors }).toEqual({ pageErrors: [], consoleErrors: [] });
        expect(splitPreviewSections).toHaveLength(2);
        expect(splitPreviewSections.some((section) => section.id?.startsWith("preview-tab-section-main-tabs"))).toBe(true);

        await page.mouse.up();
    });
});
