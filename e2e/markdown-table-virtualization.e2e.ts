/**
 * @module e2e/markdown-table-virtualization
 * @description 千级 Markdown 表格行虚拟化与交互性能回归测试。
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const TABLE_NOTE_PATH = "test-resources/notes/table-editor.md";

declare global {
    interface Window {
        __stopMarkdownTableVirtualizationPerf?: () => {
            frameDeltas: number[];
            framesOver50: number;
            longTaskMax: number;
        };
    }
}

interface CodeMirrorContentElement extends HTMLElement {
    cmTile?: {
        view?: {
            dispatch(spec: unknown): void;
            focus(): void;
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

function createThousandRowMarkdownTable(): string {
    return [
        "# Thousand Row Table",
        "",
        "| Key | Owner | Status | Detail |",
        "| --- | --- | --- | --- |",
        ...Array.from({ length: 1000 }, (_, rowIndex) => {
            const rowNumber = String(rowIndex + 1).padStart(4, "0");
            return `| K-${rowNumber} | Team ${rowIndex % 12} | Active | Thousand row table detail ${rowNumber} with enough text to exercise row height estimation. |`;
        }),
        "",
        "After table",
    ].join("\n");
}

async function replaceActiveEditorDoc(page: Page, markdown: string, cursorNeedle: string): Promise<void> {
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
    await page.evaluate(({ nextMarkdown, needle }) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as CodeMirrorContentElement | null;
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

async function installPerformanceSampler(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__stopMarkdownTableVirtualizationPerf?.();
        const frameDeltas: number[] = [];
        const longTasks: number[] = [];
        let active = true;
        let previousFrameTime = 0;
        let frameId = 0;
        const startTime = performance.now();
        let observer: PerformanceObserver | null = null;

        const tick = (timestamp: number): void => {
            if (!active) {
                return;
            }
            if (previousFrameTime > 0) {
                frameDeltas.push(timestamp - previousFrameTime);
            }
            previousFrameTime = timestamp;
            frameId = window.requestAnimationFrame(tick);
        };

        if (typeof PerformanceObserver !== "undefined") {
            try {
                observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.startTime >= startTime) {
                            longTasks.push(entry.duration);
                        }
                    }
                });
                observer.observe({ type: "longtask" });
            } catch {
                observer = null;
            }
        }

        frameId = window.requestAnimationFrame(tick);
        window.__stopMarkdownTableVirtualizationPerf = () => {
            active = false;
            window.cancelAnimationFrame(frameId);
            observer?.disconnect();
            return {
                frameDeltas,
                framesOver50: frameDeltas.filter((delta) => delta > 50).length,
                longTaskMax: Math.max(0, ...longTasks),
            };
        };
    });
}

async function stopPerformanceSampler(page: Page): Promise<{
    frameDeltas: number[];
    framesOver50: number;
    longTaskMax: number;
}> {
    return page.evaluate(() => {
        const stop = window.__stopMarkdownTableVirtualizationPerf;
        if (!stop) {
            throw new Error("markdown table virtualization sampler missing");
        }

        return stop();
    });
}

async function readVirtualizedTableMetrics(page: Page): Promise<{
    isVirtualized: boolean;
    totalBodyRows: number;
    renderedBodyRows: number;
    renderedBodyCells: number;
    firstRenderedRowIndex: number;
    lastRenderedRowIndex: number;
}> {
    return page.evaluate(() => {
        const table = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active .mtv-table");
        if (!table) {
            throw new Error("Markdown table not found");
        }

        const renderedRows = Array.from(table.querySelectorAll<HTMLElement>(".mtv-table-body-row"));
        const rowIndexes = renderedRows.map((row) => Number(
            row.querySelector<HTMLElement>("[data-markdown-table-row-index]")?.dataset.markdownTableRowIndex,
        )).filter((rowIndex) => Number.isFinite(rowIndex));

        return {
            isVirtualized: table.dataset.rowVirtualized === "true",
            totalBodyRows: Number(table.dataset.totalBodyRows ?? "0"),
            renderedBodyRows: Number(table.dataset.renderedBodyRows ?? "0"),
            renderedBodyCells: table.querySelectorAll(".mtv-table-body-cell").length,
            firstRenderedRowIndex: Math.min(...rowIndexes),
            lastRenderedRowIndex: Math.max(...rowIndexes),
        };
    });
}

async function setVisibleEditorScrollTop(page: Page, scrollTop: number): Promise<void> {
    await page.evaluate((nextScrollTop) => {
        const scroller = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active .cm-scroller");
        if (!scroller) {
            throw new Error("Editor scroller not found");
        }

        scroller.scrollTop = nextScrollTop;
        scroller.dispatchEvent(new Event("scroll"));
    }, scrollTop);
}

async function scrollToVirtualTableRow(page: Page, rowIndex: number): Promise<void> {
    await page.evaluate((targetRowIndex) => {
        const scroller = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active .cm-scroller");
        const widget = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active .cm-markdown-table-widget");
        const table = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active .mtv-table");
        if (!scroller || !widget || !table) {
            throw new Error("Virtual table scroll target not found");
        }

        const totalBodyRows = Number(table.dataset.totalBodyRows ?? "0");
        const firstSpacer = table.querySelector<HTMLElement>(".mtv-table-virtual-spacer-cell");
        const renderedRow = table.querySelector<HTMLElement>(".mtv-table-body-row");
        const firstRenderedRowHeight = renderedRow?.getBoundingClientRect().height ?? 38;
        const currentFirstRowIndex = Number(
            renderedRow?.querySelector<HTMLElement>("[data-markdown-table-row-index]")?.dataset.markdownTableRowIndex ?? "0",
        );
        const currentBeforeHeight = firstSpacer?.getBoundingClientRect().height ?? 0;
        const estimatedRowHeight = currentFirstRowIndex > 0
            ? currentBeforeHeight / currentFirstRowIndex
            : firstRenderedRowHeight;
        const safeRowIndex = Math.max(0, Math.min(targetRowIndex, totalBodyRows - 1));
        scroller.scrollTop = widget.offsetTop + table.offsetTop + estimatedRowHeight * safeRowIndex;
        scroller.dispatchEvent(new Event("scroll"));
    }, rowIndex);
}

test.describe("markdown table virtualization", () => {
    test.beforeEach(async ({ page }) => {
        await waitForMockWorkbench(page);
        await openMockNote(page, TABLE_NOTE_PATH);
    });

    test("1000-row table keeps DOM bounded while scrolling and editing", async ({ page }) => {
        test.slow();
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") {
                consoleErrors.push(message.text());
            }
        });

        await replaceActiveEditorDoc(page, createThousandRowMarkdownTable(), "Thousand Row Table");
        await expect(page.locator(".layout-v2-tab-section__card--active .cm-markdown-table-widget .mtv-table")).toBeVisible();
        await waitForEditorFrames(page, 4);

        const initialMetrics = await readVirtualizedTableMetrics(page);
        expect(initialMetrics.isVirtualized).toBe(true);
        expect(initialMetrics.totalBodyRows).toBe(1000);
        expect(initialMetrics.renderedBodyRows).toBeLessThan(80);
        expect(initialMetrics.renderedBodyCells).toBeLessThan(320);

        await page.locator(".layout-v2-tab-section__card--active .cm-markdown-table-widget").hover();
        await installPerformanceSampler(page);
        for (let stepIndex = 0; stepIndex < 18; stepIndex += 1) {
            await page.mouse.wheel(0, 900);
            await waitForEditorFrames(page, 1);
        }
        const scrollPerf = await stopPerformanceSampler(page);
        const afterScrollMetrics = await readVirtualizedTableMetrics(page);

        expect(afterScrollMetrics.renderedBodyRows).toBeLessThan(90);
        expect(afterScrollMetrics.renderedBodyCells).toBeLessThan(360);
        expect(afterScrollMetrics.firstRenderedRowIndex).toBeGreaterThan(initialMetrics.firstRenderedRowIndex);
        expect(scrollPerf.framesOver50).toBeLessThanOrEqual(5);
        expect(scrollPerf.longTaskMax).toBeLessThan(80);

        await scrollToVirtualTableRow(page, 520);
        await waitForEditorFrames(page, 4);
        const middleCell = page.locator("[data-markdown-table-row-index='520'][data-markdown-table-column-index='3']").first();
        await expect(middleCell).toBeVisible();
        await middleCell.click();
        await expect(page.locator(".mtv-cell-input:visible")).toBeFocused();

        await installPerformanceSampler(page);
        await page.keyboard.insertText(" edited");
        await waitForEditorFrames(page, 4);
        const editPerf = await stopPerformanceSampler(page);

        await expect(page.locator(".mtv-cell-input:visible")).toHaveValue(/edited$/);
        expect(editPerf.framesOver50).toBeLessThanOrEqual(1);
        expect(editPerf.longTaskMax).toBeLessThan(80);
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
    });
});
