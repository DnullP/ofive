/**
 * @module e2e/markdown-table-wheel
 * @description Markdown 表格滚轮交互回归测试。
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const TABLE_NOTE_PATH = "test-resources/notes/table-editor.md";

async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await page.locator("[data-testid='main-dockview-host']").waitFor({ state: "visible" });
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
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
    }, frameCount);
}

async function replaceActiveEditorDoc(page: Page, markdown: string, cursorNeedle: string): Promise<void> {
    await page.evaluate(({ nextMarkdown, needle }) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
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

        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: nextMarkdown },
            selection: { anchor: needleIndex + needle.length },
            scrollIntoView: true,
        });
    }, { nextMarkdown: markdown, needle: cursorNeedle });
}

async function getActiveEditorScrollTop(page: Page): Promise<number> {
    return page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>(
            ".layout-v2-tab-section__card--active .cm-scroller",
        );
        if (!scroller) {
            throw new Error("Editor scroller not found.");
        }

        return scroller.scrollTop;
    });
}

async function setActiveEditorScrollTop(page: Page, scrollTop: number): Promise<void> {
    await page.evaluate((nextScrollTop) => {
        const scroller = document.querySelector<HTMLElement>(
            ".layout-v2-tab-section__card--active .cm-scroller",
        );
        if (!scroller) {
            throw new Error("Editor scroller not found.");
        }

        scroller.scrollTop = nextScrollTop;
        scroller.dispatchEvent(new Event("scroll"));
    }, scrollTop);
}

function createLargeMarkdownTable(rowCount: number): string {
    return [
        "# Large Trackpad Table",
        "",
        "| Key | Owner | Status | Detail |",
        "| --- | --- | --- | --- |",
        ...Array.from({ length: rowCount }, (_, rowIndex) => {
            const rowNumber = String(rowIndex + 1).padStart(4, "0");
            return `| K-${rowNumber} | Team ${rowIndex % 10} | Active | Trackpad wheel burst detail ${rowNumber}. |`;
        }),
        "",
        "After table",
    ].join("\n");
}

async function readRenderedBodyRowCount(page: Page): Promise<number> {
    return page.evaluate(() => {
        const table = document.querySelector<HTMLElement>(
            ".layout-v2-tab-section__card--active .mtv-table",
        );
        if (!table) {
            throw new Error("Markdown table not found.");
        }

        return table.querySelectorAll(".mtv-table-body-row").length;
    });
}

test.describe("markdown table wheel regression", () => {
    test.beforeEach(async ({ page }) => {
        await waitForMockWorkbench(page);
        await openMockNote(page, TABLE_NOTE_PATH);
    });

    test("vertical wheel over table widget should keep scrolling the editor", async ({ page }) => {
        const markdown = [
            "# Table Wheel Scroll",
            "",
            "| A | B | C |",
            "| --- | --- | --- |",
            "| one | two | three |",
            "| four | five | six |",
            "",
            ...Array.from({ length: 120 }, (_, lineIndex) => `Tail line ${lineIndex + 1}`),
        ].join("\n");

        await replaceActiveEditorDoc(page, markdown, "Table Wheel Scroll");
        await waitForEditorFrames(page, 4);
        await setActiveEditorScrollTop(page, 0);
        await waitForEditorFrames(page, 2);

        const tableWheelTarget = page.locator(
            ".layout-v2-tab-section__card--active .cm-markdown-table-widget .mtv-table-x-scroll",
        ).first();
        await expect(tableWheelTarget).toBeVisible();

        const beforeScrollTop = await getActiveEditorScrollTop(page);
        await tableWheelTarget.hover();
        await page.mouse.wheel(0, 480);

        await expect.poll(async () => getActiveEditorScrollTop(page))
            .toBeGreaterThan(beforeScrollTop + 120);
    });

    test("trackpad-like wheel burst over a 1000-row table should be frame-coalesced", async ({ page }) => {
        test.slow();
        await replaceActiveEditorDoc(page, createLargeMarkdownTable(1000), "Large Trackpad Table");
        await expect(page.locator(".layout-v2-tab-section__card--active .cm-markdown-table-widget .mtv-table")).toBeVisible();
        await waitForEditorFrames(page, 4);
        await setActiveEditorScrollTop(page, 0);

        const result = await page.evaluate(async () => {
            const wheelTarget = document.querySelector<HTMLElement>(
                ".layout-v2-tab-section__card--active .cm-markdown-table-widget .mtv-table-x-scroll",
            );
            const scroller = document.querySelector<HTMLElement>(
                ".layout-v2-tab-section__card--active .cm-scroller",
            );
            if (!wheelTarget || !scroller) {
                throw new Error("Markdown table wheel target not found.");
            }

            let scrollEvents = 0;
            const handleScroll = (): void => {
                scrollEvents += 1;
            };
            scroller.addEventListener("scroll", handleScroll);

            const beforeScrollTop = scroller.scrollTop;
            let preventedEvents = 0;
            for (let eventIndex = 0; eventIndex < 120; eventIndex += 1) {
                const wheelEvent = new WheelEvent("wheel", {
                    bubbles: true,
                    cancelable: true,
                    deltaX: 0,
                    deltaY: 8,
                    deltaMode: 0,
                });
                wheelTarget.dispatchEvent(wheelEvent);
                if (wheelEvent.defaultPrevented) {
                    preventedEvents += 1;
                }
            }
            const immediateScrollTop = scroller.scrollTop;
            const immediateScrollEvents = scrollEvents;

            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

            const afterScrollTop = scroller.scrollTop;
            scroller.removeEventListener("scroll", handleScroll);

            return {
                beforeScrollTop,
                immediateScrollTop,
                afterScrollTop,
                immediateScrollEvents,
                scrollEvents,
                preventedEvents,
            };
        });

        expect(result.preventedEvents).toBe(120);
        expect(result.immediateScrollTop).toBe(result.beforeScrollTop);
        expect(result.immediateScrollEvents).toBe(0);
        expect(result.scrollEvents).toBeLessThanOrEqual(2);
        expect(result.afterScrollTop).toBeGreaterThan(result.beforeScrollTop + 700);
        expect(await readRenderedBodyRowCount(page)).toBeLessThan(90);
    });
});
