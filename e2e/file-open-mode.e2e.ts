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
const CANVAS_NOTE_PATH = "test-resources/notes/glass-validation.canvas";
const IMAGE_NOTE_PATH = "test-resources/notes/mock-image.png";

type FileOpenMode = "new-tab" | "replace-active-tab";
type MockTabKind = "markdown" | "canvas" | "image";

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

async function expectActiveFileContent(page: Page, relativePath: string, kind: MockTabKind): Promise<void> {
    await expectFocusedTab(page, noteTitle(relativePath));

    if (kind === "markdown") {
        await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
        return;
    }

    if (kind === "canvas") {
        await expect(page.locator(".layout-v2-tab-section__card--active .canvas-tab")).toBeVisible();
        await page.locator(".layout-v2-tab-section__card--active .canvas-tab__surface").waitFor({ state: "visible" });
        return;
    }

    await expect(page.locator(".layout-v2-tab-section__card--active .image-viewer-tab")).toBeVisible();
    await expect(page.locator(".layout-v2-tab-section__card--active .image-viewer-header")).toHaveText(relativePath);
}

async function openMockFileFromTree(page: Page, relativePath: string, kind: MockTabKind): Promise<void> {
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    await expect(page.locator(".layout-v2-tab-section__tab", { hasText: noteTitle(relativePath) })).toBeVisible();
    await expectActiveFileContent(page, relativePath, kind);
}

async function openMockNoteFromTree(page: Page, relativePath: string): Promise<void> {
    await openMockFileFromTree(page, relativePath, "markdown");
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

function tabNavigationButton(page: Page, label: "Previous browse" | "Next browse") {
    return page.locator(".layout-v2-tab-section__card--active").getByLabel(label);
}

async function navigateAndExpect(
    page: Page,
    direction: "Previous browse" | "Next browse",
    relativePath: string,
    kind: MockTabKind,
): Promise<void> {
    await tabNavigationButton(page, direction).click();
    await expectActiveFileContent(page, relativePath, kind);
    expect(await readFileTabTitles(page)).toEqual([noteTitle(relativePath)]);
    await expect(page.locator(".layout-v2-tab-section__presentation-pending")).toHaveCount(0);
}

async function clickNavigationRapidly(page: Page, direction: "Previous browse" | "Next browse", count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
        await tabNavigationButton(page, direction).click();
    }
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
        await expect(tabNavigationButton(page, "Previous browse")).toBeDisabled();
        await expect(tabNavigationButton(page, "Next browse")).toBeDisabled();

        await clickNetworkSegmentWikiLink(page);
        await expectFocusedTab(page, noteTitle(TARGET_NOTE_PATH));
        expect(await readFileTabTitles(page)).toEqual([noteTitle(TARGET_NOTE_PATH)]);
        await expect(tabNavigationButton(page, "Previous browse")).toBeEnabled();
        await expect(tabNavigationButton(page, "Next browse")).toBeDisabled();

        await openMockNoteFromTree(page, GUIDE_NOTE_PATH);
        await expectFocusedTab(page, noteTitle(GUIDE_NOTE_PATH));
        expect(await readFileTabTitles(page)).toEqual([noteTitle(GUIDE_NOTE_PATH)]);

        const previousButton = tabNavigationButton(page, "Previous browse");
        await previousButton.click();
        await previousButton.click();
        await expectFocusedTab(page, noteTitle(SOURCE_NOTE_PATH));
        expect(await readFileTabTitles(page)).toEqual([noteTitle(SOURCE_NOTE_PATH)]);
        await expect(page.locator(".layout-v2-tab-section__presentation-pending")).toHaveCount(0);
        await expect(tabNavigationButton(page, "Previous browse")).toBeDisabled();
        await expect(tabNavigationButton(page, "Next browse")).toBeEnabled();

        await tabNavigationButton(page, "Next browse").click();
        await expectFocusedTab(page, noteTitle(TARGET_NOTE_PATH));
        expect(await readFileTabTitles(page)).toEqual([noteTitle(TARGET_NOTE_PATH)]);

        await tabNavigationButton(page, "Previous browse").click();
        await expectFocusedTab(page, noteTitle(SOURCE_NOTE_PATH));
        expect(await readFileTabTitles(page)).toEqual([noteTitle(SOURCE_NOTE_PATH)]);
        await expect(tabNavigationButton(page, "Previous browse")).toBeDisabled();
        await expect(tabNavigationButton(page, "Next browse")).toBeEnabled();

        await tabNavigationButton(page, "Next browse").click();
        await expectFocusedTab(page, noteTitle(TARGET_NOTE_PATH));
        expect(await readFileTabTitles(page)).toEqual([noteTitle(TARGET_NOTE_PATH)]);
    });

    test("replace-active-tab navigation handles mixed tab types through continuous and alternating history jumps", async ({ page }) => {
        await waitForMockWorkbench(page, "file-open-mode-mixed-tab-history");
        await setFileOpenMode(page, "replace-active-tab");

        await openMockFileFromTree(page, SOURCE_NOTE_PATH, "markdown");
        await openMockFileFromTree(page, CANVAS_NOTE_PATH, "canvas");
        await openMockFileFromTree(page, IMAGE_NOTE_PATH, "image");
        await openMockFileFromTree(page, GUIDE_NOTE_PATH, "markdown");
        expect(await readFileTabTitles(page)).toEqual([noteTitle(GUIDE_NOTE_PATH)]);

        await navigateAndExpect(page, "Previous browse", IMAGE_NOTE_PATH, "image");
        await navigateAndExpect(page, "Previous browse", CANVAS_NOTE_PATH, "canvas");
        await navigateAndExpect(page, "Previous browse", SOURCE_NOTE_PATH, "markdown");
        await expect(tabNavigationButton(page, "Previous browse")).toBeDisabled();
        await expect(tabNavigationButton(page, "Next browse")).toBeEnabled();

        await clickNavigationRapidly(page, "Next browse", 3);
        await expectActiveFileContent(page, GUIDE_NOTE_PATH, "markdown");
        expect(await readFileTabTitles(page)).toEqual([noteTitle(GUIDE_NOTE_PATH)]);
        await expect(page.locator(".layout-v2-tab-section__presentation-pending")).toHaveCount(0);
        await expect(tabNavigationButton(page, "Previous browse")).toBeEnabled();
        await expect(tabNavigationButton(page, "Next browse")).toBeDisabled();

        await navigateAndExpect(page, "Previous browse", IMAGE_NOTE_PATH, "image");
        await navigateAndExpect(page, "Next browse", GUIDE_NOTE_PATH, "markdown");
        await navigateAndExpect(page, "Previous browse", IMAGE_NOTE_PATH, "image");
        await navigateAndExpect(page, "Previous browse", CANVAS_NOTE_PATH, "canvas");
        await navigateAndExpect(page, "Next browse", IMAGE_NOTE_PATH, "image");
    });
});
