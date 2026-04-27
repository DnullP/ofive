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
});
