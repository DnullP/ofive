import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const SCROLL_NOTE_PATH = "test-resources/notes/scroll-regression.md";
const ALT_SCROLL_NOTE_PATH = "test-resources/notes/scroll-regression-alt.md";

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
        expect((await readVisibleEditorState(page)).title).toBe("scroll-regression");

        await page.getByRole("button", { name: "scroll-regression-alt.md" }).first().click();
        expect((await readVisibleEditorState(page)).title).toBe("scroll-regression-alt");

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        expect((await readVisibleEditorState(page)).title).toBe("scroll-regression");
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