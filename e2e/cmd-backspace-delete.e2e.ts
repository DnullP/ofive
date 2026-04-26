/**
 * @module e2e/cmd-backspace-delete
 * @description Cmd+Backspace 删除当前文件/文件树选中项的 layout-v2 快捷键回归。
 * @dependencies
 *   - @playwright/test
 *   - web-mock/mock-tauri-test.html
 *
 * @example
 *   bunx playwright test e2e/cmd-backspace-delete.e2e.ts --reporter=line
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";

interface CodeMirrorContentElement extends HTMLElement {
    cmTile?: {
        view?: {
            focus: () => void;
            state: {
                doc: {
                    length: number;
                    toString(): string;
                };
            };
            dispatch: (spec: unknown) => void;
        };
    };
}

async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.addInitScript(() => {
        localStorage.clear();
    });
    await page.goto(MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab-main").first().waitFor({ state: "visible" });
}

async function expandMockNotes(page: Page): Promise<void> {
    if (await page.locator(".tree-item[data-tree-path='test-resources/notes']").count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

async function openGuideNote(page: Page): Promise<void> {
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${GUIDE_NOTE_PATH}']`).click();
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: "guide.md" }).waitFor({ state: "visible" });
}

async function setActiveEditorTextAndFocusEnd(page: Page, text: string): Promise<void> {
    await page.evaluate((nextText) => {
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
                anchor: nextText.length,
            },
        });
        view.focus();
    }, text);
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

test.describe("Cmd+Backspace delete shortcut", () => {
    test("editor focus should delete current file tab", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openGuideNote(page);

        await page.locator(".layout-v2-tab-section__card--active .cm-content").click();
        let dialogMessage = "";
        page.once("dialog", async (dialog) => {
            dialogMessage = dialog.message();
            await dialog.accept();
        });
        await page.keyboard.press("Meta+Backspace");

        expect(dialogMessage).toContain(GUIDE_NOTE_PATH);
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "guide.md" })).toHaveCount(0);
    });

    test("editor focus should keep current file tab when delete confirmation is cancelled", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openGuideNote(page);

        await page.locator(".layout-v2-tab-section__card--active .cm-content").click();
        let dialogMessage = "";
        page.once("dialog", async (dialog) => {
            dialogMessage = dialog.message();
            await dialog.dismiss();
        });
        await page.keyboard.press("Meta+Backspace");

        expect(dialogMessage).toContain(GUIDE_NOTE_PATH);
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "guide.md" })).toHaveCount(1);
    });

    test("file tree focus should route Cmd+Backspace to file tree delete command", async ({ page }) => {
        await waitForMockWorkbench(page);
        await expandMockNotes(page);

        const guideItem = page.locator(`.tree-item[data-tree-path='${GUIDE_NOTE_PATH}']`);
        await guideItem.click();
        await expect(guideItem).toBeFocused();

        const deleteCommandLog = page.waitForEvent("console", {
            predicate: (message) => message.text().includes("[MockApp] fileTree.deleteSelected"),
            timeout: 3000,
        });
        let dialogMessage = "";
        page.once("dialog", async (dialog) => {
            dialogMessage = dialog.message();
            await dialog.accept();
        });
        await page.keyboard.press("Meta+Backspace");

        expect(dialogMessage).toContain(GUIDE_NOTE_PATH);
        await deleteCommandLog;
    });

    test("editor focus should route Alt+Backspace to segmented delete command", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openGuideNote(page);
        await setActiveEditorTextAndFocusEnd(page, "Alpha beta");

        await page.keyboard.press("Alt+Backspace");

        await expect.poll(() => readActiveEditorText(page)).toBe("Alpha ");
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "guide.md" })).toHaveCount(1);
    });
});
