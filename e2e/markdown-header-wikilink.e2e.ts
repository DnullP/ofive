/**
 * @module e2e/markdown-header-wikilink
 * @description Markdown 标题内 WikiLink 样式优先级回归测试。
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const HEADER_WIKILINK_NOTE_PATH = "test-resources/notes/header-wikilink-regression.md";

async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.addInitScript(() => {
        localStorage.clear();
    });
    await page.goto(MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section").first().waitFor({ state: "visible" });
}

async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

async function openMockHeaderWikiLinkNote(page: Page): Promise<void> {
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${HEADER_WIKILINK_NOTE_PATH}']`).click();
    await page.getByRole("button", { name: "header-wikilink-regression.md" }).first().waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
}

async function moveCursorAwayFromHeader(page: Page): Promise<void> {
    await page.locator(".layout-v2-tab-section__card--active .cm-line", { hasText: "body" }).click();
    await page.locator(".layout-v2-tab-section__card--active .cm-line.cm-rendered-header-line-h1")
        .waitFor({ state: "visible" });
}

async function readEditorHeaderWikiLinkStyles(page: Page): Promise<{
    editorHeaderFontSize: string;
    editorWikiLinkFontSize: string;
    editorAliasFontSize: string;
    editorWikiLinkTextDecorationLine: string;
    editorAliasTextDecorationLine: string;
}> {
    return page.evaluate(() => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active");
        if (!activeCard) {
            throw new Error("Active tab card not found");
        }

        const editorHeaderLine = activeCard.querySelector<HTMLElement>(".cm-line.cm-rendered-header-line-h1");
        const editorWikiLink = editorHeaderLine?.querySelector<HTMLElement>(".cm-rendered-wikilink:not(.cm-rendered-wikilink-display)");
        const editorAlias = editorHeaderLine?.querySelector<HTMLElement>(".cm-rendered-wikilink-display");
        if (!editorHeaderLine || !editorWikiLink || !editorAlias) {
            throw new Error("Editor header wikilink nodes not found");
        }

        return {
            editorHeaderFontSize: window.getComputedStyle(editorHeaderLine).fontSize,
            editorWikiLinkFontSize: window.getComputedStyle(editorWikiLink).fontSize,
            editorAliasFontSize: window.getComputedStyle(editorAlias).fontSize,
            editorWikiLinkTextDecorationLine: window.getComputedStyle(editorWikiLink).textDecorationLine,
            editorAliasTextDecorationLine: window.getComputedStyle(editorAlias).textDecorationLine,
        };
    });
}

async function readHeaderTextAlignment(page: Page, editing: boolean): Promise<{
    textLeft: number;
    fontSize: string;
    markerText: string | null;
}> {
    return page.evaluate((shouldReadEditing) => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active");
        if (!activeCard) {
            throw new Error("Active tab card not found");
        }

        const selector = shouldReadEditing
            ? ".cm-line.cm-rendered-header-source-line"
            : ".cm-line.cm-rendered-header-line-h1";
        const headerLine = activeCard.querySelector<HTMLElement>(selector);
        if (!headerLine) {
            throw new Error(`Header line not found: ${selector}`);
        }

        const marker = headerLine.querySelector<HTMLElement>(".cm-rendered-header-source-marker");
        const range = document.createRange();
        if (shouldReadEditing) {
            const walker = document.createTreeWalker(headerLine, NodeFilter.SHOW_TEXT);
            let textNode: Text | null = null;
            while (walker.nextNode()) {
                const candidate = walker.currentNode as Text;
                if (candidate.nodeValue?.includes("Aligned Heading")) {
                    textNode = candidate;
                    break;
                }
            }
            if (!textNode) {
                throw new Error("Editing header text node not found");
            }
            const textIndex = textNode.nodeValue?.indexOf("Aligned Heading") ?? -1;
            range.setStart(textNode, textIndex);
            range.setEnd(textNode, textIndex + "Aligned Heading".length);
        } else {
            const walker = document.createTreeWalker(headerLine, NodeFilter.SHOW_TEXT);
            let textNode: Text | null = null;
            while (walker.nextNode()) {
                const candidate = walker.currentNode as Text;
                if (candidate.nodeValue?.includes("Aligned Heading")) {
                    textNode = candidate;
                    break;
                }
            }
            if (!textNode) {
                throw new Error("Rendered header text node not found");
            }
            const textIndex = textNode.nodeValue?.indexOf("Aligned Heading") ?? -1;
            range.setStart(textNode, textIndex);
            range.setEnd(textNode, textIndex + "Aligned Heading".length);
        }
        const rect = range.getBoundingClientRect();
        range.detach();

        return {
            textLeft: rect.left,
            fontSize: window.getComputedStyle(headerLine).fontSize,
            markerText: marker?.textContent ?? null,
        };
    }, editing);
}

async function focusHeaderForSource(page: Page): Promise<void> {
    await page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    focus: () => void;
                    dispatch: (spec: unknown) => void;
                };
            };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found");
        }

        view.focus();
        view.dispatch({
            selection: { anchor: 4 },
            scrollIntoView: true,
        });
    });
}

async function switchToReadMode(page: Page): Promise<void> {
    await page.locator(".layout-v2-tab-section__card--active .cm-tab-mode-toggle").click();
    await page.locator(".layout-v2-tab-section__card--active .cm-tab-reader").waitFor({ state: "visible" });
}

async function readReaderHeaderWikiLinkStyles(page: Page): Promise<{
    readerHeaderFontSize: string;
    readerWikiLinkFontSize: string;
    readerWikiLinkTextDecorationLine: string;
}> {
    return page.evaluate(() => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active");
        if (!activeCard) {
            throw new Error("Active tab card not found");
        }

        const modeToggle = activeCard.querySelector<HTMLButtonElement>(".cm-tab-mode-toggle");
        if (!modeToggle) {
            throw new Error("Read mode toggle not found");
        }

        const readerHeader = activeCard.querySelector<HTMLElement>(".cm-tab-reader .cm-rendered-header-h1");
        const readerWikiLink = readerHeader?.querySelector<HTMLElement>(".cm-rendered-wikilink");
        if (!readerHeader || !readerWikiLink) {
            throw new Error("Reader header wikilink nodes not found");
        }

        return {
            readerHeaderFontSize: window.getComputedStyle(readerHeader).fontSize,
            readerWikiLinkFontSize: window.getComputedStyle(readerWikiLink).fontSize,
            readerWikiLinkTextDecorationLine: window.getComputedStyle(readerWikiLink).textDecorationLine,
        };
    });
}

test.describe("markdown header wikilink rendering", () => {
    test("标题内 WikiLink 应继承标题字号并保留链接样式", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openMockHeaderWikiLinkNote(page);
        await moveCursorAwayFromHeader(page);

        const editorStyles = await readEditorHeaderWikiLinkStyles(page);
        expect(editorStyles.editorWikiLinkFontSize).toBe(editorStyles.editorHeaderFontSize);
        expect(editorStyles.editorAliasFontSize).toBe(editorStyles.editorHeaderFontSize);
        expect(editorStyles.editorWikiLinkTextDecorationLine).toContain("underline");
        expect(editorStyles.editorAliasTextDecorationLine).toContain("underline");

        await switchToReadMode(page);
        const readerStyles = await readReaderHeaderWikiLinkStyles(page);
        expect(readerStyles.readerWikiLinkFontSize).toBe(readerStyles.readerHeaderFontSize);
        expect(readerStyles.readerWikiLinkTextDecorationLine).toContain("underline");
    });

    test("标题展开源码后正文起点应与渲染态对齐", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openMockHeaderWikiLinkNote(page);
        await page.evaluate(() => {
            const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
                cmTile?: {
                    view?: {
                        focus: () => void;
                        dispatch: (spec: unknown) => void;
                        state: {
                            doc: {
                                length: number;
                            };
                        };
                    };
                };
            }) | null;
            const view = content?.cmTile?.view;
            if (!view) {
                throw new Error("EditorView not found");
            }

            view.focus();
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: "# Aligned Heading\n\nbody",
                },
                selection: { anchor: "# Aligned Heading\n\nbody".length },
                scrollIntoView: true,
            });
        });
        await moveCursorAwayFromHeader(page);

        const renderedAlignment = await readHeaderTextAlignment(page, false);
        await focusHeaderForSource(page);
        await page.locator(".layout-v2-tab-section__card--active .cm-line.cm-rendered-header-source-line")
            .waitFor({ state: "visible" });

        const sourceAlignment = await readHeaderTextAlignment(page, true);
        expect(sourceAlignment.markerText).toBe("# ");
        expect(sourceAlignment.fontSize).toBe(renderedAlignment.fontSize);
        expect(Math.abs(sourceAlignment.textLeft - renderedAlignment.textLeft)).toBeLessThanOrEqual(1);
    });
});
