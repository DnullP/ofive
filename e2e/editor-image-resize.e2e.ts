/**
 * @module e2e/editor-image-resize
 * @description Mock-web editor image embed resize regression.
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";
const IMAGE_RESIZE_MARKDOWN = [
    "# Image Resize",
    "",
    "![[mock-image.png]]",
    "",
    "Tail",
].join("\n");

async function waitForMockWorkbench(page: Page): Promise<void> {
    await gotoMockVaultPage(page, "editor-image-resize", MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-right']").waitFor({ state: "visible" });
}

async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

async function openGuideNote(page: Page): Promise<void> {
    await page.getByTestId("activity-bar-item-files").click();
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${GUIDE_NOTE_PATH}']`).click();
    await page.getByRole("button", { name: "guide.md" }).first().waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
}

async function waitForEditorFrames(page: Page, frameCount = 2): Promise<void> {
    await page.evaluate(async (count) => {
        for (let index = 0; index < count; index += 1) {
            await new Promise<void>((resolve) => {
                window.requestAnimationFrame(() => resolve());
            });
        }
    }, frameCount);
}

async function replaceActiveEditorDoc(page: Page, markdown: string, cursorNeedle: string): Promise<void> {
    await page.evaluate(({ nextMarkdown, needle }) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    focus: () => void;
                    dispatch: (spec: unknown) => void;
                    state: { doc: { length: number; toString(): string } };
                };
            };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("active editor view not found");
        }

        const anchor = Math.max(0, nextMarkdown.indexOf(needle));
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: nextMarkdown },
            selection: { anchor },
        });
        view.focus();
    }, { nextMarkdown: markdown, needle: cursorNeedle });
    await waitForEditorFrames(page, 4);
}

async function getActiveEditorDocText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    state: { doc: { toString(): string } };
                };
            };
        }) | null;
        return content?.cmTile?.view?.state.doc.toString() ?? "";
    });
}

test.describe("editor image resize", () => {
    test("embedded images fill editor width and persist dragged size", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openGuideNote(page);
        await replaceActiveEditorDoc(page, IMAGE_RESIZE_MARKDOWN, "Tail");

        const activeEditor = page.locator(".layout-v2-tab-section__card--active");
        const imageWidget = activeEditor.locator(".cm-image-embed-widget").first();
        const imageElement = imageWidget.locator(".cm-image-embed-image");
        await expect(imageWidget).toBeVisible();
        await expect(imageElement).toBeVisible();

        const imageLineContentWidth = await imageWidget.evaluate((element) => {
            const line = element.closest(".cm-line");
            if (!line) {
                return 0;
            }
            const rect = line.getBoundingClientRect();
            const style = getComputedStyle(line);
            return Math.round(
                rect.width
                - Number.parseFloat(style.paddingLeft || "0")
                - Number.parseFloat(style.paddingRight || "0"),
            );
        });
        const contentWidth = await activeEditor.locator(".cm-content").evaluate((element) =>
            Math.round(element.getBoundingClientRect().width),
        );
        const initialWidth = await imageWidget.evaluate((element) =>
            Math.round(element.getBoundingClientRect().width),
        );
        expect(imageLineContentWidth).toBeGreaterThan(0);
        expect(Math.abs(initialWidth - imageLineContentWidth)).toBeLessThanOrEqual(2);
        expect(initialWidth).toBeLessThanOrEqual(contentWidth);

        const handle = imageWidget.locator(".cm-image-embed-resize-handle");
        await imageWidget.hover();
        await expect(handle).toBeVisible();

        const handleBox = await handle.boundingBox();
        if (!handleBox) {
            throw new Error("image resize handle should be measurable");
        }
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(handleBox.x + handleBox.width / 2 - 180, handleBox.y + handleBox.height / 2 - 100, {
            steps: 6,
        });
        await waitForEditorFrames(page, 1);
        const resizedWidthDuringDrag = await imageWidget.evaluate((element) =>
            Math.round(element.getBoundingClientRect().width),
        );
        expect(resizedWidthDuringDrag).toBeLessThan(initialWidth - 80);
        await page.mouse.up();
        await waitForEditorFrames(page, 4);

        const docText = await getActiveEditorDocText(page);
        expect(docText).toMatch(/!\[\[mock-image\.png\|\d+x\d+\]\]/);

        await activeEditor.locator(".cm-tab-mode-toggle").focus();
        await page.keyboard.press("Enter");
        const readerImageWidget = activeEditor.locator(".cm-tab-reader .cm-image-embed-widget").first();
        await expect(readerImageWidget).toBeVisible();
        const readerWidth = await readerImageWidget.evaluate((element) =>
            Math.round(element.getBoundingClientRect().width),
        );
        expect(Math.abs(readerWidth - resizedWidthDuringDrag)).toBeLessThanOrEqual(8);
    });
});
