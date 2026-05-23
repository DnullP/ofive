import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0&theme=light&glass=0";
const NOTE_PATH = "test-resources/notes/network-segment.md";

async function openFixtureNote(page: Page): Promise<void> {
    await gotoMockVaultPage(page, "side-panel-density", MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.getByTestId("activity-bar-item-files").click();
    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
    await page.locator(`.tree-item[data-tree-path='${NOTE_PATH}']`).click();
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
}

test.describe("right side panel density", () => {
    test("outline omits the active file header", async ({ page }) => {
        await openFixtureNote(page);

        await page.locator("[data-testid='sidebar-right'] [data-layout-panel-id='outline'][data-layout-role='panel']").click();

        const outlinePanel = page.locator(".outline-panel");
        await expect(outlinePanel).toBeVisible();
        await expect(outlinePanel.locator(".outline-panel-header")).toHaveCount(0);
        await expect(outlinePanel.locator(".outline-persisted-hint")).toHaveCount(0);

        const metrics = await outlinePanel.evaluate((panel) => {
            const list = panel.querySelector(".outline-list");
            return {
                listTop: list?.getBoundingClientRect().top ?? 0,
                panelTop: panel.getBoundingClientRect().top,
            };
        });

        expect(metrics.listTop - metrics.panelTop).toBeLessThanOrEqual(8);
    });

    test("backlinks keeps the count badge without a header row", async ({ page }) => {
        await openFixtureNote(page);

        await page.locator("[data-testid='sidebar-right'] [data-layout-panel-id='backlinks'][data-layout-role='panel']").click();

        const backlinksPanel = page.locator(".backlinks-panel");
        await expect(backlinksPanel).toBeVisible();
        await expect(backlinksPanel.locator(".backlinks-panel-header")).toHaveCount(0);

        const countBadge = backlinksPanel.locator(".backlinks-count");
        await expect(countBadge).toBeVisible();
        await expect(countBadge).toContainText(/Referenced by|被 \d+ 篇笔记引用/);

        const metrics = await backlinksPanel.evaluate((panel) => {
            const badge = panel.querySelector(".backlinks-count");
            const firstItem = panel.querySelector(".backlinks-item");
            const panelRect = panel.getBoundingClientRect();
            const badgeRect = badge?.getBoundingClientRect();
            const firstItemRect = firstItem?.getBoundingClientRect();
            return {
                badgeTop: badgeRect ? badgeRect.top - panelRect.top : 0,
                badgeRight: badgeRect ? panelRect.right - badgeRect.right : 0,
                firstItemTop: firstItemRect ? firstItemRect.top - panelRect.top : 0,
            };
        });

        expect(metrics.badgeTop).toBeLessThanOrEqual(8);
        expect(metrics.badgeRight).toBeLessThanOrEqual(10);
        expect(metrics.firstItemTop).toBeLessThanOrEqual(12);
    });
});
