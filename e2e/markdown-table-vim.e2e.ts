import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";
const TABLE_NOTE_PATH = "test-resources/notes/table-editor.md";
const TABLE_BOUNDARY_NOTE_PATH = "test-resources/notes/table-vim-boundary.md";
const INLINE_CODE_WIKILINK_NOTE_PATH = "test-resources/notes/vim-inline-code-wikilink.md";

function visibleEditor(page: Page) {
    return page.locator(".cm-editor:visible").first();
}

function visibleTableStatus(page: Page) {
    return page.locator(".mtv-status-current:visible").first();
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

async function clickEditorLine(page: Page, lineIndex: number): Promise<void> {
    await visibleEditor(page).locator(".cm-line").nth(lineIndex).click();
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

function activeTableNavigationCell(page: Page) {
    return page.locator("[data-vim-nav-active='true']:visible").first();
}

async function getActiveEditorState(page: Page): Promise<{
    docText: string;
    head: number;
    lineNumber: number;
    vimInsertMode: boolean | null;
    vimVisualMode: boolean | null;
}> {
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
                            lineAt(pos: number): { number: number };
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
        return {
            docText: view.state.doc.toString(),
            head: view.state.selection.main.head,
            lineNumber: view.state.doc.lineAt(view.state.selection.main.head).number,
            vimInsertMode: typeof view.cm?.state?.vim?.insertMode === "boolean"
                ? view.cm.state.vim.insertMode
                : null,
            vimVisualMode: typeof view.cm?.state?.vim?.visualMode === "boolean"
                ? view.cm.state.vim.visualMode
                : null,
        };
    });
}

async function dispatchEditorCompositionEvent(page: Page, eventName: "compositionstart" | "compositionend", data: string): Promise<void> {
    await page.evaluate(({ eventName: name, data: eventData }) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: { view?: { dom: HTMLElement } };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found");
        }

        view.dom.dispatchEvent(new CompositionEvent(name, {
            bubbles: true,
            data: eventData,
        }));
    }, { eventName, data });
}

async function commitImeTextWithChrome(page: Page, text: string): Promise<void> {
    const client = await page.context().newCDPSession(page);
    try {
        await client.send("Input.imeSetComposition", {
            text,
            selectionStart: text.length,
            selectionEnd: text.length,
        });
        await waitForEditorFrames(page, 2);
        await client.send("Input.insertText", { text });
    } finally {
        await client.detach();
    }
}

async function setImeCompositionWithChrome(page: Page, text: string): Promise<void> {
    const client = await page.context().newCDPSession(page);
    try {
        await client.send("Input.imeSetComposition", {
            text,
            selectionStart: text.length,
            selectionEnd: text.length,
        });
    } finally {
        await client.detach();
    }
}

async function setEditorSelectionToTextEnd(page: Page, text: string): Promise<void> {
    await page.evaluate((needle) => {
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
        const index = docText.indexOf(needle);
        if (index < 0) {
            throw new Error(`Needle not found: ${needle}`);
        }

        const anchor = index + needle.length;
        view.focus();
        view.dispatch({
            selection: { anchor },
            scrollIntoView: true,
        });
    }, text);
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
}

async function simulateImeBackspaceSelectionDriftToLineStart(page: Page): Promise<void> {
    await page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    contentDOM?: HTMLElement;
                    dom: HTMLElement;
                    dispatch: (spec: unknown) => void;
                    focus: () => void;
                    state: {
                        doc: {
                            lineAt(pos: number): { from: number };
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

        view.focus();
        const eventTarget = view.contentDOM ?? content;

        eventTarget.dispatchEvent(new CompositionEvent("compositionstart", {
            bubbles: true,
            data: "d",
        }));
        const inputEvent = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            data: null,
            inputType: "deleteCompositionText",
            isComposing: true,
        });
        Object.defineProperty(inputEvent, "inputType", { value: "deleteCompositionText" });
        eventTarget.dispatchEvent(inputEvent);

        const line = view.state.doc.lineAt(view.state.selection.main.head);
        view.dispatch({
            selection: { anchor: line.from },
            scrollIntoView: true,
        });
    });
}

test.describe("markdown table vim regression", () => {
    test.beforeEach(async ({ page }) => {
        await waitForMockWorkbench(page);
        await enableEditorVimMode(page);
        await openMockNote(page, TABLE_NOTE_PATH);
    });

    test("j/k should enter table from the nearest visible body lines using first and last row anchors", async ({ page }) => {
        await clickEditorLine(page, 2);
        await page.keyboard.press("Escape");
        await page.keyboard.press("j");
        await waitForEditorFrames(page);

        const firstCell = activeTableNavigationCell(page);
        await expect(firstCell).toBeFocused();
        await expect(firstCell).toHaveText("**Bold**");
        await expect(visibleTableStatus(page)).toContainText(/Selected: Row 1, Column 1|第 1 行第 1 列/u);

        await clickEditorLine(page, 8);
        await page.keyboard.press("Escape");
        await page.keyboard.press("k");
        await waitForEditorFrames(page);

        const lastRowEntry = activeTableNavigationCell(page);
        await expect(lastRowEntry).toBeFocused();
        await expect(lastRowEntry).toHaveText("`inline code`");
        await expect(visibleTableStatus(page)).toContainText(/Selected: Row 2, Column 1|第 2 行第 1 列/u);
    });

    test("Enter should enter editing and Escape or Enter should return to table navigation", async ({ page }) => {
        await clickEditorLine(page, 2);
        await page.keyboard.press("Escape");
        await page.keyboard.press("j");
        await waitForEditorFrames(page);

        const navigationCell = activeTableNavigationCell(page);
        await expect(navigationCell).toBeFocused();
        await expect(navigationCell).toHaveText("**Bold**");

        const input = page.locator(".mtv-cell-input:visible").first();

        await page.keyboard.press("Enter");
        await waitForEditorFrames(page);
        await expect(input).toBeFocused();
        await expect(input).toHaveValue("**Bold**");

        await page.keyboard.press("Escape");
        await waitForEditorFrames(page);
        await expect(navigationCell).toBeFocused();
        await expect(navigationCell).toHaveText("**Bold**");

        await page.keyboard.press("Enter");
        await waitForEditorFrames(page);
        await expect(input).toBeFocused();

        await page.keyboard.press("Enter");
        await waitForEditorFrames(page);
        await expect(navigationCell).toBeFocused();
        await expect(navigationCell).toHaveText("**Bold**");
    });

    test("h/j/k/l should navigate inside the custom three-column table without falling back to editor-body handoff", async ({ page }) => {
        await openMockNote(page, TABLE_BOUNDARY_NOTE_PATH);
        await clickEditorLine(page, 2);
        await page.keyboard.press("Escape");
        await page.keyboard.press("j");
        await waitForEditorFrames(page);

        const activeCell = activeTableNavigationCell(page);
        await expect(activeCell).toBeFocused();
        await expect(activeCell).toHaveText("布局骨架层");

        await page.keyboard.press("l");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("决定区域如何切分和嵌套");

        await page.keyboard.press("l");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("`SectionNode`, section tree");

        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("`ActivityBar`, `PanelSection`, `TabSection`");

        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("`VSCodeWorkbench`, `Workbench*Definition`, host adapters");

        await page.keyboard.press("h");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("把业务数据投影到布局引擎");

        await page.keyboard.press("k");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("决定不同区域里展示什么容器");

        await page.keyboard.press("k");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("决定区域如何切分和嵌套");
    });

    test("IME text j should follow Vim command priority in editor body and widget handoffs", async ({ page }) => {
        await openMockNote(page, TABLE_BOUNDARY_NOTE_PATH);
        await clickEditorLine(page, 2);
        await page.keyboard.press("Escape");

        const initialState = await getActiveEditorState(page);

        await page.keyboard.insertText("j");
        await waitForEditorFrames(page, 4);

        const firstCell = activeTableNavigationCell(page);
        await expect(firstCell).toBeFocused();
        await expect(firstCell).toHaveText("布局骨架层");

        const afterHandoffState = await getActiveEditorState(page);

        expect(afterHandoffState.docText).toBe(initialState.docText);

        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await expect(firstCell).toHaveText("工作台部件层");

        await page.keyboard.press("k");
        await waitForEditorFrames(page);
        await expect(firstCell).toHaveText("布局骨架层");

        await page.keyboard.press("Enter");
        const input = page.locator(".mtv-cell-input:visible").first();
        await expect(input).toBeFocused();
        await input.pressSequentially("输入");
        await expect(input).toHaveValue("布局骨架层输入");

        await page.keyboard.press("Escape");
        await waitForEditorFrames(page, 4);
        await expect(firstCell).toBeFocused();
        await expect(firstCell).toHaveText("布局骨架层输入");
    });

    test("repeated IME text j should move through editor body without inserting text", async ({ page }) => {
        await openMockNote(page, GUIDE_NOTE_PATH);
        await clickEditorLine(page, 1);
        await page.keyboard.press("Escape");

        const initialState = await getActiveEditorState(page);

        await page.keyboard.insertText("j");
        await page.keyboard.insertText("j");
        await page.keyboard.insertText("j");
        await waitForEditorFrames(page, 4);

        const afterMovesState = await getActiveEditorState(page);

        expect(afterMovesState.docText).toBe(initialState.docText);
        expect(afterMovesState.lineNumber).toBeGreaterThan(initialState.lineNumber);
    });

    test("IME composition d in Vim insert mode should not replace inline-code project wikilink at its right boundary", async ({ page }) => {
        await openMockNote(page, INLINE_CODE_WIKILINK_NOTE_PATH);
        await setEditorSelectionToTextEnd(page, "`[[projectName:/path/to/file:42]]`");
        await page.keyboard.press("Escape");
        await page.keyboard.press("i");
        await waitForEditorFrames(page, 4);

        const initialState = await getActiveEditorState(page);
        expect(initialState.vimInsertMode).toBe(true);
        expect(initialState.docText).toContain("`[[projectName:/path/to/file:42]]`");
        const beforeCursor = initialState.docText.slice(0, initialState.head);
        const afterCursor = initialState.docText.slice(initialState.head);

        await dispatchEditorCompositionEvent(page, "compositionstart", "d");
        await page.keyboard.insertText("d");
        await dispatchEditorCompositionEvent(page, "compositionend", "d");
        await waitForEditorFrames(page, 4);

        const afterInputState = await getActiveEditorState(page);

        expect(afterInputState.docText).toContain("`[[projectName:/path/to/file:42]]`");
        expect(afterInputState.docText).toBe(`${beforeCursor}d${afterCursor}`);
    });

    test("IME composition d at the end of a list line should not replace inline-code project wikilink", async ({ page }) => {
        await openMockNote(page, INLINE_CODE_WIKILINK_NOTE_PATH);
        await setEditorSelectionToTextEnd(page, "- 我可以创建特殊的wikilink `[[projectName:/path/to/file:42]]` 来连");
        await page.keyboard.press("Escape");
        await page.keyboard.press("i");
        await waitForEditorFrames(page, 4);

        const initialState = await getActiveEditorState(page);
        expect(initialState.vimInsertMode).toBe(true);
        const beforeCursor = initialState.docText.slice(0, initialState.head);
        const afterCursor = initialState.docText.slice(initialState.head);

        await dispatchEditorCompositionEvent(page, "compositionstart", "d");
        await page.keyboard.insertText("d");
        await dispatchEditorCompositionEvent(page, "compositionend", "d");
        await waitForEditorFrames(page, 4);

        const afterInputState = await getActiveEditorState(page);

        expect(afterInputState.docText).toContain("`[[projectName:/path/to/file:42]]`");
        expect(afterInputState.docText).toBe(`${beforeCursor}d${afterCursor}`);
    });

    test("Chrome IME d at the end of a user list line should keep inline-code project wikilink", async ({ page }) => {
        const userLine = "- 我可以创建特殊的wikilink `[[projectName:/path/to/file:linenumber]]` 来";
        await openMockNote(page, INLINE_CODE_WIKILINK_NOTE_PATH);
        await replaceActiveEditorDoc(page, [userLine, "", "---"].join("\n"), userLine);
        await page.keyboard.press("Escape");
        await page.keyboard.press("i");
        await waitForEditorFrames(page, 4);

        const initialState = await getActiveEditorState(page);
        expect(initialState.vimInsertMode).toBe(true);
        const beforeCursor = initialState.docText.slice(0, initialState.head);
        const afterCursor = initialState.docText.slice(initialState.head);

        await commitImeTextWithChrome(page, "d");
        await waitForEditorFrames(page, 4);

        const afterInputState = await getActiveEditorState(page);

        expect(afterInputState.docText).toContain("`[[projectName:/path/to/file:linenumber]]`");
        expect(afterInputState.docText).toBe(`${beforeCursor}d${afterCursor}`);
    });

    test("Chrome IME d after Backspace should stay at the user list line end", async ({ page }) => {
        const userLine = "- 我可以创建特殊的wikilink `[[projectName:/path/to/file:linenumber]]` 来";
        await openMockNote(page, INLINE_CODE_WIKILINK_NOTE_PATH);
        await replaceActiveEditorDoc(page, [userLine, "", "---"].join("\n"), userLine);
        await page.keyboard.press("Escape");
        await page.keyboard.press("i");
        await waitForEditorFrames(page, 4);

        const initialState = await getActiveEditorState(page);
        expect(initialState.vimInsertMode).toBe(true);
        const beforeCursor = initialState.docText.slice(0, initialState.head);
        const afterCursor = initialState.docText.slice(initialState.head);

        await commitImeTextWithChrome(page, "d");
        await waitForEditorFrames(page, 4);
        await page.keyboard.press("Backspace");
        await waitForEditorFrames(page, 4);
        await commitImeTextWithChrome(page, "d");
        await waitForEditorFrames(page, 4);

        const afterInputState = await getActiveEditorState(page);

        expect(afterInputState.vimInsertMode).toBe(true);
        expect(afterInputState.head).toBe(initialState.head + 1);
        expect(afterInputState.docText).toBe(`${beforeCursor}d${afterCursor}`);
    });

    test("Chrome IME preedit d after Backspace should stay at the user list line end", async ({ page }) => {
        const userLine = "- 我可以创建特殊的wikilink `[[projectName:/path/to/file:linenumber]]` 来";
        await openMockNote(page, INLINE_CODE_WIKILINK_NOTE_PATH);
        await replaceActiveEditorDoc(page, [userLine, "", "---"].join("\n"), userLine);
        await page.keyboard.press("Escape");
        await page.keyboard.press("i");
        await waitForEditorFrames(page, 4);

        const initialState = await getActiveEditorState(page);
        expect(initialState.vimInsertMode).toBe(true);
        const beforeCursor = initialState.docText.slice(0, initialState.head);
        const afterCursor = initialState.docText.slice(initialState.head);

        await setImeCompositionWithChrome(page, "d");
        await waitForEditorFrames(page, 4);
        await page.keyboard.press("Backspace");
        await waitForEditorFrames(page, 4);
        await commitImeTextWithChrome(page, "d");
        await waitForEditorFrames(page, 4);

        const afterInputState = await getActiveEditorState(page);

        expect(afterInputState.vimInsertMode).toBe(true);
        expect(afterInputState.head).toBe(initialState.head + 1);
        expect(afterInputState.docText).toBe(`${beforeCursor}d${afterCursor}`);
    });

    test("IME Backspace selection drift should be restored before the next d input", async ({ page }) => {
        const userLine = "- 我可以创建特殊的wikilink `[[projectName:/path/to/file:linenumber]]` 来";
        await openMockNote(page, INLINE_CODE_WIKILINK_NOTE_PATH);
        await replaceActiveEditorDoc(page, [userLine, "", "---"].join("\n"), userLine);
        await page.keyboard.press("Escape");
        await page.keyboard.press("i");
        await waitForEditorFrames(page, 4);

        const initialState = await getActiveEditorState(page);
        expect(initialState.vimInsertMode).toBe(true);
        const beforeCursor = initialState.docText.slice(0, initialState.head);
        const afterCursor = initialState.docText.slice(initialState.head);

        await simulateImeBackspaceSelectionDriftToLineStart(page);
        await waitForEditorFrames(page, 4);

        const afterBackspaceState = await getActiveEditorState(page);
        expect(afterBackspaceState.vimInsertMode).toBe(true);
        expect(afterBackspaceState.head).toBe(initialState.head);

        await commitImeTextWithChrome(page, "d");
        await waitForEditorFrames(page, 4);

        const afterInputState = await getActiveEditorState(page);

        expect(afterInputState.vimInsertMode).toBe(true);
        expect(afterInputState.head).toBe(initialState.head + 1);
        expect(afterInputState.docText).toBe(`${beforeCursor}d${afterCursor}`);
    });

    test("modified cell should return to the same navigation target after Escape or Enter", async ({ page }) => {
        await openMockNote(page, TABLE_BOUNDARY_NOTE_PATH);
        await clickEditorLine(page, 2);
        await page.keyboard.press("Escape");
        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await page.keyboard.press("l");
        await waitForEditorFrames(page);
        await page.keyboard.press("j");
        await waitForEditorFrames(page);

        const activeCell = activeTableNavigationCell(page);
        const input = page.locator(".mtv-cell-input:visible").first();

        await expect(activeCell).toHaveText("决定不同区域里展示什么容器");
        await expect(visibleTableStatus(page)).toContainText(/Selected: Row 2, Column 2|第 2 行第 2 列/u);

        await page.keyboard.press("Enter");
        await waitForEditorFrames(page);
        await expect(input).toBeFocused();
        await input.pressSequentially("X");
        await waitForEditorFrames(page);
        await page.keyboard.press("Escape");
        await waitForEditorFrames(page, 4);
        await expect(activeCell).toBeFocused();
        await expect(activeCell).toHaveText("决定不同区域里展示什么容器X");
        await expect(visibleTableStatus(page)).toContainText(/Selected: Row 2, Column 2|第 2 行第 2 列/u);

        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("把业务数据投影到布局引擎");
        await expect(visibleTableStatus(page)).toContainText(/Selected: Row 3, Column 2|第 3 行第 2 列/u);

        await page.keyboard.press("k");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("决定不同区域里展示什么容器X");

        await page.keyboard.press("k");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("决定区域如何切分和嵌套");

        await page.keyboard.press("Enter");
        await waitForEditorFrames(page);
        await expect(input).toBeFocused();
        await input.pressSequentially("Y");
        await waitForEditorFrames(page);
        await page.keyboard.press("Enter");
        await waitForEditorFrames(page, 4);
        await expect(activeCell).toBeFocused();
        await expect(activeCell).toHaveText("决定区域如何切分和嵌套Y");
        await expect(visibleTableStatus(page)).toContainText(/Selected: Row 1, Column 2|第 1 行第 2 列/u);

        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("决定不同区域里展示什么容器X");
        await expect(visibleTableStatus(page)).toContainText(/Selected: Row 2, Column 2|第 2 行第 2 列/u);
    });
});
