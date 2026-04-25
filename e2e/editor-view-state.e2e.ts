import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const SCROLL_NOTE_PATH = "test-resources/notes/scroll-regression.md";
const ALT_SCROLL_NOTE_PATH = "test-resources/notes/scroll-regression-alt.md";
const FRONTMATTER_NOTE_PATH = "test-resources/notes/network-segment.md";

async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
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

async function openMockNote(page: Page, relativePath: string): Promise<void> {
    await expandMockNotes(page);
    const fileName = relativePath.split("/").pop() ?? relativePath;
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    await page.getByRole("button", { name: fileName }).first().waitFor({ state: "visible" });
}

async function clickVisibleEditor(page: Page, offsetX: number, offsetY: number): Promise<void> {
    const editor = page.locator(".layout-v2-tab-section__card[aria-hidden='false'] .cm-editor").first();
    const box = await editor.boundingBox();
    if (!box) {
        throw new Error("clickVisibleEditor: editor bounds missing");
    }

    await page.mouse.click(box.x + offsetX, box.y + offsetY);
}

async function setVisibleEditorScrollTop(page: Page, scrollTop: number): Promise<void> {
    await page.evaluate((nextScrollTop) => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card[aria-hidden='false']");
        const editor = activeCard?.querySelector<HTMLElement>(".cm-editor") ?? null;
        const scroller = editor?.querySelector(".cm-scroller");
        if (scroller instanceof HTMLElement) {
            scroller.scrollTop = nextScrollTop;
        }
    }, scrollTop);
}

async function readVisibleEditorState(page: Page): Promise<{
    title: string | null;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    selectionCollapsed: boolean;
    selectionText: string;
    editorHasFocus: boolean;
}> {
    return page.evaluate(() => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card[aria-hidden='false']");
        const editor = activeCard?.querySelector<HTMLElement>(".cm-editor") ?? null;
        if (!editor) {
            throw new Error("readVisibleEditorState: visible editor missing");
        }

        const scroller = editor.querySelector(".cm-scroller");
        const titleInput = activeCard?.querySelector(".cm-tab-title-input");
        const selection = document.getSelection();

        return {
            title: titleInput instanceof HTMLInputElement ? titleInput.value : null,
            scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : 0,
            scrollHeight: scroller instanceof HTMLElement ? scroller.scrollHeight : 0,
            clientHeight: scroller instanceof HTMLElement ? scroller.clientHeight : 0,
            selectionCollapsed: selection?.isCollapsed ?? true,
            selectionText: selection?.toString() ?? "",
            editorHasFocus: editor.contains(document.activeElement),
        };
    });
}

async function waitForVisibleEditorTitle(page: Page, expectedTitle: string): Promise<void> {
    await expect.poll(async () => (await readVisibleEditorState(page)).title).toBe(expectedTitle);
}

async function readVisibleEditorFrontmatterState(page: Page): Promise<{
    frontmatterWidgetCount: number;
    hiddenLineCount: number;
    hiddenAnchorCount: number;
}> {
    return page.evaluate(() => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card[aria-hidden='false']");
        if (!activeCard) {
            throw new Error("readVisibleEditorFrontmatterState: visible editor missing");
        }

        return {
            frontmatterWidgetCount: activeCard.querySelectorAll(".cm-frontmatter-widget").length,
            hiddenLineCount: activeCard.querySelectorAll(".cm-hidden-block-line").length,
            hiddenAnchorCount: activeCard.querySelectorAll(".cm-hidden-block-anchor-line").length,
        };
    });
}

async function startFrontmatterPresentationMonitor(page: Page): Promise<void> {
    await page.evaluate(() => {
        const monitorKey = "__OFIVE_FRONTMATTER_PRESENTATION_MONITOR__";
        const existingMonitor = (window as any)[monitorKey];
        if (existingMonitor?.stop) {
            existingMonitor.stop();
        }

        const samples: Array<{
            title: string | null;
            presentationState: string | null;
            frontmatterWidgetCount: number;
            hiddenLineCount: number;
            rawVisibleDelimiterCount: number;
        }> = [];
        let frameId = 0;

        const isRenderedElementVisible = (element: HTMLElement): boolean => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };

        const readRawVisibleDelimiterCount = (activeCard: HTMLElement): number => {
            return Array.from(activeCard.querySelectorAll<HTMLElement>(".cm-line"))
                .filter((lineElement) => {
                    if (lineElement.textContent?.trim() !== "---") {
                        return false;
                    }

                    if (
                        lineElement.classList.contains("cm-hidden-block-line") ||
                        lineElement.classList.contains("cm-hidden-block-anchor-line")
                    ) {
                        return false;
                    }

                    return isRenderedElementVisible(lineElement);
                }).length;
        };

        const sample = (): void => {
            const activeEditorCard = Array.from(document.querySelectorAll<HTMLElement>(
                ".layout-v2-tab-section__card[aria-hidden='false']",
            )).find((card) => card.querySelector(".cm-editor"));

            if (activeEditorCard) {
                const titleInput = activeEditorCard.querySelector<HTMLInputElement>(".cm-tab-title-input");
                samples.push({
                    title: titleInput instanceof HTMLInputElement ? titleInput.value : null,
                    presentationState: activeEditorCard.dataset.layoutPresentationState ?? null,
                    frontmatterWidgetCount: activeEditorCard.querySelectorAll(".cm-frontmatter-widget .fmv-editor").length,
                    hiddenLineCount: activeEditorCard.querySelectorAll(".cm-hidden-block-line").length,
                    rawVisibleDelimiterCount: readRawVisibleDelimiterCount(activeEditorCard),
                });
            }

            frameId = window.requestAnimationFrame(sample);
        };

        frameId = window.requestAnimationFrame(sample);
        (window as any)[monitorKey] = {
            samples,
            stop: () => window.cancelAnimationFrame(frameId),
        };
    });
}

async function stopFrontmatterPresentationMonitor(page: Page): Promise<Array<{
    title: string | null;
    presentationState: string | null;
    frontmatterWidgetCount: number;
    hiddenLineCount: number;
    rawVisibleDelimiterCount: number;
}>> {
    return page.evaluate(() => {
        const monitorKey = "__OFIVE_FRONTMATTER_PRESENTATION_MONITOR__";
        const monitor = (window as any)[monitorKey];
        if (!monitor) {
            return [];
        }

        monitor.stop();
        return monitor.samples;
    });
}

async function updateEditorTabRestoreMode(page: Page, nextMode: "viewport" | "cursor"): Promise<void> {
    await page.evaluate(async (mode) => {
        const configStoreModule = await import("/src/host/config/configStore.ts");
        await configStoreModule.updateFeatureSetting("editorTabRestoreMode", mode);
    }, nextMode);
}

async function waitForEditorActivationFrame(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
        });
    }));
}

test.describe("editor view state regression", () => {
    test.beforeEach(async ({ page }) => {
        await waitForMockWorkbench(page);
        await updateEditorTabRestoreMode(page, "viewport");
    });

    test("switching editor tabs updates the visible title to the active file", async ({ page }) => {
        await openMockNote(page, SCROLL_NOTE_PATH);
        await openMockNote(page, ALT_SCROLL_NOTE_PATH);

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression");

        await page.getByRole("button", { name: "scroll-regression-alt.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression-alt");

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression");
    });

    test("viewport mode keeps frontmatter collapsed on first open", async ({ page }) => {
        await startFrontmatterPresentationMonitor(page);
        await openMockNote(page, FRONTMATTER_NOTE_PATH);
        await waitForEditorActivationFrame(page);

        const frontmatterState = await readVisibleEditorFrontmatterState(page);
        expect(frontmatterState.frontmatterWidgetCount).toBe(1);
        expect(frontmatterState.hiddenLineCount).toBeGreaterThan(0);
        expect(frontmatterState.hiddenAnchorCount).toBe(1);

        const samples = await stopFrontmatterPresentationMonitor(page);
        const editorSamples = samples.filter((sample) => sample.title === "network-segment");
        expect(editorSamples.length).toBeGreaterThan(0);
        expect(editorSamples.every((sample) => sample.presentationState === "committed")).toBe(true);
        expect(editorSamples.every((sample) => sample.frontmatterWidgetCount === 1)).toBe(true);
        expect(editorSamples.every((sample) => sample.hiddenLineCount > 0)).toBe(true);
        expect(editorSamples.every((sample) => sample.rawVisibleDelimiterCount === 0)).toBe(true);
    });

    test("viewport restore mode preserves reading progress without restoring editor focus", async ({ page }) => {
        await openMockNote(page, SCROLL_NOTE_PATH);
        await openMockNote(page, ALT_SCROLL_NOTE_PATH);

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await clickVisibleEditor(page, 140, 92);
        await setVisibleEditorScrollTop(page, 2800);

        const beforeSwitch = await readVisibleEditorState(page);
        expect(beforeSwitch.title).toBe("scroll-regression");
        expect(beforeSwitch.scrollTop).toBeGreaterThan(2600);
        expect(beforeSwitch.scrollHeight - beforeSwitch.clientHeight).toBeGreaterThan(2600);

        await page.getByRole("button", { name: "scroll-regression-alt.md" }).first().click();
        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression");

        const afterSwitch = await readVisibleEditorState(page);
        expect(afterSwitch.title).toBe("scroll-regression");
        expect(Math.abs(afterSwitch.scrollTop - beforeSwitch.scrollTop)).toBeLessThan(48);
        expect(afterSwitch.editorHasFocus).toBe(false);

        await clickVisibleEditor(page, 220, 320);

        const afterRefocus = await readVisibleEditorState(page);
        expect(afterRefocus.title).toBe("scroll-regression");
        expect(Math.abs(afterRefocus.scrollTop - beforeSwitch.scrollTop)).toBeLessThan(96);
        expect(afterRefocus.editorHasFocus).toBe(true);
    });

    test("cursor restore mode refocuses the editor and reveals the saved caret position", async ({ page }) => {
        await updateEditorTabRestoreMode(page, "cursor");
        await openMockNote(page, SCROLL_NOTE_PATH);
        await openMockNote(page, ALT_SCROLL_NOTE_PATH);

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await clickVisibleEditor(page, 40, 24);
        await setVisibleEditorScrollTop(page, 2800);

        const beforeSwitch = await readVisibleEditorState(page);
        expect(beforeSwitch.scrollTop).toBeGreaterThan(2600);

        await page.getByRole("button", { name: "scroll-regression-alt.md" }).first().click();
        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression");
        await waitForEditorActivationFrame(page);

        const afterSwitch = await readVisibleEditorState(page);
        expect(afterSwitch.title).toBe("scroll-regression");
        expect(afterSwitch.scrollTop).toBeLessThan(240);
        expect(afterSwitch.editorHasFocus).toBe(true);
    });

    test("home tab switch restores editor reading progress immediately", async ({ page }) => {
        await openMockNote(page, SCROLL_NOTE_PATH);

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await clickVisibleEditor(page, 140, 92);
        await setVisibleEditorScrollTop(page, 2800);

        const beforeSwitch = await readVisibleEditorState(page);
        expect(beforeSwitch.title).toBe("scroll-regression");
        expect(beforeSwitch.scrollTop).toBeGreaterThan(2600);

        await page.getByRole("button", { name: "首页" }).first().click();
        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression");

        const afterSwitch = await readVisibleEditorState(page);
        expect(afterSwitch.title).toBe("scroll-regression");
        expect(Math.abs(afterSwitch.scrollTop - beforeSwitch.scrollTop)).toBeLessThan(96);
    });

    test("sidebar activity switch does not yank editor scroll or create a range selection", async ({ page }) => {
        await openMockNote(page, SCROLL_NOTE_PATH);
        await clickVisibleEditor(page, 140, 92);
        await setVisibleEditorScrollTop(page, 2800);

        const beforeSidebarSwitch = await readVisibleEditorState(page);
        await page.locator("[data-testid='sidebar-right'] [data-layout-panel-id='ai-chat-mock'][data-layout-role='panel']").click();
        await page.locator("[data-testid='sidebar-right'] [data-layout-panel-id='outline'][data-layout-role='panel']").click();
        await clickVisibleEditor(page, 320, 360);

        const afterSidebarSwitch = await readVisibleEditorState(page);
        expect(afterSidebarSwitch.selectionCollapsed).toBe(true);
        expect(afterSidebarSwitch.selectionText).toBe("");
        expect(afterSidebarSwitch.scrollTop).toBeGreaterThan(beforeSidebarSwitch.scrollTop - 120);
    });
});