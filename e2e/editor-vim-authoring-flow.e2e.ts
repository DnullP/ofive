/**
 * @module e2e/editor-vim-authoring-flow
 * @description 从用户视角验证 Vim 编辑：通过 Vim 键盘路径创作一篇包含多种 Markdown 要素的文章。
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";

const INTRO_CHUNK = [
    "---",
    "title: Vim Authored Architecture Note",
    "alias:",
    "  - Vim authoring flow",
    "tags:",
    "  - editor",
    "  - regression",
    "published: false",
    "---",
    "",
    "# Vim Authored Architecture Note",
    "",
    "今天这篇笔记用于记录一次真实的编辑器验收。它包含 **bold**、*italic*、~~deprecated~~、`inline code`、[[guide]]、 #editor、==highlight== 和 [reference](https://example.com)。",
].join("\n");

const PLAN_CHUNK = [
    "## Draft Plan",
    "",
    "- [ ] Capture current behavior",
    "- [ ] Verify Vim-only authoring",
    "- [ ] Review rendered note",
].join("\n");

const TABLE_CHUNK = [
    "## Coverage Table",
    "",
    "| Surface | Expected |",
    "| --- | --- |",
    "| WikiLink | [[guide]] preview path |",
    "| Code | `EditorView` remains editable |",
].join("\n");

const TECHNICAL_CHUNK = [
    "## Implementation Sketch",
    "",
    "```ts",
    "const note = \"[[guide]] ==highlight== #tag $E=mc^2$\";",
    "console.log(note);",
    "```",
    "",
    "Inline math stays readable: $E=mc^2$.",
    "",
    "Visual asset placeholder: ![[mock-image.png]].",
    "",
    "$$",
    "a+b=c",
    "$$",
    "",
    "## Final Check",
    "",
    "> Done from Vim.",
].join("\n");

const FULL_ARTICLE = [
    INTRO_CHUNK,
    "",
    PLAN_CHUNK,
    "",
    TABLE_CHUNK,
    "",
    TECHNICAL_CHUNK,
].join("\n");

function activeEditor(page: Page) {
    return page.locator(".layout-v2-tab-section__card--active");
}

function visibleEditor(page: Page) {
    return page.locator(".cm-editor:visible").first();
}

async function waitForMockWorkbench(page: Page): Promise<void> {
    await gotoMockVaultPage(page, "editor-vim-authoring-flow", MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-right']").waitFor({ state: "visible" });
}

async function enableEditorVimMode(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const configStoreModule = await import("/src/host/config/configStore.ts");
        await configStoreModule.syncConfigStateForVault("/mock/notes", true);
        if (!configStoreModule.getConfigSnapshot().featureSettings.vimModeEnabled) {
            await configStoreModule.updateVimModeEnabled(true);
        }
    });
}

async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

async function openMockNote(page: Page, relativePath: string): Promise<void> {
    await page.getByTestId("activity-bar-item-files").click();
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    const fileName = relativePath.split("/").pop() ?? relativePath;
    await page.getByRole("button", { name: fileName }).first().waitFor({ state: "visible" });
    await activeEditor(page).locator(".cm-content").waitFor({ state: "visible" });
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

async function pressVimKeys(page: Page, keys: string[]): Promise<void> {
    for (const key of keys) {
        await page.keyboard.press(key);
        await waitForEditorFrames(page, 1);
    }
}

async function clearCurrentNoteWithVim(page: Page): Promise<void> {
    await visibleEditor(page).locator(".cm-content").click();
    await page.keyboard.press("Escape");
    await pressVimKeys(page, ["g", "g", "d", "Shift+G"]);
    await waitForEditorFrames(page, 4);
}

async function typeMarkdownChunk(page: Page, text: string): Promise<void> {
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (line.length > 0) {
            await page.keyboard.insertText(line);
        }
        if (index < lines.length - 1) {
            await page.keyboard.press("Enter");
        }
        if (index % 3 === 2) {
            await waitForEditorFrames(page, 1);
        }
    }
}

async function writeArticleWithVim(page: Page, text: string): Promise<void> {
    await page.keyboard.press("i");
    await typeMarkdownChunk(page, text);
    await page.keyboard.press("Escape");
    await waitForEditorFrames(page, 4);
}

async function appendReviewTextWithVim(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+G");
    await waitForEditorFrames(page, 2);
    await page.keyboard.press("Shift+A");
    await page.keyboard.insertText(" Reviewed.");
    await page.keyboard.press("Escape");
    await waitForEditorFrames(page, 4);
}

async function completeFirstTaskWithVim(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await pressVimKeys(page, ["g", "g", "1", "6", "j", "c", "c"]);
    await page.keyboard.insertText("- [x] Capture current behavior");
    await page.keyboard.press("Escape");
    await waitForEditorFrames(page, 4);
}

test.describe("editor Vim authoring flow", () => {
    test("creates and reviews a rich article using Vim keyboard operations", async ({ page }) => {
        test.setTimeout(60_000);

        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error") {
                consoleErrors.push(message.text());
            }
        });
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        await waitForMockWorkbench(page);
        await enableEditorVimMode(page);
        await openMockNote(page, GUIDE_NOTE_PATH);

        await clearCurrentNoteWithVim(page);
        await writeArticleWithVim(page, FULL_ARTICLE);
        await completeFirstTaskWithVim(page);
        await appendReviewTextWithVim(page);

        const editor = activeEditor(page);
        const introLine = editor.locator(".cm-line", { hasText: "今天这篇笔记" });
        const codeLine = editor.locator(".cm-line.cm-code-block-line", { hasText: "const note" });

        await expect(editor.locator(".cm-line", { hasText: "title: Vim Authored Architecture Note" })).toBeVisible();
        await expect(editor.locator(".cm-line", { hasText: "Vim authoring flow" })).toBeVisible();
        await expect(editor.locator(".cm-line", { hasText: "# Vim Authored Architecture Note" })).toBeVisible();
        await expect(editor.locator(".cm-line", { hasText: "Draft Plan" })).toBeVisible();
        await expect(editor.locator(".cm-line", { hasText: "Coverage Table" })).toBeVisible();
        await expect(editor.locator(".cm-line", { hasText: "Implementation Sketch" })).toBeVisible();
        await expect(introLine.locator(".cm-rendered-bold", { hasText: "bold" })).toBeVisible();
        await expect(introLine.locator(".cm-rendered-italic", { hasText: "italic" })).toBeVisible();
        await expect(introLine.locator(".cm-rendered-strikethrough", { hasText: "deprecated" })).toBeVisible();
        await expect(introLine.locator(".cm-rendered-inline-code", { hasText: "inline code" })).toBeVisible();
        await expect(introLine.locator(".cm-rendered-wikilink", { hasText: "guide" })).toBeVisible();
        await expect(introLine.locator(".cm-rendered-tag", { hasText: "#editor" })).toBeVisible();
        await expect(introLine.locator(".cm-rendered-highlight", { hasText: "highlight" })).toBeVisible();
        await expect(introLine.locator(".cm-rendered-link", { hasText: "reference" })).toBeVisible();
        await expect(editor.locator(".cm-rendered-task-checkbox-checked")).toBeVisible();
        await expect(editor.locator(".cm-rendered-task-checkbox-unchecked")).toHaveCount(2);
        await expect(editor.locator(".cm-line", { hasText: "| Surface | Expected |" })).toBeVisible();
        await expect(editor.locator(".cm-line", { hasText: "| WikiLink |" })).toBeVisible();
        await expect(editor.locator(".cm-line", { hasText: "| Code |" })).toBeVisible();
        await expect(codeLine).toBeVisible();
        await expect(codeLine.locator(".cm-rendered-wikilink")).toHaveCount(0);
        await expect(codeLine.locator(".cm-rendered-highlight")).toHaveCount(0);
        await expect(codeLine.locator(".cm-rendered-tag")).toHaveCount(0);
        await expect(codeLine.locator(".cm-latex-inline-widget")).toHaveCount(0);
        await expect(editor.locator(".cm-code-block-copy-btn")).toBeVisible();
        await expect(editor.locator(".cm-latex-inline-widget")).toBeVisible();
        await expect(editor.locator(".cm-image-embed-widget")).toBeVisible();
        await expect(editor.locator(".cm-latex-block-widget")).toBeVisible();
        await expect(editor.locator(".cm-line", { hasText: "Done from Vim. Reviewed." })).toBeVisible();

        await editor.locator(".cm-tab-mode-toggle").focus();
        await page.keyboard.press("Enter");
        const reader = editor.locator(".cm-tab-reader");
        await expect(reader).toBeVisible();
        await expect(reader.locator(".cm-rendered-header-h1", { hasText: "Vim Authored Architecture Note" })).toBeVisible();
        await expect(reader.locator(".cm-rendered-header-h2", { hasText: "Coverage Table" })).toBeVisible();
        await expect(reader.locator(".cm-rendered-wikilink", { hasText: "guide" }).first()).toBeVisible();
        await expect(reader.locator(".cm-rendered-inline-code", { hasText: "inline code" })).toBeVisible();
        await expect(reader.locator(".cm-rendered-highlight", { hasText: "highlight" })).toBeVisible();
        await expect(reader).toContainText("WikiLink");
        await expect(reader).toContainText("EditorView remains editable");
        await expect(reader.locator("code", { hasText: "const note" })).toBeVisible();
        await expect(reader.locator(".cm-latex-inline-widget")).toBeVisible();
        await expect(reader.locator(".cm-latex-block-widget")).toBeVisible();
        await expect(reader).toContainText("Done from Vim. Reviewed.");

        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
    });
});
