/**
 * @module e2e/editor-nested-syntax-interactions
 * @description 从用户交互角度枚举 wikilink、代码块、公式块、列表与行内代码的嵌套边界。
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";
const LINK_TARGET_TAB_NAME = "network-segment.md";

const NESTED_INTERACTION_MARKDOWN = [
    "# Nested Syntax Interaction Matrix",
    "",
    "P01 paragraph active [[network-segment]]",
    "P02 paragraph alias [[network-segment|Network Alias]]",
    "P03 paragraph math $E=mc^2$ active [[network-segment]]",
    "P04 inline code suppressed `[[network-segment]]`",
    "P05 project inline code suppressed `[[projectName:/path/to/file:42]]`",
    "",
    "- L01 bullet active [[network-segment]]",
    "1. L02 ordered active [[network-segment]]",
    "- [ ] L03 task active [[network-segment]]",
    "- [x] L04 checked task active [[network-segment]]",
    "  - L05 nested bullet active [[network-segment]]",
    "  1. L06 nested ordered active [[network-segment]]",
    "  - [ ] L07 nested task active [[network-segment]]",
    "- L08 bullet inline code suppressed `[[network-segment]]`",
    "- L09 bullet inline math $E=mc^2$ active [[network-segment]]",
    "",
    "> Q01 quote active [[network-segment]]",
    "> - Q02 quote-list active [[network-segment]]",
    "> Q03 quote inline code suppressed `[[network-segment]]`",
    "",
    "C01 fenced code follows",
    "```ts",
    'C02 code suppressed [[network-segment]] $E=mc^2$ - [ ] task',
    "```",
    "",
    "- C03 list fenced code follows",
    "  ```ts",
    '  C04 list code suppressed [[network-segment]] $E=mc^2$ - [ ] task',
    "  ```",
    "",
    "C05 tilde code follows",
    "~~~md",
    "C06 tilde code suppressed [[network-segment]] $$x$$",
    "~~~",
    "",
    "M01 multiline formula follows",
    "$$",
    "M02 latex suppressed [[network-segment]] - [ ] task",
    "$$",
    "",
    "M03 single-line formula follows",
    "$$ M03 latex single suppressed [[network-segment]] $$",
    "",
    "- M04 list formula follows",
    "  $$",
    "  M05 list latex suppressed [[network-segment]] - [ ] task",
    "  $$",
    "",
    "Interaction Tail",
].join("\n");

const ACTIVE_WIKILINK_CASES = [
    "P01 paragraph active",
    "P02 paragraph alias",
    "P03 paragraph math",
    "L01 bullet active",
    "L02 ordered active",
    "L03 task active",
    "L04 checked task active",
    "L05 nested bullet active",
    "L06 nested ordered active",
    "L07 nested task active",
    "L09 bullet inline math",
    "Q01 quote active",
    "Q02 quote-list active",
];

const SUPPRESSED_WIKILINK_CASES = [
    "P04 inline code suppressed",
    "P05 project inline code suppressed",
    "L08 bullet inline code suppressed",
    "Q03 quote inline code suppressed",
    "C02 code suppressed",
    "C04 list code suppressed",
    "C06 tilde code suppressed",
    "M02 latex suppressed",
    "M03 latex single suppressed",
    "M05 list latex suppressed",
];

const TASK_CASES = [
    { label: "L03 task active", initiallyChecked: false },
    { label: "L04 checked task active", initiallyChecked: true },
    { label: "L07 nested task active", initiallyChecked: false },
];

const VIM_VISIT_CASES = [
    ...ACTIVE_WIKILINK_CASES,
    ...SUPPRESSED_WIKILINK_CASES,
    "C01 fenced code follows",
    "C03 list fenced code follows",
    "C05 tilde code follows",
    "M01 multiline formula follows",
    "M04 list formula follows",
];

function activeEditor(page: Page) {
    return page.locator(".layout-v2-tab-section__card--active");
}

function tabStripButton(page: Page, name: string) {
    return page.locator(".layout-v2-tab-section__strip").getByRole("button", { name }).first();
}

async function waitForMockWorkbench(page: Page): Promise<void> {
    await gotoMockVaultPage(page, "editor-nested-syntax-interactions", MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-right']").waitFor({ state: "visible" });
    await page.evaluate(async () => {
        const configStoreModule = await import("/src/host/config/configStore.ts");
        await configStoreModule.updateFeatureSetting("fileOpenMode", "new-tab");
    });
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
    await tabStripButton(page, fileName).waitFor({ state: "visible" });
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
    await waitForEditorFrames(page, 4);
}

async function setActiveEditorSelectionToLineContaining(page: Page, needle: string, offset = 0): Promise<void> {
    await page.evaluate(({ targetNeedle, targetOffset }) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    focus: () => void;
                    dispatch: (spec: unknown) => void;
                    state: {
                        doc: {
                            line: (lineNumber: number) => { from: number; text: string };
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
            const index = line.text.indexOf(targetNeedle);
            if (index >= 0) {
                view.focus();
                view.dispatch({
                    selection: { anchor: line.from + Math.max(0, index + targetOffset) },
                    scrollIntoView: true,
                });
                return;
            }
        }

        throw new Error(`Line containing needle not found: ${targetNeedle}`);
    }, { targetNeedle: needle, targetOffset: offset });
    await waitForEditorFrames(page, 4);
}

async function getLineNumberForNeedle(page: Page, needle: string): Promise<number> {
    return page.evaluate((targetNeedle) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    state: {
                        doc: {
                            line: (lineNumber: number) => { text: string };
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
            if (view.state.doc.line(lineNumber).text.includes(targetNeedle)) {
                return lineNumber;
            }
        }

        throw new Error(`Line containing needle not found: ${targetNeedle}`);
    }, needle);
}

async function getActiveEditorLineText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    state: {
                        doc: {
                            lineAt: (position: number) => { text: string };
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
        return view.state.doc.lineAt(view.state.selection.main.head).text;
    });
}

async function getActiveEditorDocText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    state: {
                        doc: {
                            toString: () => string;
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

async function focusActiveEditorView(page: Page): Promise<void> {
    await page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    focus: () => void;
                };
            };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found.");
        }
        view.focus();
    });
    await waitForEditorFrames(page, 1);
}

async function pressVimKeys(page: Page, keys: string[]): Promise<void> {
    for (const key of keys) {
        await page.keyboard.press(key);
        await waitForEditorFrames(page, 1);
    }
}

async function vimJumpToLine(page: Page, lineNumber: number): Promise<void> {
    await focusActiveEditorView(page);
    await page.keyboard.press("Escape");
    await pressVimKeys(page, ["g", "g"]);
    const downCount = lineNumber - 1;
    if (downCount > 0) {
        await pressVimKeys(page, [...String(downCount).split(""), "j"]);
    }
    await waitForEditorFrames(page, 2);
}

async function vimSearchForLine(page: Page, label: string): Promise<void> {
    await focusActiveEditorView(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("/");
    await page.keyboard.insertText(label);
    await page.keyboard.press("Enter");
    await waitForEditorFrames(page, 4);
}

async function dispatchCmdHover(page: Page, selector: string, label: string): Promise<void> {
    await page.evaluate(({ targetSelector, targetLabel }) => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active");
        const line = Array.from(activeCard?.querySelectorAll<HTMLElement>(".cm-line") ?? [])
            .find((candidate) => candidate.textContent?.includes(targetLabel));
        const target = line?.querySelector<HTMLElement>(targetSelector) ?? line;
        if (!target) {
            throw new Error(`Hover target not found: ${targetLabel}`);
        }

        const rect = target.getBoundingClientRect();
        target.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + Math.max(1, rect.width / 2),
            clientY: rect.top + Math.max(1, rect.height / 2),
            metaKey: true,
            ctrlKey: true,
        }));
    }, { targetSelector: selector, targetLabel: label });
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

async function expectCmdHoverPreviewForLine(page: Page, label: string): Promise<void> {
    await setActiveEditorSelectionToLineContaining(page, label);
    const line = activeEditor(page).locator(".cm-line", { hasText: label }).first();
    const link = line.locator(".cm-rendered-wikilink").first();
    await expect(link).toBeVisible();

    await dispatchCmdHover(page, ".cm-rendered-wikilink", label);
    await expect(page.locator(".cm-wikilink-preview-tooltip")).toBeVisible();
    await hideWikiLinkPreview(page);
}

async function expectClickOpensTargetForLine(page: Page, label: string): Promise<void> {
    await setActiveEditorSelectionToLineContaining(page, label);
    const line = activeEditor(page).locator(".cm-line", { hasText: label }).first();
    const link = line.locator(".cm-rendered-wikilink").first();
    await expect(link).toBeVisible();

    await link.click({ force: true });
    await expect(tabStripButton(page, LINK_TARGET_TAB_NAME)).toBeVisible();
    await tabStripButton(page, "guide.md").click();
    expect(await getActiveEditorDocText(page)).toContain("Nested Syntax Interaction Matrix");
}

async function expectNoPreviewOrOpenForLine(page: Page, label: string): Promise<void> {
    await setActiveEditorSelectionToLineContaining(page, label);
    const line = activeEditor(page).locator(".cm-line", { hasText: label }).first();
    await expect(line).toBeVisible();
    await expect(line.locator(".cm-rendered-wikilink")).toHaveCount(0);

    await dispatchCmdHover(page, ".cm-rendered-inline-code", label);
    await expect(page.locator(".cm-wikilink-preview-tooltip")).toHaveCount(0);
    await hideWikiLinkPreview(page);

    await line.click({ force: true });
    await waitForEditorFrames(page, 2);
    expect(await getActiveEditorDocText(page)).toContain("Nested Syntax Interaction Matrix");
}

async function installMatrixArticle(page: Page): Promise<void> {
    await waitForMockWorkbench(page);
    await enableEditorVimMode(page);
    const restoredTargetTab = page.locator(".layout-v2-tab-section__strip")
        .getByRole("button", { name: `Close ${LINK_TARGET_TAB_NAME}` });
    while (await restoredTargetTab.count()) {
        await restoredTargetTab.first().click();
        await waitForEditorFrames(page, 2);
    }
    await openMockNote(page, GUIDE_NOTE_PATH);
    await replaceActiveEditorDoc(page, NESTED_INTERACTION_MARKDOWN, "Interaction Tail");
    await tabStripButton(page, "guide.md").click();
    expect(await getActiveEditorDocText(page)).toContain("Nested Syntax Interaction Matrix");
}

test.describe("editor nested syntax interactions", () => {
    test("active wikilinks in paragraphs, lists, tasks, and blockquotes support Cmd hover and click", async ({ page }) => {
        test.setTimeout(90_000);
        await installMatrixArticle(page);

        for (const label of ACTIVE_WIKILINK_CASES) {
            await expectCmdHoverPreviewForLine(page, label);
            await expectClickOpensTargetForLine(page, label);
        }
    });

    test("inline code, code fences, and LaTeX blocks suppress wikilink hover and click", async ({ page }) => {
        test.setTimeout(60_000);
        await installMatrixArticle(page);

        for (const label of SUPPRESSED_WIKILINK_CASES) {
            await expectNoPreviewOrOpenForLine(page, label);
        }
    });

    test("Vim can visit every nested syntax case and task clicks still toggle nested lists", async ({ page }) => {
        test.setTimeout(90_000);
        await installMatrixArticle(page);

        for (const label of VIM_VISIT_CASES) {
            await vimSearchForLine(page, label);
            expect(await getActiveEditorLineText(page)).toContain(label);
        }

        for (const taskCase of TASK_CASES) {
            const lineNumber = await getLineNumberForNeedle(page, taskCase.label);
            const nearbyLineNumber = Math.min(lineNumber + 1, await getLineNumberForNeedle(page, "Interaction Tail"));
            await vimJumpToLine(page, nearbyLineNumber);

            const line = activeEditor(page).locator(".cm-line", { hasText: taskCase.label }).first();
            const checkboxSelector = taskCase.initiallyChecked
                ? ".cm-rendered-task-checkbox-checked"
                : ".cm-rendered-task-checkbox-unchecked";
            const toggledSelector = taskCase.initiallyChecked
                ? ".cm-rendered-task-checkbox-unchecked"
                : ".cm-rendered-task-checkbox-checked";

            await expect(line.locator(checkboxSelector)).toBeVisible();
            await line.locator(".cm-rendered-task-checkbox").click({ force: true });
            await expect(line.locator(toggledSelector)).toBeVisible();
        }
    });
});
