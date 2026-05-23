import { expect, test } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0&theme=light&glass=0";

test.describe("search panel layout", () => {
    test("keeps the empty search controls compact in the sidebar", async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });

        await page.getByTestId("activity-bar-item-search").click();

        const searchPanel = page.locator(".search-panel");
        await expect(searchPanel).toBeVisible();

        const metrics = await searchPanel.evaluate((panel) => {
            const toolbar = panel.querySelector(".search-toolbar");
            const filterRow = panel.querySelector(".search-filter-row");
            const fileNameButton = Array.from(panel.querySelectorAll(".search-scope-button"))
                .find((button) => ["文件名", "File Name"].includes(button.textContent?.trim() ?? ""));
            const emptyState = panel.querySelector(".search-empty");

            return {
                panelClientWidth: panel.clientWidth,
                panelScrollWidth: panel.scrollWidth,
                toolbarHeight: toolbar?.getBoundingClientRect().height ?? 0,
                filterRowHeight: filterRow?.getBoundingClientRect().height ?? 0,
                fileNameButtonHeight: fileNameButton?.getBoundingClientRect().height ?? 0,
                emptyStateHeight: emptyState?.getBoundingClientRect().height ?? 0,
            };
        });

        expect(metrics.panelScrollWidth).toBeLessThanOrEqual(metrics.panelClientWidth + 1);
        expect(metrics.toolbarHeight).toBeLessThanOrEqual(132);
        expect(metrics.filterRowHeight).toBeLessThanOrEqual(34);
        expect(metrics.fileNameButtonHeight).toBeLessThanOrEqual(32);
        expect(metrics.emptyStateHeight).toBeLessThanOrEqual(50);
    });
});
