/**
 * @module e2e/editor-tab-header-collapse
 * @description 编辑器 tab header 随滚动方向收起/展开的回归测试。
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const SCROLL_NOTE_PATH = "test-resources/notes/scroll-regression.md";

async function waitForMockWorkbench(page: Page): Promise<void> {
    await gotoMockVaultPage(page, "editor-tab-header-collapse", MOCK_PAGE);
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

async function openScrollRegressionNote(page: Page): Promise<void> {
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${SCROLL_NOTE_PATH}']`).click();
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: "scroll-regression.md" }).waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
}

async function setActiveEditorScrollTop(page: Page, scrollTop: number): Promise<void> {
    await page.evaluate((nextScrollTop) => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active");
        const scroller = activeCard?.querySelector<HTMLElement>(".cm-scroller");
        if (!scroller) {
            throw new Error("CodeMirror scroller not found");
        }

        scroller.scrollTop = nextScrollTop;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, scrollTop);
}

test.describe("editor tab header scroll behavior", () => {
    test("向下滚动时收起，向上滚动时展开", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openScrollRegressionNote(page);

        const activeTab = page.locator(".layout-v2-tab-section__card--active .cm-tab");
        await expect(activeTab).not.toHaveClass(/cm-tab--header-collapsed/);

        await setActiveEditorScrollTop(page, 420);
        await expect(activeTab).toHaveClass(/cm-tab--header-collapsed/);

        await setActiveEditorScrollTop(page, 120);
        await expect(activeTab).not.toHaveClass(/cm-tab--header-collapsed/);
    });
});
