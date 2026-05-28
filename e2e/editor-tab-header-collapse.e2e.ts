/**
 * @module e2e/editor-tab-header-collapse
 * @description 编辑器 tab header 随滚动方向收起/展开的回归测试。
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const LIGHT_THEME_MOCK_PAGE = `${MOCK_PAGE}&theme=light`;
const SCROLL_NOTE_PATH = "test-resources/notes/scroll-regression.md";

async function waitForMockWorkbench(page: Page, mockPage = MOCK_PAGE): Promise<void> {
    await gotoMockVaultPage(page, "editor-tab-header-collapse", mockPage);
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

async function readActiveEditorHostTop(page: Page): Promise<number> {
    return page.evaluate(() => {
        const host = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active .cm-tab-editor");
        if (!host) {
            throw new Error("CodeMirror host not found");
        }

        return host.getBoundingClientRect().top;
    });
}

test.describe("editor tab header scroll behavior", () => {
    test("标题输入框使用白色实底，避免与正文透底重叠", async ({ page }) => {
        await waitForMockWorkbench(page, LIGHT_THEME_MOCK_PAGE);
        await openScrollRegressionNote(page);

        const titleInput = page.locator(".layout-v2-tab-section__card--active .cm-tab-title-input");
        await expect(titleInput).toHaveCSS("background-color", "rgb(255, 255, 255)");
    });

    test("标题白底不会覆盖编辑器右侧滚动条", async ({ page }) => {
        await waitForMockWorkbench(page, LIGHT_THEME_MOCK_PAGE);
        await openScrollRegressionNote(page);

        const hitTest = await page.evaluate(() => {
            const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active");
            const scroller = activeCard?.querySelector<HTMLElement>(".cm-scroller");
            const header = activeCard?.querySelector<HTMLElement>(".cm-tab-header");
            if (!scroller || !header) {
                throw new Error("Editor scroller or header not found");
            }

            const scrollerRect = scroller.getBoundingClientRect();
            const headerRect = header.getBoundingClientRect();
            const target = document.elementFromPoint(
                scrollerRect.right - 4,
                headerRect.top + Math.min(20, headerRect.height / 2),
            );

            return {
                headerRight: headerRect.right,
                scrollerRight: scrollerRect.right,
                hitClassName: target instanceof HTMLElement ? target.className : "",
                headerOwnsHit: target instanceof HTMLElement ? header.contains(target) : false,
            };
        });

        expect(hitTest.headerRight).toBeLessThanOrEqual(hitTest.scrollerRight - 12);
        expect(hitTest.headerOwnsHit).toBe(false);
        expect(String(hitTest.hitClassName)).not.toContain("cm-tab-title-input");
    });

    test("超过阈值后防抖收起/展开，且不推动 editor 区域", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openScrollRegressionNote(page);

        const activeTab = page.locator(".layout-v2-tab-section__card--active .cm-tab");
        await expect(activeTab).not.toHaveClass(/cm-tab--header-collapsed/);
        const editorTopBeforeCollapse = await readActiveEditorHostTop(page);

        await setActiveEditorScrollTop(page, 40);
        await page.waitForTimeout(140);
        await expect(activeTab).not.toHaveClass(/cm-tab--header-collapsed/);

        await setActiveEditorScrollTop(page, 420);
        await expect(activeTab).toHaveClass(/cm-tab--header-collapsed/);
        const editorTopAfterCollapse = await readActiveEditorHostTop(page);
        expect(Math.abs(editorTopAfterCollapse - editorTopBeforeCollapse)).toBeLessThanOrEqual(1);

        await setActiveEditorScrollTop(page, 340);
        await expect(activeTab).not.toHaveClass(/cm-tab--header-collapsed/);
    });
});
