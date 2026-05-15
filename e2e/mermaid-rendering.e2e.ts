/**
 * @module e2e/mermaid-rendering
 * @description Mermaid fenced code block rendering in edit and read mode.
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const MERMAID_NOTE_PATH = "test-resources/notes/mermaid-test.md";

async function waitForMockWorkbench(page: Page): Promise<string> {
    const mockVaultPath = await gotoMockVaultPage(page, "mermaid-rendering", MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    return mockVaultPath;
}

async function enableEditorVimMode(page: Page, mockVaultPath: string): Promise<void> {
    await page.evaluate(async (vaultPath) => {
        const configStoreModule = await import("/src/host/config/configStore.ts");
        await configStoreModule.syncConfigStateForVault(vaultPath, true);
        if (!configStoreModule.getConfigSnapshot().featureSettings.vimModeEnabled) {
            await configStoreModule.updateVimModeEnabled(true);
        }
    }, mockVaultPath);
}

async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

async function openMermaidNote(page: Page): Promise<void> {
    await page.getByTestId("activity-bar-item-files").click();
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${MERMAID_NOTE_PATH}']`).click();
    await page.getByRole("button", { name: "mermaid-test.md" }).first().waitFor({ state: "visible" });
}

async function waitForEditorFrames(page: Page, frameCount = 2): Promise<void> {
    await page.evaluate(async (nextFrameCount) => {
        for (let frameIndex = 0; frameIndex < nextFrameCount; frameIndex += 1) {
            await new Promise<void>((resolve) => {
                window.requestAnimationFrame(() => resolve());
            });
        }
    }, frameCount);
}

async function setEditorSelectionToLineNumber(page: Page, lineNumber: number): Promise<void> {
    await page.evaluate((targetLineNumber) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    focus: () => void;
                    dispatch: (spec: unknown) => void;
                    state: {
                        doc: {
                            line(lineNumber: number): { from: number };
                        };
                    };
                };
            };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found.");
        }

        view.focus();
        view.dispatch({
            selection: { anchor: view.state.doc.line(targetLineNumber).from },
            scrollIntoView: true,
        });
    }, lineNumber);
}

async function enterNormalModeAtLineNumber(page: Page, lineNumber: number): Promise<void> {
    await setEditorSelectionToLineNumber(page, lineNumber);
    await page.keyboard.press("Escape");
    await waitForEditorFrames(page, 2);
    await expect.poll(async () => getActiveEditorState(page).then((state) => state.vimInsertMode)).toBe(false);
}

async function getActiveEditorState(page: Page): Promise<{
    lineNumber: number;
    lineText: string;
    vimInsertMode: boolean | null;
}> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    cm?: {
                        state?: {
                            vim?: {
                                insertMode?: boolean;
                            };
                        };
                    };
                    state: {
                        doc: {
                            lineAt(pos: number): { number: number; text: string };
                        };
                        selection: { main: { head: number } };
                    };
                };
            };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found.");
        }

        const activeLine = view.state.doc.lineAt(view.state.selection.main.head);
        return {
            lineNumber: activeLine.number,
            lineText: activeLine.text,
            vimInsertMode: typeof view.cm?.state?.vim?.insertMode === "boolean"
                ? view.cm.state.vim.insertMode
                : null,
        };
    });
}

test.describe("mermaid rendering", () => {
    test("renders mermaid fences in edit mode and read mode", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openMermaidNote(page);

        const activeTab = page.locator(".layout-v2-tab-section__card--active");
        const editorWidget = activeTab.locator(".cm-mermaid-widget").first();
        const editorDiagram = editorWidget.locator("svg").first();
        await expect(editorDiagram).toBeVisible();
        await expect.poll(async () => editorWidget.evaluate((element) => {
            const style = window.getComputedStyle(element);
            return {
                background: style.backgroundColor,
                borderTopWidth: style.borderTopWidth,
                justifyContent: style.justifyContent,
            };
        })).toEqual({
            background: "rgba(0, 0, 0, 0)",
            borderTopWidth: "0px",
            justifyContent: "center",
        });
        await expect(activeTab.locator(".cm-line.cm-code-block-line", { hasText: "graph TD" })).toHaveCount(0);

        await activeTab.locator(".cm-tab-mode-toggle").click();

        const readDiagram = activeTab.locator(".cm-tab-reader .cm-mermaid-widget svg").first();
        await expect(readDiagram).toBeVisible();
    });

    test("anchors mermaid widgets and expands source through Vim movement", async ({ page }) => {
        const coordinateErrors: string[] = [];
        page.on("console", (message) => {
            if (message.type() !== "error") {
                return;
            }

            const text = message.text();
            if (text.includes("side.top") || text.includes("moveVertically")) {
                coordinateErrors.push(text);
            }
        });
        page.on("pageerror", (error) => {
            const text = error.stack ?? error.message;
            if (text.includes("side.top") || text.includes("moveVertically")) {
                coordinateErrors.push(text);
            }
        });

        const mockVaultPath = await waitForMockWorkbench(page);
        await enableEditorVimMode(page, mockVaultPath);
        await openMermaidNote(page);

        const activeTab = page.locator(".layout-v2-tab-section__card--active");
        const editorWidget = activeTab.locator(".cm-mermaid-widget").first();
        await expect(editorWidget.locator("svg").first()).toBeVisible();

        await expect.poll(async () => editorWidget.evaluate((element) => {
            const anchorLine = element.closest(".cm-line") as HTMLElement | null;
            const widgetRect = element.getBoundingClientRect();
            const anchorRect = anchorLine?.getBoundingClientRect();
            return {
                anchored: anchorLine?.classList.contains("cm-hidden-block-anchor-line") ?? false,
                anchorHasHeight: (anchorRect?.height ?? 0) > 0,
                widgetHasHeight: widgetRect.height > 0,
            };
        })).toEqual({
            anchored: true,
            anchorHasHeight: true,
            widgetHasHeight: true,
        });
        await expect(activeTab.locator(".cm-line.cm-code-block-line", { hasText: "graph TD" })).toHaveCount(0);

        await enterNormalModeAtLineNumber(page, 4);
        await page.keyboard.press("j");
        await waitForEditorFrames(page, 4);
        await expect.poll(async () => getActiveEditorState(page)).toMatchObject({
            lineNumber: 5,
            lineText: "```mermaid",
            vimInsertMode: false,
        });
        await expect(activeTab.locator(".cm-line.cm-code-block-line", { hasText: "graph TD" })).toBeVisible();

        await enterNormalModeAtLineNumber(page, 11);
        await page.keyboard.press("k");
        await waitForEditorFrames(page, 4);
        await expect.poll(async () => getActiveEditorState(page)).toMatchObject({
            lineNumber: 10,
            lineText: "```",
            vimInsertMode: false,
        });
        await expect(activeTab.locator(".cm-line.cm-code-block-line", { hasText: "graph TD" })).toBeVisible();
        expect(coordinateErrors).toEqual([]);
    });
});
