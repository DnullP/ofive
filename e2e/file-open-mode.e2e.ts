/**
 * @module e2e/file-open-mode
 * @description WikiLink 与文件树打开笔记时的新标签/原地替换设置回归测试。
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const SOURCE_NOTE_PATH = "test-resources/notes/open-mode-source.md";
const TARGET_NOTE_PATH = "test-resources/notes/network-segment.md";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";

type FileOpenMode = "new-tab" | "replace-active-tab";

async function waitForMockWorkbench(page: Page, testName: string): Promise<void> {
    await gotoMockVaultPage(page, testName, MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-left']").waitFor({ state: "visible" });
    await page.getByTestId("activity-bar-item-files").waitFor({ state: "visible" });
}

async function setFileOpenMode(page: Page, mode: FileOpenMode): Promise<void> {
    await page.evaluate(async (nextMode) => {
        const configStore = await import("/src/host/config/configStore.ts");
        await configStore.updateFeatureSetting("fileOpenMode", nextMode);
    }, mode);
}

async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

function noteTitle(relativePath: string): string {
    return relativePath.split("/").pop() ?? relativePath;
}

async function openMockNoteFromTree(page: Page, relativePath: string): Promise<void> {
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    await expect(page.locator(".layout-v2-tab-section__tab", { hasText: noteTitle(relativePath) })).toBeVisible();
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
}

async function clickNetworkSegmentWikiLink(page: Page): Promise<void> {
    const link = page.locator(".layout-v2-tab-section__card--active .cm-rendered-wikilink", {
        hasText: "network-segment",
    }).first();
    await link.waitFor({ state: "visible" });
    await link.click();
    await expect(page.locator(".layout-v2-tab-section__tab", { hasText: noteTitle(TARGET_NOTE_PATH) })).toBeVisible();
}

async function readFileTabTitles(page: Page): Promise<string[]> {
    return page.locator(".layout-v2-tab-section__tab-main[data-layout-tab-id^='file:'] .layout-v2-tab-section__tab-title").evaluateAll((nodes) =>
        nodes.map((node) => node.textContent?.trim() ?? "").filter(Boolean),
    );
}

async function expectFocusedTab(page: Page, title: string): Promise<void> {
    await expect(page.locator(".layout-v2-tab-section__tab--focused", { hasText: title })).toBeVisible();
}

test.describe("file open mode", () => {
    test("new-tab mode keeps the focused note and opens WikiLink/file-tree targets in new tabs", async ({ page }) => {
        await waitForMockWorkbench(page, "file-open-mode-new-tab");
        await setFileOpenMode(page, "new-tab");

        await openMockNoteFromTree(page, SOURCE_NOTE_PATH);
        await clickNetworkSegmentWikiLink(page);
        await expectFocusedTab(page, noteTitle(TARGET_NOTE_PATH));

        await openMockNoteFromTree(page, GUIDE_NOTE_PATH);
        await expectFocusedTab(page, noteTitle(GUIDE_NOTE_PATH));

        const titles = await readFileTabTitles(page);
        expect(titles).toEqual(expect.arrayContaining([
            noteTitle(SOURCE_NOTE_PATH),
            noteTitle(TARGET_NOTE_PATH),
            noteTitle(GUIDE_NOTE_PATH),
        ]));
    });

    test("replace-active-tab mode reuses the focused file tab for WikiLink and file-tree targets", async ({ page }) => {
        await waitForMockWorkbench(page, "file-open-mode-replace-active-tab");
        await setFileOpenMode(page, "replace-active-tab");

        await openMockNoteFromTree(page, SOURCE_NOTE_PATH);
        expect(await readFileTabTitles(page)).toEqual([noteTitle(SOURCE_NOTE_PATH)]);

        await clickNetworkSegmentWikiLink(page);
        await expectFocusedTab(page, noteTitle(TARGET_NOTE_PATH));
        expect(await readFileTabTitles(page)).toEqual([noteTitle(TARGET_NOTE_PATH)]);

        await openMockNoteFromTree(page, GUIDE_NOTE_PATH);
        await expectFocusedTab(page, noteTitle(GUIDE_NOTE_PATH));
        expect(await readFileTabTitles(page)).toEqual([noteTitle(GUIDE_NOTE_PATH)]);
    });
});
