/**
 * @module e2e/code-block-latex-priority
 * @description CodeMirror 代码块与 LaTeX 行内渲染优先级回归测试。
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const CODE_BLOCK_NOTE_PATH = "test-resources/notes/code-block-test.md";

async function waitForMockWorkbench(page: Page): Promise<void> {
    await gotoMockVaultPage(page, "code-block-latex-priority", MOCK_PAGE);
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

async function openCodeBlockNote(page: Page): Promise<void> {
    await page.getByTestId("activity-bar-item-files").click();
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${CODE_BLOCK_NOTE_PATH}']`).click();
    await page.getByRole("button", { name: "code-block-test.md" }).first().waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
}

test.describe("code block syntax priority", () => {
    test("代码块内的 $...$ 不应渲染成 LaTeX widget", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openCodeBlockNote(page);

        const activeEditor = page.locator(".layout-v2-tab-section__card--active");
        const formulaCodeLine = activeEditor.locator(".cm-line.cm-code-block-line", {
            hasText: 'const formula = "$E=mc^2$";',
        });
        const markdownSyntaxCodeLine = activeEditor.locator(".cm-line.cm-code-block-line", {
            hasText: 'const markdownSyntax = "[[Target Note]] ==highlight== #tag";',
        });
        await expect(formulaCodeLine).toBeVisible();
        await expect(markdownSyntaxCodeLine).toBeVisible();
        await expect(activeEditor.locator(".cm-latex-inline-widget")).toHaveCount(0);
        await expect(markdownSyntaxCodeLine.locator(".cm-rendered-wikilink")).toHaveCount(0);
        await expect(markdownSyntaxCodeLine.locator(".cm-rendered-highlight")).toHaveCount(0);
        await expect(markdownSyntaxCodeLine.locator(".cm-rendered-tag")).toHaveCount(0);
    });

    test("代码块内的 wikilink 在 Cmd hover 时不应显示预览浮窗", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openCodeBlockNote(page);

        const activeEditor = page.locator(".layout-v2-tab-section__card--active");
        const markdownSyntaxCodeLine = activeEditor.locator(".cm-line.cm-code-block-line", {
            hasText: 'const markdownSyntax = "[[Target Note]] ==highlight== #tag";',
        });

        await expect(markdownSyntaxCodeLine).toBeVisible();
        await page.keyboard.down("Meta");
        await markdownSyntaxCodeLine.hover();
        await expect(page.locator(".cm-wikilink-preview-tooltip")).toHaveCount(0);
        await page.keyboard.up("Meta");
    });
});
