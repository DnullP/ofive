/**
 * @module e2e/editor-render-surface-contract
 * @description Mock-web editor 功能面契约：用一个短文档锚定当前语法渲染、
 *   块级 widget、交互式插件与可视化编辑组件的可见行为。
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";

const CONTRACT_MARKDOWN = [
    "---",
    "title: Editor Surface Contract",
    "alias:",
    "  - Surface Anchor",
    "published: true",
    "count: 2",
    "---",
    "",
    "# Heading Anchor",
    "",
    "Line with **bold** *italic* ~~strike~~ `inline code` [[guide]] [[guide|Guide Alias]] #topic [external](https://example.com) ==mark==.",
    "",
    "> Quote text",
    "- unordered item",
    "1. ordered item",
    "- [ ] todo item",
    "---",
    "",
    "Inline math $E=mc^2$ and image ![[mock-image.png]].",
    "",
    "| Feature | Status |",
    "| --- | --- |",
    "| Wiki | [[guide]] |",
    "| Link | [external](https://example.com) |",
    "",
    "```ts",
    "const ignored = \"[[guide]] ==mark== #tag $E=mc^2$\";",
    "```",
    "",
    "$$",
    "a+b=c",
    "$$",
    "",
    "Plain tail",
].join("\n");

async function waitForMockWorkbench(page: Page): Promise<void> {
    await gotoMockVaultPage(page, "editor-render-surface-contract", MOCK_PAGE);
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

async function waitForEditorFrames(page: Page, frameCount = 4): Promise<void> {
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
            throw new Error("EditorView not found.");
        }

        const needleIndex = nextMarkdown.indexOf(needle);
        if (needleIndex < 0) {
            throw new Error(`Needle not found: ${needle}`);
        }

        view.focus();
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: nextMarkdown },
            selection: { anchor: needleIndex + needle.length },
            scrollIntoView: true,
        });
    }, { nextMarkdown: markdown, needle: cursorNeedle });
    await waitForEditorFrames(page);
}

async function setActiveEditorSelectionToNeedleEnd(page: Page, needle: string): Promise<void> {
    await page.evaluate((targetText) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    focus: () => void;
                    dispatch: (spec: unknown) => void;
                    state: {
                        doc: {
                            toString(): string;
                        };
                    };
                };
            };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found.");
        }

        const docText = view.state.doc.toString();
        const needleIndex = docText.indexOf(targetText);
        if (needleIndex < 0) {
            throw new Error(`Needle not found: ${targetText}`);
        }

        view.focus();
        view.dispatch({
            selection: { anchor: needleIndex + targetText.length },
            scrollIntoView: true,
        });
    }, needle);
    await waitForEditorFrames(page, 2);
}

async function getActiveEditorDocText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    state: {
                        doc: {
                            toString(): string;
                        };
                    };
                };
            };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found.");
        }
        return view.state.doc.toString();
    });
}

async function dispatchPreviewHoverOnFirstWikiLink(page: Page): Promise<void> {
    await page.evaluate(() => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active");
        const proseLine = Array.from(activeCard?.querySelectorAll<HTMLElement>(".cm-line") ?? [])
            .find((line) => line.textContent?.includes("Line with"));
        const link = proseLine?.querySelector<HTMLElement>(".cm-rendered-wikilink");
        if (!link) {
            throw new Error("Rendered wikilink not found.");
        }

        const rect = link.getBoundingClientRect();
        link.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            ctrlKey: true,
            metaKey: true,
        }));
    });
    await waitForEditorFrames(page, 2);
}

test.describe("editor render surface contract", () => {
    test("anchors current syntax renderers, widgets, and interactive plugins in mock web", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openGuideNote(page);
        await replaceActiveEditorDoc(page, CONTRACT_MARKDOWN, "Plain tail");

        const activeEditor = page.locator(".layout-v2-tab-section__card--active");
        const proseLine = activeEditor.locator(".cm-line", { hasText: "Line with" });
        const codeLine = activeEditor.locator(".cm-line.cm-code-block-line", {
            hasText: "const ignored",
        });

        await expect(activeEditor.locator(".cm-frontmatter-widget .fmv-editor")).toBeVisible();
        await expect(activeEditor.locator(".cm-frontmatter-widget [data-frontmatter-field-key='title']")).toBeVisible();
        await expect(activeEditor.locator(".cm-rendered-header-h1", { hasText: "Heading Anchor" })).toBeVisible();
        await expect(proseLine.locator(".cm-rendered-bold", { hasText: "bold" })).toBeVisible();
        await expect(proseLine.locator(".cm-rendered-italic", { hasText: "italic" })).toBeVisible();
        await expect(proseLine.locator(".cm-rendered-strikethrough", { hasText: "strike" })).toBeVisible();
        await expect(proseLine.locator(".cm-rendered-inline-code", { hasText: "inline code" })).toBeVisible();
        await expect(proseLine.locator(".cm-rendered-wikilink", { hasText: "guide" }).first()).toBeVisible();
        await expect(proseLine.locator(".cm-rendered-wikilink-display", { hasText: "Guide Alias" })).toBeVisible();
        await expect(proseLine.locator(".cm-rendered-tag", { hasText: "#topic" })).toBeVisible();
        await expect(proseLine.locator(".cm-rendered-link", { hasText: "external" })).toBeVisible();
        await expect(proseLine.locator(".cm-rendered-highlight", { hasText: "mark" })).toBeVisible();
        await expect(activeEditor.locator(".cm-rendered-blockquote", { hasText: "Quote text" })).toBeVisible();
        await expect(activeEditor.locator(".cm-rendered-list-marker-unordered")).toBeVisible();
        await expect(activeEditor.locator(".cm-rendered-list-marker-ordered")).toBeVisible();
        await expect(activeEditor.locator(".cm-rendered-task-checkbox-unchecked")).toBeVisible();
        await expect(activeEditor.locator(".cm-rendered-horizontal-rule")).toBeVisible();
        await expect(activeEditor.locator(".cm-latex-inline-widget")).toBeVisible();
        await expect(activeEditor.locator(".cm-image-embed-widget")).toBeVisible();
        await expect(activeEditor.locator(".cm-markdown-table-widget .mtv-shell")).toBeVisible();
        await expect(activeEditor.locator(".cm-markdown-table-widget .cm-rendered-wikilink", { hasText: "guide" })).toBeVisible();
        await expect(codeLine).toBeVisible();
        await expect(activeEditor.locator(".cm-code-block-copy-btn")).toBeVisible();
        await expect(codeLine.locator(".cm-rendered-wikilink")).toHaveCount(0);
        await expect(codeLine.locator(".cm-rendered-highlight")).toHaveCount(0);
        await expect(codeLine.locator(".cm-rendered-tag")).toHaveCount(0);
        await expect(codeLine.locator(".cm-latex-inline-widget")).toHaveCount(0);
        await expect(activeEditor.locator(".cm-latex-block-widget")).toBeVisible();

        await dispatchPreviewHoverOnFirstWikiLink(page);
        await expect(page.locator(".cm-wikilink-preview-tooltip")).toBeVisible();

        await activeEditor.locator(".cm-rendered-task-checkbox-unchecked").click({ force: true });
        await expect(activeEditor.locator(".cm-rendered-task-checkbox-checked")).toBeVisible();
        await expect(await getActiveEditorDocText(page)).toContain("- [x] todo item");

        await setActiveEditorSelectionToNeedleEnd(page, "Plain tail");
        await page.keyboard.type(" [[gu");
        await expect(page.locator(".cm-wikilink-suggest-popup")).toBeVisible();
        await expect(page.locator(".cm-wikilink-suggest-item").first()).toContainText(/guide/i);
    });
});
