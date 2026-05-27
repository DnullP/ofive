import { expect, test, type Locator, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";
const TABLE_NOTE_PATH = "test-resources/notes/table-editor.md";
const TABLE_BOUNDARY_NOTE_PATH = "test-resources/notes/table-vim-boundary.md";
const INLINE_CODE_WIKILINK_NOTE_PATH = "test-resources/notes/vim-inline-code-wikilink.md";

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

async function disableEditorVimMode(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const configStoreModule = await import("/src/host/config/configStore.ts");
        await configStoreModule.syncConfigStateForVault("/mock/notes", true);
        if (configStoreModule.getConfigSnapshot().featureSettings.vimModeEnabled) {
            await configStoreModule.updateVimModeEnabled(false);
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

async function dispatchCmdHoverOnLocator(page: Page, locator: Locator): Promise<void> {
    await locator.evaluate((target) => {
        const rect = target.getBoundingClientRect();
        target.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + Math.max(1, rect.width / 2),
            clientY: rect.top + Math.max(1, rect.height / 2),
            metaKey: true,
            ctrlKey: true,
        }));
    });
    await waitForEditorFrames(page, 2);
}

async function hideWikiLinkPreview(page: Page): Promise<void> {
    await page.keyboard.up("Meta").catch(() => undefined);
    await page.mouse.move(4, 4);
    await page.evaluate(() => {
        document.querySelectorAll(".cm-wikilink-preview-tooltip").forEach((element) => element.remove());
    });
    await waitForEditorFrames(page, 2);
}

function activeTableNavigationCell(page: Page) {
    return page.locator("[data-vim-nav-active='true']:visible").first();
}

async function expectActiveTableCellPosition(
    page: Page,
    section: "header" | "body",
    rowIndex: number,
    columnIndex: number,
): Promise<void> {
    const activeCell = activeTableNavigationCell(page);
    await expect(activeCell).toHaveAttribute("data-markdown-table-section", section);
    await expect(activeCell).toHaveAttribute("data-markdown-table-row-index", String(rowIndex));
    await expect(activeCell).toHaveAttribute("data-markdown-table-column-index", String(columnIndex));
}

async function dragLocatorToLocator(
    page: Page,
    source: ReturnType<Page["locator"]>,
    target: ReturnType<Page["locator"]>,
): Promise<void> {
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
    await page.mouse.up();
}

async function dragLocatorBy(
    page: Page,
    locator: ReturnType<Page["locator"]>,
    deltaX: number,
    deltaY: number,
): Promise<void> {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
    await page.mouse.up();
}

async function getActiveEditorState(page: Page): Promise<{
    docText: string;
    head: number;
    lineText: string;
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
        const activeLine = view.state.doc.lineAt(view.state.selection.main.head);
        return {
            docText: view.state.doc.toString(),
            head: view.state.selection.main.head,
            lineText: activeLine.text,
            lineNumber: activeLine.number,
            vimInsertMode: typeof view.cm?.state?.vim?.insertMode === "boolean"
                ? view.cm.state.vim.insertMode
                : null,
            vimVisualMode: typeof view.cm?.state?.vim?.visualMode === "boolean"
                ? view.cm.state.vim.visualMode
                : null,
        };
    });
}

async function closeMockNoteTab(page: Page, tabTitle: string): Promise<void> {
    await page.getByRole("button", { name: `Close ${tabTitle}`, exact: true }).first().click();
    await waitForEditorFrames(page, 2);
}

async function flushAutoSave(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const autoSaveModule = await import("/src/host/editor/autoSaveService.ts");
        await autoSaveModule.flushAutoSave();
    });
}

async function readBrowserMockMarkdownContent(page: Page, relativePath: string): Promise<string> {
    return page.evaluate(async (path) => {
        const fixturesModule = await import("/src/api/vaultBrowserMockFixtures.ts");
        const contents = await fixturesModule.loadBrowserMockMarkdownContents();
        return contents[path] ?? "";
    }, relativePath);
}

async function expectActiveEditorLine(page: Page, lineNumber: number, lineText: string): Promise<void> {
    await expect.poll(async () => {
        const state = await getActiveEditorState(page);
        return {
            lineNumber: state.lineNumber,
            lineText: state.lineText,
        };
    }).toEqual({ lineNumber, lineText });
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

async function insertTextWithChrome(page: Page, text: string): Promise<void> {
    const client = await page.context().newCDPSession(page);
    try {
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

async function waitForActiveEditorVimAttached(page: Page): Promise<void> {
    await expect.poll(async () => {
        const state = await getActiveEditorState(page);
        return state.vimInsertMode === null ? "missing" : "attached";
    }).toBe("attached");
}

async function enterVimInsertModeAtCurrentSelection(page: Page): Promise<void> {
    await waitForActiveEditorVimAttached(page);
    await page.keyboard.press("Escape");
    await waitForEditorFrames(page, 2);
    await expect.poll(async () => {
        const state = await getActiveEditorState(page);
        return state.vimInsertMode;
    }).toBe(false);
    await page.keyboard.press("i");
    await waitForEditorFrames(page, 4);
    await expect.poll(async () => {
        const state = await getActiveEditorState(page);
        return state.vimInsertMode;
    }).toBe(true);
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
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
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

async function simulateImeInsertSelectionDriftToLineStart(page: Page, data: string): Promise<void> {
    await page.evaluate((compositionData) => {
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
            data: compositionData,
        }));

        const line = view.state.doc.lineAt(view.state.selection.main.head);
        view.dispatch({
            selection: { anchor: line.from },
            scrollIntoView: true,
        });

        const inputEvent = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            data: compositionData,
            inputType: "insertCompositionText",
            isComposing: true,
        });
        Object.defineProperty(inputEvent, "inputType", { value: "insertCompositionText" });
        eventTarget.dispatchEvent(inputEvent);
    }, data);
}

async function readActiveListLineRenderState(page: Page): Promise<{
    hasListSourceLine: boolean;
    markerSourceCount: number;
    renderedMarkerCount: number;
    textContent: string;
}> {
    return page.evaluate(() => {
        const activeCard = document.querySelector(".layout-v2-tab-section__card--active");
        const activeLine = Array.from(activeCard?.querySelectorAll<HTMLElement>(".cm-line") ?? [])
            .find((line) => line.textContent?.includes("标点后继续输入"));
        if (!activeLine) {
            throw new Error("Active list line not found.");
        }

        return {
            hasListSourceLine: activeLine.classList.contains("cm-list-source-line"),
            markerSourceCount: activeLine.querySelectorAll(".cm-list-syntax-marker-source").length,
            renderedMarkerCount: activeLine.querySelectorAll(".cm-rendered-list-marker").length,
            textContent: activeLine.textContent ?? "",
        };
    });
}

test.describe("markdown table vim regression", () => {
    test.beforeEach(async ({ page }) => {
        await waitForMockWorkbench(page);
        await enableEditorVimMode(page);
        await openMockNote(page, TABLE_NOTE_PATH);
    });

    test("table cell previews should render inline markdown and enhanced syntax", async ({ page }) => {
        const markdown = [
            "# Table Cell Rendering",
            "",
            "| Syntax | Rendered |",
            "| --- | --- |",
            "| Plain | **table bold** *table italic* ~~table strike~~ `table code` ==table mark== #tabletopic $a^2+b^2=c^2$ [[guide\\|Guide Alias]] [external](https://example.com) |",
            "",
            "Tail",
        ].join("\n");

        await replaceActiveEditorDoc(page, markdown, "Tail");
        await waitForEditorFrames(page, 4);

        const tableWidget = page.locator(".layout-v2-tab-section__card--active .cm-markdown-table-widget");
        await expect(tableWidget.locator(".mtv-shell")).toBeVisible();
        await expect(tableWidget.locator(".cm-rendered-bold", { hasText: "table bold" })).toBeVisible();
        await expect(tableWidget.locator(".cm-rendered-italic", { hasText: "table italic" })).toBeVisible();
        await expect(tableWidget.locator(".cm-rendered-strikethrough", { hasText: "table strike" })).toBeVisible();
        await expect(tableWidget.locator(".cm-rendered-inline-code", { hasText: "table code" })).toBeVisible();
        await expect(tableWidget.locator(".cm-rendered-highlight", { hasText: "table mark" })).toBeVisible();
        await expect(tableWidget.locator(".cm-rendered-tag", { hasText: "#tabletopic" })).toBeVisible();
        await expect(tableWidget.locator(".mtv-cell-preview-markdown .cm-latex-inline-widget").first()).toBeVisible();
        await expect(tableWidget.locator(".cm-rendered-wikilink").filter({ hasText: /^Guide Alias$/ })).toBeVisible();
        await expect(tableWidget.locator(".cm-rendered-link", { hasText: "external" })).toBeVisible();
    });

    test("table wikilinks should preview, open, and collapse after outside editor click", async ({ page }) => {
        const markdown = [
            "# Table WikiLink Focus",
            "Before table",
            "| Name | Link |",
            "| --- | --- |",
            "| Row | [[guide\\|Guide Alias]] |",
            "",
            "Tail",
        ].join("\n");

        await replaceActiveEditorDoc(page, markdown, "Before table");
        await waitForEditorFrames(page, 4);

        const tableWidget = page.locator(".layout-v2-tab-section__card--active .cm-markdown-table-widget");
        const tableLink = tableWidget.locator(".cm-rendered-wikilink", { hasText: /^Guide Alias$/ }).first();
        await expect(tableLink).toBeVisible();
        await expect(tableLink).toHaveAttribute("data-wiki-link-target", "guide");

        await dispatchCmdHoverOnLocator(page, tableLink);
        await expect(page.locator(".cm-wikilink-preview-tooltip")).toBeVisible();
        await hideWikiLinkPreview(page);

        await clickEditorLine(page, 1);
        await page.keyboard.press("Escape");
        await page.keyboard.press("j");
        await page.keyboard.press("l");
        await waitForEditorFrames(page, 4);

        const activeLinkCell = activeTableNavigationCell(page);
        await expect(activeLinkCell).toBeFocused();
        await expect(activeLinkCell).toHaveText("[[guide\\|Guide Alias]]");

        await page.locator(".layout-v2-tab-section__card--active .cm-line", { hasText: "Tail" }).click();
        await waitForEditorFrames(page, 4);
        await expect(page.locator("[data-vim-nav-active='true']:visible")).toHaveCount(0);
        await expect(tableLink).toBeVisible();

        await tableLink.click();
        await expect(page.getByRole("button", { name: "guide.md" }).first()).toBeVisible();
    });

    test("j/k should enter table from the nearest visible body lines using first and last row anchors", async ({ page }) => {
        await clickEditorLine(page, 2);
        await page.keyboard.press("Escape");
        await page.keyboard.press("j");
        await waitForEditorFrames(page);

        const firstCell = activeTableNavigationCell(page);
        await expect(firstCell).toBeFocused();
        await expect(firstCell).toHaveText("**Bold**");
        await expectActiveTableCellPosition(page, "body", 0, 0);

        await clickEditorLine(page, 8);
        await page.keyboard.press("Escape");
        await page.keyboard.press("k");
        await waitForEditorFrames(page);

        const lastRowEntry = activeTableNavigationCell(page);
        await expect(lastRowEntry).toBeFocused();
        await expect(lastRowEntry).toHaveText("`inline code`");
        await expectActiveTableCellPosition(page, "body", 1, 0);
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

    test("table vim navigation should exit back to adjacent editor lines at table boundaries", async ({ page }) => {
        const markdown = [
            "# Table Vim Exit",
            "before table",
            "| A | B |",
            "| --- | --- |",
            "| one | two |",
            "| three | four |",
            "after table",
        ].join("\n");

        await replaceActiveEditorDoc(page, markdown, "before table");
        await waitForEditorFrames(page, 4);
        await page.keyboard.press("Escape");
        await page.keyboard.press("j");
        await waitForEditorFrames(page, 4);

        const activeCell = activeTableNavigationCell(page);
        await expect(activeCell).toBeFocused();
        await expect(activeCell).toHaveText("one");
        await expectActiveTableCellPosition(page, "body", 0, 0);

        await page.keyboard.press("k");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("A");
        await expectActiveTableCellPosition(page, "header", 0, 0);

        await page.keyboard.press("k");
        await waitForEditorFrames(page, 4);
        await expectActiveEditorLine(page, 2, "before table");

        await page.keyboard.press("j");
        await waitForEditorFrames(page, 4);
        await expect(activeCell).toBeFocused();
        await expect(activeCell).toHaveText("one");
        await expectActiveTableCellPosition(page, "body", 0, 0);

        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("three");
        await expectActiveTableCellPosition(page, "body", 1, 0);

        await page.keyboard.press("j");
        await waitForEditorFrames(page, 4);
        await expectActiveEditorLine(page, 7, "after table");

        await setEditorSelectionToTextEnd(page, "before table");
        await page.keyboard.press("Escape");
        await page.keyboard.press("j");
        await waitForEditorFrames(page, 4);
        await expect(activeCell).toBeFocused();
        await expect(activeCell).toHaveText("one");
        await expectActiveTableCellPosition(page, "body", 0, 0);

        await page.keyboard.press("Escape");
        await waitForEditorFrames(page, 4);
        await expectActiveEditorLine(page, 7, "after table");
    });

    test("table vim navigation should not loop when exiting downward from a table at document end", async ({ page }) => {
        const markdown = [
            "# Table At EOF",
            "before table",
            "| A | B |",
            "| --- | --- |",
            "| one | two |",
            "| three | four |",
        ].join("\n");

        await replaceActiveEditorDoc(page, markdown, "before table");
        await waitForEditorFrames(page, 4);
        await page.keyboard.press("Escape");
        await page.keyboard.press("j");
        await waitForEditorFrames(page, 4);

        const activeCell = activeTableNavigationCell(page);
        await expect(activeCell).toBeFocused();
        await expect(activeCell).toHaveText("one");
        await expectActiveTableCellPosition(page, "body", 0, 0);

        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("three");
        await expectActiveTableCellPosition(page, "body", 1, 0);

        await page.keyboard.press("j");
        await waitForEditorFrames(page, 8);
        await expectActiveEditorLine(page, 6, "| three | four |");

        await page.keyboard.press("i");
        await waitForEditorFrames(page, 4);
        await expect.poll(async () => {
            const state = await getActiveEditorState(page);
            return state.vimInsertMode;
        }).toBe(true);

        await page.keyboard.insertText(" editable");
        await waitForEditorFrames(page, 4);
        await expect.poll(async () => {
            const state = await getActiveEditorState(page);
            return state.docText;
        }).toContain("| three | four | editable");
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
        await enterVimInsertModeAtCurrentSelection(page);

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
        await enterVimInsertModeAtCurrentSelection(page);

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
        await enterVimInsertModeAtCurrentSelection(page);

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
        await enterVimInsertModeAtCurrentSelection(page);

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

    test("IME insert selection drift should be restored on markdown list lines", async ({ page }) => {
        const unorderedLine = "- xxx";
        await openMockNote(page, INLINE_CODE_WIKILINK_NOTE_PATH);
        await disableEditorVimMode(page);
        await replaceActiveEditorDoc(page, [unorderedLine, "1. xxx", "---"].join("\n"), unorderedLine);

        const unorderedInitialState = await getActiveEditorState(page);
        await simulateImeInsertSelectionDriftToLineStart(page, "w");
        await waitForEditorFrames(page, 4);

        const unorderedPreeditState = await getActiveEditorState(page);
        expect(unorderedPreeditState.head).toBe(unorderedInitialState.head);
        expect(unorderedPreeditState.lineNumber).toBe(unorderedInitialState.lineNumber);

        await page.keyboard.insertText("w");
        await dispatchEditorCompositionEvent(page, "compositionend", "w");
        await waitForEditorFrames(page, 4);

        const unorderedCommittedState = await getActiveEditorState(page);
        expect(unorderedCommittedState.head).toBe(unorderedInitialState.head + 1);
        expect(unorderedCommittedState.docText).toContain("- xxxw");

        await replaceActiveEditorDoc(page, [unorderedLine, "1. xxx", "---"].join("\n"), "1. xxx");

        const orderedInitialState = await getActiveEditorState(page);
        await simulateImeInsertSelectionDriftToLineStart(page, "w");
        await waitForEditorFrames(page, 4);

        const orderedPreeditState = await getActiveEditorState(page);
        expect(orderedPreeditState.head).toBe(orderedInitialState.head);
        expect(orderedPreeditState.lineNumber).toBe(orderedInitialState.lineNumber);

        await page.keyboard.insertText("w");
        await dispatchEditorCompositionEvent(page, "compositionend", "w");
        await waitForEditorFrames(page, 4);

        const orderedCommittedState = await getActiveEditorState(page);
        expect(orderedCommittedState.head).toBe(orderedInitialState.head + 1);
        expect(orderedCommittedState.docText).toContain("1. xxxw");
    });

    test("IME pinyin after punctuation should keep markdown list source DOM stable", async ({ page }) => {
        const userLine = "- 标点后继续输入";
        await openMockNote(page, INLINE_CODE_WIKILINK_NOTE_PATH);
        await disableEditorVimMode(page);
        await replaceActiveEditorDoc(page, [userLine, "---"].join("\n"), userLine);

        const initialState = await getActiveEditorState(page);
        await page.keyboard.insertText("，");
        await waitForEditorFrames(page, 4);

        const afterPunctuationState = await getActiveEditorState(page);
        expect(afterPunctuationState.head).toBe(initialState.head + 1);
        expect(afterPunctuationState.docText).toContain(`${userLine}，`);

        const beforeCursor = afterPunctuationState.docText.slice(0, afterPunctuationState.head);
        const afterCursor = afterPunctuationState.docText.slice(afterPunctuationState.head);

        await setImeCompositionWithChrome(page, "ni");
        await waitForEditorFrames(page, 4);

        const preeditState = await getActiveEditorState(page);
        expect(preeditState.head).toBe(afterPunctuationState.head + 2);
        expect(preeditState.lineNumber).toBe(afterPunctuationState.lineNumber);
        const preeditLineRenderState = await readActiveListLineRenderState(page);
        expect(preeditLineRenderState.hasListSourceLine).toBe(true);
        expect(preeditLineRenderState.markerSourceCount).toBe(1);
        expect(preeditLineRenderState.renderedMarkerCount).toBe(0);
        expect(preeditLineRenderState.textContent).toContain(`${userLine}，ni`);

        await insertTextWithChrome(page, "你");
        await waitForEditorFrames(page, 4);

        const committedState = await getActiveEditorState(page);
        expect(committedState.head).toBe(afterPunctuationState.head + 1);
        expect(committedState.docText).toBe(`${beforeCursor}你${afterCursor}`);
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
        await expectActiveTableCellPosition(page, "body", 1, 1);

        await page.keyboard.press("Enter");
        await waitForEditorFrames(page);
        await expect(input).toBeFocused();
        await input.pressSequentially("X");
        await waitForEditorFrames(page);
        await page.keyboard.press("Escape");
        await waitForEditorFrames(page, 4);
        await expect(activeCell).toBeFocused();
        await expect(activeCell).toHaveText("决定不同区域里展示什么容器X");
        await expectActiveTableCellPosition(page, "body", 1, 1);

        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("把业务数据投影到布局引擎");
        await expectActiveTableCellPosition(page, "body", 2, 1);

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
        await expectActiveTableCellPosition(page, "body", 0, 1);

        await page.keyboard.press("j");
        await waitForEditorFrames(page);
        await expect(activeCell).toHaveText("决定不同区域里展示什么容器X");
        await expectActiveTableCellPosition(page, "body", 1, 1);
    });

    test("edge handles should select, reorder, open context actions, and resize the table @mouse-drag", async ({ page }) => {
        await openMockNote(page, TABLE_BOUNDARY_NOTE_PATH);
        await expect(page.locator(".mtv-table:visible")).toBeVisible();

        const firstColumnHandle = page.locator("[data-table-edge-kind='column'][data-table-edge-index='0']").first();
        const thirdColumnHandle = page.locator("[data-table-edge-kind='column'][data-table-edge-index='2']").first();
        const firstBodyCell = page
            .locator(".mtv-table-body-cell:has([data-markdown-table-section='body'][data-markdown-table-row-index='0'][data-markdown-table-column-index='0'])")
            .first();
        const firstHeaderCell = page.locator(".mtv-table-head-cell").first();
        const firstColumnResizeHandle = page.locator("[data-table-resize-kind='column'][data-table-resize-index='0']").first();
        const firstRowResizeHandle = page.locator("[data-table-resize-kind='row'][data-table-resize-index='0']").first();

        await firstColumnHandle.click();
        await expect(firstColumnHandle).toHaveAttribute("data-selected", "true");
        await expect(firstHeaderCell).toHaveAttribute("data-edge-selected", "true");
        await expect(firstBodyCell).toHaveAttribute("data-edge-selected", "true");

        const initialHeaderWidth = await firstHeaderCell.evaluate((element) => element.getBoundingClientRect().width);
        await dragLocatorBy(page, firstColumnResizeHandle, 44, 0);
        await expect.poll(async () => firstHeaderCell.evaluate((element) =>
            Math.round(element.getBoundingClientRect().width),
        )).toBeGreaterThan(Math.round(initialHeaderWidth + 20));

        const firstRowCell = page.locator(".mtv-table-body-cell").first();
        const initialRowHeight = await firstRowCell.evaluate((element) => element.getBoundingClientRect().height);
        await dragLocatorBy(page, firstRowResizeHandle, 0, 28);
        await expect.poll(async () => firstRowCell.evaluate((element) =>
            Math.round(element.getBoundingClientRect().height),
        )).toBeGreaterThan(Math.round(initialRowHeight + 12));

        await dragLocatorToLocator(page, firstColumnHandle, thirdColumnHandle);
        await waitForEditorFrames(page, 4);
        await expect(page.locator("[data-markdown-table-section='header'][data-markdown-table-column-index='2']").first())
            .toHaveText("层级");
        await expect(page.locator("[data-markdown-table-section='body'][data-markdown-table-row-index='0'][data-markdown-table-column-index='2']").first())
            .toHaveText("布局骨架层");

        const firstRowHandle = page.locator("[data-table-edge-kind='row'][data-table-edge-index='0']").first();
        const thirdRowHandle = page.locator("[data-table-edge-kind='row'][data-table-edge-index='2']").first();
        await dragLocatorToLocator(page, firstRowHandle, thirdRowHandle);
        await waitForEditorFrames(page, 4);
        await expect(page.locator("[data-markdown-table-section='body'][data-markdown-table-row-index='2'][data-markdown-table-column-index='2']").first())
            .toHaveText("布局骨架层");

        const secondColumnHandle = page.locator("[data-table-edge-kind='column'][data-table-edge-index='1']").first();
        await secondColumnHandle.click({ button: "right" });
        await expect(page.locator(".mtv-context-menu:visible")).toBeVisible();
        await page.getByRole("menuitem", { name: "Insert Column Right" }).click();
        await waitForEditorFrames(page, 4);
        await expect(page.locator("[data-table-edge-kind='column']")).toHaveCount(4);

        const fourthColumnHandle = page.locator("[data-table-edge-kind='column'][data-table-edge-index='3']").first();
        await fourthColumnHandle.click({ button: "right" });
        await page.getByRole("menuitem", { name: "Delete Current Column" }).click();
        await waitForEditorFrames(page, 4);
        await expect(page.locator("[data-table-edge-kind='column']")).toHaveCount(3);

        const secondRowHandle = page.locator("[data-table-edge-kind='row'][data-table-edge-index='1']").first();
        await secondRowHandle.click({ button: "right", force: true });
        await page.getByRole("menuitem", { name: "Insert Row Below" }).click();
        await waitForEditorFrames(page, 4);
        await expect(page.locator("[data-table-edge-kind='row']")).toHaveCount(4);

        const fourthRowHandle = page.locator("[data-table-edge-kind='row'][data-table-edge-index='3']").first();
        await fourthRowHandle.click({ button: "right", force: true });
        await page.getByRole("menuitem", { name: "Delete Current Row" }).click();
        await waitForEditorFrames(page, 4);
        await expect(page.locator("[data-table-edge-kind='row']")).toHaveCount(3);
    });

    test("resized table layout should persist in markdown and restore after reopening @mouse-drag", async ({ page }) => {
        await openMockNote(page, TABLE_BOUNDARY_NOTE_PATH);
        await expect(page.locator(".mtv-table:visible")).toBeVisible();

        const firstHeaderCell = page.locator(".mtv-table-head-cell").first();
        const firstRowCell = page.locator(".mtv-table-body-cell").first();
        const firstColumnResizeHandle = page.locator("[data-table-resize-kind='column'][data-table-resize-index='0']").first();
        const firstRowResizeHandle = page.locator("[data-table-resize-kind='row'][data-table-resize-index='0']").first();

        const initialHeaderWidth = await firstHeaderCell.evaluate((element) => element.getBoundingClientRect().width);
        const initialRowHeight = await firstRowCell.evaluate((element) => element.getBoundingClientRect().height);

        await dragLocatorBy(page, firstColumnResizeHandle, 52, 0);
        await waitForEditorFrames(page, 1);
        await dragLocatorBy(page, firstRowResizeHandle, 0, 34);
        await waitForEditorFrames(page, 4);

        const resizedHeaderWidth = await firstHeaderCell.evaluate((element) => Math.round(element.getBoundingClientRect().width));
        const resizedRowHeight = await firstRowCell.evaluate((element) => Math.round(element.getBoundingClientRect().height));
        expect(resizedHeaderWidth).toBeGreaterThan(Math.round(initialHeaderWidth + 24));
        expect(resizedRowHeight).toBeGreaterThan(Math.round(initialRowHeight + 16));

        await expect.poll(async () => {
            const state = await getActiveEditorState(page);
            return /<!-- ofive-table-layout: \{"columns":\[[^\]]+\],"rows":\[[^\]]+\]\} -->/.test(state.docText);
        }).toBe(true);

        await flushAutoSave(page);
        const savedContent = await readBrowserMockMarkdownContent(page, TABLE_BOUNDARY_NOTE_PATH);
        expect(savedContent).toContain("<!-- ofive-table-layout:");

        await closeMockNoteTab(page, "table-vim-boundary.md");
        await openMockNote(page, TABLE_BOUNDARY_NOTE_PATH);
        await expect(page.locator(".mtv-table:visible")).toBeVisible();
        await waitForEditorFrames(page, 4);

        const restoredHeaderWidth = await page.locator(".mtv-table-head-cell").first()
            .evaluate((element) => Math.round(element.getBoundingClientRect().width));
        const restoredRowHeight = await page.locator(".mtv-table-body-cell").first()
            .evaluate((element) => Math.round(element.getBoundingClientRect().height));

        expect(Math.abs(restoredHeaderWidth - resizedHeaderWidth)).toBeLessThanOrEqual(3);
        expect(Math.abs(restoredRowHeight - resizedRowHeight)).toBeLessThanOrEqual(4);
    });

    test("row edge handles should align to the visual center of wrapped table rows", async ({ page }) => {
        await openMockNote(page, TABLE_BOUNDARY_NOTE_PATH);
        await expect(page.locator(".mtv-table:visible")).toBeVisible();
        await waitForEditorFrames(page, 4);

        for (const rowIndex of [0, 1, 2]) {
            const rowHandle = page.locator(`[data-table-edge-kind='row'][data-table-edge-index='${rowIndex}']`).first();
            const firstRowCell = page
                .locator(`.mtv-table-body-cell:has([data-markdown-table-section='body'][data-markdown-table-row-index='${rowIndex}'][data-markdown-table-column-index='0'])`)
                .first();

            const centers = await Promise.all([
                rowHandle.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    return rect.top + rect.height / 2;
                }),
                firstRowCell.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    return rect.top + rect.height / 2;
                }),
            ]);

            expect(Math.abs(centers[0] - centers[1])).toBeLessThanOrEqual(1.5);
        }
    });

    test("table widget should not create an independent vertical scrollbar", async ({ page }) => {
        await openMockNote(page, TABLE_BOUNDARY_NOTE_PATH);
        const tableScroll = page.locator(".mtv-table-scroll:visible").first();
        await expect(tableScroll).toBeVisible();

        const scrollMetrics = await tableScroll.evaluate((element) => {
            const style = window.getComputedStyle(element);
            const horizontalScroller = element.querySelector<HTMLElement>(".mtv-table-x-scroll");
            const horizontalScrollerStyle = horizontalScroller
                ? window.getComputedStyle(horizontalScroller)
                : null;
            return {
                outerOverflowX: style.overflowX,
                outerOverflowY: style.overflowY,
                innerOverflowX: horizontalScrollerStyle?.overflowX ?? "",
                innerOverflowY: horizontalScrollerStyle?.overflowY ?? "",
                clientHeight: element.clientHeight,
                scrollHeight: element.scrollHeight,
                innerClientHeight: horizontalScroller?.clientHeight ?? 0,
                innerScrollHeight: horizontalScroller?.scrollHeight ?? 0,
            };
        });

        expect(scrollMetrics.outerOverflowX).toBe("visible");
        expect(scrollMetrics.outerOverflowY).toBe("visible");
        expect(scrollMetrics.innerOverflowX).toBe("auto");
        expect(scrollMetrics.innerOverflowY).toBe("hidden");
        expect(scrollMetrics.innerScrollHeight - scrollMetrics.innerClientHeight).toBeLessThanOrEqual(1);
    });
});
