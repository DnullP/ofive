/**
 * @module e2e/editor-latex-shortcuts
 * @description 编辑器 LaTeX 快捷键回归测试。
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";

interface CodeMirrorContentElement extends HTMLElement {
    cmTile?: {
        view?: {
            focus: () => void;
            dispatch: (spec: unknown) => void;
            state: {
                doc: {
                    length: number;
                    toString(): string;
                };
            };
        };
    };
}

async function waitForMockWorkbench(page: Page): Promise<void> {
    await gotoMockVaultPage(page, "editor-latex-shortcuts", MOCK_PAGE);
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
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${GUIDE_NOTE_PATH}']`).click();
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: "guide.md" }).waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
}

async function setActiveEditorTextAndSelection(
    page: Page,
    text: string,
    anchor: number,
    head = anchor,
): Promise<void> {
    await page.evaluate(({ nextText, nextAnchor, nextHead }) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as CodeMirrorContentElement | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found on .cm-content");
        }

        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: nextText,
            },
            selection: {
                anchor: nextAnchor,
                head: nextHead,
            },
        });
        view.focus();
    }, { nextText: text, nextAnchor: anchor, nextHead: head });
}

async function readActiveEditorText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as CodeMirrorContentElement | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found on .cm-content");
        }

        return view.state.doc.toString();
    });
}

test.describe("editor LaTeX shortcuts", () => {
    test("Cmd+M wraps selection and Cmd+Shift+M inserts a block formula pair", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openGuideNote(page);

        await setActiveEditorTextAndSelection(page, "E=mc^2", 0, 6);
        await page.keyboard.press("Meta+M");
        await expect.poll(async () => readActiveEditorText(page)).toBe("$E=mc^2$");

        await setActiveEditorTextAndSelection(page, "", 0);
        await page.keyboard.press("Meta+Shift+M");
        await expect.poll(async () => readActiveEditorText(page)).toBe("$$\n\n$$");
    });
});
