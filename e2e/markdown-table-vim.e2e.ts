import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const TABLE_NOTE_PATH = "test-resources/notes/table-editor.md";
const TABLE_BOUNDARY_NOTE_PATH = "test-resources/notes/table-vim-boundary.md";

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