import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const VIM_BOUNDARIES_NOTE_PATH = "test-resources/notes/vim-editing-boundaries.md";

interface ActiveEditorState {
    docText: string;
    head: number;
    lineNumber: number;
    lineText: string;
    vimInsertMode: boolean | null;
    vimVisualMode: boolean | null;
}

function visibleEditor(page: Page) {
    return page.locator(".cm-editor:visible").first();
}

async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await page.locator("[data-testid='main-dockview-host']").waitFor({ state: "visible" });
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
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    const fileName = relativePath.split("/").pop() ?? relativePath;
    await page.getByRole("button", { name: fileName }).first().waitFor({ state: "visible" });
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

async function getActiveEditorState(page: Page): Promise<ActiveEditorState> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    cm?: {
                        state?: {
                            vim?: {
                                insertMode?: boolean;
                                visualMode?: boolean;
                            };
                        };
                    };
                    state: {
                        doc: {
                            lineAt(pos: number): { number: number; text: string };
                            toString(): string;
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

        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        return {
            docText: view.state.doc.toString(),
            head,
            lineNumber: line.number,
            lineText: line.text,
            vimInsertMode: typeof view.cm?.state?.vim?.insertMode === "boolean"
                ? view.cm.state.vim.insertMode
                : null,
            vimVisualMode: typeof view.cm?.state?.vim?.visualMode === "boolean"
                ? view.cm.state.vim.visualMode
                : null,
        };
    });
}

async function setEditorSelectionToLineText(page: Page, lineText: string, offset = 0): Promise<void> {
    await page.evaluate(({ targetLineText, targetOffset }) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    focus: () => void;
                    dispatch: (spec: unknown) => void;
                    state: {
                        doc: {
                            line(lineNumber: number): { from: number; text: string };
                            lines: number;
                        };
                    };
                };
            };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found.");
        }

        for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
            const line = view.state.doc.line(lineNumber);
            if (line.text === targetLineText) {
                view.focus();
                view.dispatch({
                    selection: { anchor: line.from + targetOffset },
                    scrollIntoView: true,
                });
                return;
            }
        }

        throw new Error(`Line not found: ${targetLineText}`);
    }, { targetLineText: lineText, targetOffset: offset });
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
            selection: { anchor: needleIndex },
            scrollIntoView: true,
        });
    }, { nextMarkdown: markdown, needle: cursorNeedle });
    await waitForEditorFrames(page, 4);
}

async function dragSelectEditorTextRange(
    page: Page,
    startNeedle: string,
    endNeedle: string,
): Promise<void> {
    const coords = await page.evaluate(({ startText, endText }) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    coordsAtPos(position: number): { left: number; right: number; top: number; bottom: number } | null;
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
        const start = docText.indexOf(startText);
        const endStart = docText.indexOf(endText);
        if (start < 0 || endStart < 0) {
            throw new Error(`Selection anchors not found: ${startText} / ${endText}`);
        }

        const end = endStart + endText.length;
        const startCoords = view.coordsAtPos(start);
        const endCoords = view.coordsAtPos(end);
        if (!startCoords || !endCoords) {
            throw new Error("Selection coordinates not found.");
        }

        return {
            start: {
                x: startCoords.left + 2,
                y: startCoords.top + Math.max(4, (startCoords.bottom - startCoords.top) / 2),
            },
            end: {
                x: endCoords.right - 2,
                y: endCoords.top + Math.max(4, (endCoords.bottom - endCoords.top) / 2),
            },
        };
    }, { startText: startNeedle, endText: endNeedle });

    await page.mouse.move(coords.start.x, coords.start.y);
    await page.mouse.down();
    await page.mouse.move(coords.end.x, coords.end.y, { steps: 20 });
    await waitForEditorFrames(page, 2);
    await page.mouse.up();
    await waitForEditorFrames(page, 2);
}

async function readMouseSelectionRenderState(page: Page): Promise<{
    cmSelectionEmpty: boolean;
    cmSelectionBackgroundCount: number;
    nativeSelectionText: string;
    nativeRangeCount: number;
    nativeSelectionRectCount: number;
    vimVisualMode: boolean | null;
}> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    cm?: {
                        state?: {
                            vim?: {
                                visualMode?: boolean;
                            };
                        };
                    };
                    state: {
                        selection: {
                            main: {
                                empty: boolean;
                            };
                        };
                    };
                };
            };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found.");
        }

        const nativeSelection = window.getSelection();
        return {
            cmSelectionEmpty: view.state.selection.main.empty,
            cmSelectionBackgroundCount: document.querySelectorAll(
                ".layout-v2-tab-section__card--active .cm-selectionBackground",
            ).length,
            nativeSelectionText: nativeSelection?.toString() ?? "",
            nativeRangeCount: nativeSelection?.rangeCount ?? 0,
            nativeSelectionRectCount: nativeSelection && nativeSelection.rangeCount > 0
                ? nativeSelection.getRangeAt(0).getClientRects().length
                : 0,
            vimVisualMode: typeof view.cm?.state?.vim?.visualMode === "boolean"
                ? view.cm.state.vim.visualMode
                : null,
        };
    });
}

async function enterNormalModeAtLine(page: Page, lineText: string, offset = 0): Promise<void> {
    await setEditorSelectionToLineText(page, lineText, offset);
    await page.keyboard.press("Escape");
    await waitForEditorFrames(page, 2);
    const state = await getActiveEditorState(page);
    expect(state.vimInsertMode).toBe(false);
}

async function commitNormalModeText(page: Page, text: string): Promise<void> {
    await page.keyboard.insertText(text);
    await waitForEditorFrames(page, 2);
}

async function dispatchComposingLetterKeydown(page: Page, code: string): Promise<boolean> {
    return page.evaluate((physicalCode) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as HTMLElement | null;
        if (!content) {
            throw new Error("Active editor content not found.");
        }

        const event = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Process",
            code: physicalCode,
            keyCode: 229,
            which: 229,
            isComposing: true,
        });

        content.dispatchEvent(event);
        return event.defaultPrevented;
    }, code);
}

test.describe("vim editing boundaries", () => {
    test.beforeEach(async ({ page }) => {
        await waitForMockWorkbench(page);
        await enableEditorVimMode(page);
        await openMockNote(page, VIM_BOUNDARIES_NOTE_PATH);
    });

    test("insert commands should write at cursor, after cursor, end of line, and new line boundaries", async ({ page }) => {
        await enterNormalModeAtLine(page, "alpha beta gamma", 0);

        await page.keyboard.press("i");
        await page.keyboard.type("I-");
        await page.keyboard.press("Escape");
        await waitForEditorFrames(page);
        expect((await getActiveEditorState(page)).docText).toContain("I-alpha beta gamma");

        await enterNormalModeAtLine(page, "I-alpha beta gamma", 0);
        await page.keyboard.press("a");
        await page.keyboard.type("-A");
        await page.keyboard.press("Escape");
        await waitForEditorFrames(page);
        expect((await getActiveEditorState(page)).docText).toContain("I-A-alpha beta gamma");

        await enterNormalModeAtLine(page, "I-A-alpha beta gamma", "I-A-alpha beta gamma".length - 1);
        await page.keyboard.press("Shift+A");
        await page.keyboard.type("-END");
        await page.keyboard.press("Escape");
        await waitForEditorFrames(page);
        expect((await getActiveEditorState(page)).docText).toContain("I-A-alpha beta gamma-END");

        await enterNormalModeAtLine(page, "I-A-alpha beta gamma-END", 0);
        await page.keyboard.press("o");
        await page.keyboard.type("opened below");
        await page.keyboard.press("Escape");
        await waitForEditorFrames(page);
        expect((await getActiveEditorState(page)).docText).toContain("I-A-alpha beta gamma-END\nopened below\ndelta epsilon zeta");
    });

    test("normal-mode delete, replace, and word delete should edit exact text ranges", async ({ page }) => {
        await enterNormalModeAtLine(page, "delta epsilon zeta", 0);

        await page.keyboard.press("x");
        await waitForEditorFrames(page);
        expect((await getActiveEditorState(page)).docText).toContain("elta epsilon zeta");

        await enterNormalModeAtLine(page, "elta epsilon zeta", 0);
        await page.keyboard.press("r");
        await page.keyboard.press("D");
        await waitForEditorFrames(page);
        expect((await getActiveEditorState(page)).docText).toContain("Dlta epsilon zeta");

        await enterNormalModeAtLine(page, "Dlta epsilon zeta", 5);
        await page.keyboard.press("d");
        await page.keyboard.press("w");
        await waitForEditorFrames(page);
        expect((await getActiveEditorState(page)).docText).toContain("Dlta zeta");
    });

    test("word delete should respect mixed Chinese and English Vim word boundaries", async ({ page }) => {
        await enterNormalModeAtLine(page, "中文English mixed words line1", 0);

        await page.keyboard.press("d");
        await page.keyboard.press("w");
        await waitForEditorFrames(page);
        const afterFirstChineseDelete = await getActiveEditorState(page);

        expect(afterFirstChineseDelete.docText).toContain("English mixed words line1");
        expect(afterFirstChineseDelete.docText).not.toContain("中文English mixed words line1");

        await enterNormalModeAtLine(page, "English mixed words line2", 0);
        await page.keyboard.press("d");
        await page.keyboard.press("w");
        await waitForEditorFrames(page);
        const afterSecondChineseDelete = await getActiveEditorState(page);

        expect(afterSecondChineseDelete.docText).toContain("mixed words line2");
        expect(afterSecondChineseDelete.docText).not.toContain("English mixed words line2");

        await enterNormalModeAtLine(page, "mixed words line3", 0);
        await page.keyboard.press("d");
        await page.keyboard.press("w");
        await waitForEditorFrames(page);
        const afterEnglishDelete = await getActiveEditorState(page);

        expect(afterEnglishDelete.docText).toContain("words line3");
        expect(afterEnglishDelete.docText).not.toContain("mixed words line3");
    });

    test("normal mode should not insert plain text when IME commits letters", async ({ page }) => {
        await enterNormalModeAtLine(page, "alpha beta gamma", 0);
        const before = await getActiveEditorState(page);

        await commitNormalModeText(page, "ni");

        const after = await getActiveEditorState(page);
        expect(after.docText).toBe(before.docText);
        expect(after.head).toBe(before.head);
        expect(after.vimInsertMode).toBe(false);
    });

    test("normal mode should consume composing letter keydown before IME accumulates pinyin", async ({ page }) => {
        await enterNormalModeAtLine(page, "alpha beta gamma", 0);
        const before = await getActiveEditorState(page);

        const defaultPrevented = await dispatchComposingLetterKeydown(page, "KeyJ");
        await waitForEditorFrames(page, 2);

        const after = await getActiveEditorState(page);
        expect(defaultPrevented).toBe(true);
        expect(after.docText).toBe(before.docText);
        expect(after.lineNumber).toBe(before.lineNumber + 1);
        expect(after.vimInsertMode).toBe(false);
    });

    test("mouse selection in Vim mode should use native selection without rectangular CodeMirror overpaint", async ({ page }) => {
        const selectionProbe = [
            "# Selection Probe",
            "",
            "静态贝叶斯博弈（Static Bayesian Game）是指参与者在拥有各自私有类型信息的情况下同时选择行动，",
            "且每个参与者只知道其他参与者类型的概率分布，而不知道其真实类型的不完全信息博弈。",
            "",
            "tail",
        ].join("\n");

        await replaceActiveEditorDoc(page, selectionProbe, "静态贝叶斯博弈");
        await page.keyboard.press("Escape");
        await waitForEditorFrames(page, 2);

        await dragSelectEditorTextRange(page, "静态贝叶斯博弈", "概率分布");
        const selectionState = await readMouseSelectionRenderState(page);

        expect(selectionState.cmSelectionEmpty).toBe(false);
        expect(selectionState.vimVisualMode).toBe(true);
        expect(selectionState.nativeSelectionText).toContain("静态贝叶斯博弈");
        expect(selectionState.nativeSelectionText).toContain("概率分布");
        expect(selectionState.nativeRangeCount).toBe(1);
        expect(selectionState.nativeSelectionRectCount).toBeGreaterThan(0);
        expect(selectionState.cmSelectionBackgroundCount).toBe(0);
    });

    test("undo and redo should preserve Vim mode and restore document content", async ({ page }) => {
        await enterNormalModeAtLine(page, "syntax **bold** `inline code` [[guide]] tail", 0);
        const initialState = await getActiveEditorState(page);

        await page.keyboard.press("Shift+A");
        await page.keyboard.type(" added");
        await page.keyboard.press("Escape");
        await waitForEditorFrames(page);
        const editedState = await getActiveEditorState(page);
        expect(editedState.docText).toContain("syntax **bold** `inline code` [[guide]] tail added");
        expect(editedState.vimInsertMode).toBe(false);

        await page.keyboard.press("u");
        await waitForEditorFrames(page);
        const undoneState = await getActiveEditorState(page);
        expect(undoneState.docText).toBe(initialState.docText);
        expect(undoneState.vimInsertMode).toBe(false);

        await page.keyboard.press("Control+r");
        await waitForEditorFrames(page);
        const redoneState = await getActiveEditorState(page);
        expect(redoneState.docText).toBe(editedState.docText);
        expect(redoneState.vimInsertMode).toBe(false);
    });

    test("visual line delete should remove complete selected lines without touching neighbors", async ({ page }) => {
        await enterNormalModeAtLine(page, "visual-one", 0);

        await page.keyboard.press("Shift+V");
        await waitForEditorFrames(page);
        expect((await getActiveEditorState(page)).vimVisualMode).toBe(true);

        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await page.keyboard.press("d");
        await waitForEditorFrames(page, 4);

        const finalState = await getActiveEditorState(page);
        expect(finalState.docText).not.toContain("visual-one");
        expect(finalState.docText).not.toContain("visual-two");
        expect(finalState.docText).toContain("mixed words line3\nvisual-three");
        expect(finalState.vimInsertMode).toBe(false);
    });
});
