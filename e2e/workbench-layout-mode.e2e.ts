/**
 * @module e2e/workbench-layout-mode
 * @description 锚定当前主工作区入口为 layout-v2，避免旧 Dockview 残留误导清理。
 */

import { expect, test } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";

test.describe("workbench layout mode", () => {
    test("mock page should render layout-v2 and not expose old dockview host selectors", async ({ page }) => {
        await page.goto(MOCK_PAGE);

        await expect(page.locator("[data-workbench-layout-mode='layout-v2']")).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section")).toBeVisible();
        await expect(page.locator("[data-testid='main-dockview-host']")).toHaveCount(1);
        await expect(page.locator(".dockview-layout")).toHaveCount(0);
        await expect(page.locator(".dockview-theme-abyss")).toHaveCount(0);
        await expect(page.locator("[data-testid='main-dockview-host']")).toHaveAttribute("data-layout-tab-preview-render-mode", "inline");
    });

    test("mock page should keep tab and sidebar section chrome anchored at the top", async ({ page }) => {
        await page.goto(MOCK_PAGE);

        const metrics = await page.evaluate(() => {
            const workbench = document.querySelector<HTMLElement>("[data-workbench-layout-mode='layout-v2']");
            const tabStrip = document.querySelector<HTMLElement>(".layout-v2-tab-section__strip");
            const leftPanelBar = document.querySelector<HTMLElement>("[data-testid='sidebar-left'] .layout-v2-panel-section__bar");

            if (!workbench || !tabStrip || !leftPanelBar) {
                throw new Error("workbench chrome selectors missing");
            }

            const workbenchRect = workbench.getBoundingClientRect();
            const tabStripRect = tabStrip.getBoundingClientRect();
            const leftPanelBarRect = leftPanelBar.getBoundingClientRect();
            const rightPanelBar = document.querySelector<HTMLElement>("[data-testid='sidebar-right'] .layout-v2-panel-section__bar");
            const rightPanelBarRect = rightPanelBar?.getBoundingClientRect() ?? null;

            return {
                workbenchTop: workbenchRect.top,
                tabStripTop: tabStripRect.top,
                leftPanelBarTop: leftPanelBarRect.top,
                tabStripHeight: tabStripRect.height,
                leftPanelBarHeight: leftPanelBarRect.height,
                tabStripDragRegion: tabStrip.getAttribute("data-tauri-drag-region"),
                leftPanelBarDragRegion: leftPanelBar.getAttribute("data-tauri-drag-region"),
                rightPanelBarTop: rightPanelBarRect?.top ?? null,
                rightPanelBarHeight: rightPanelBarRect?.height ?? null,
                rightPanelBarDragRegion: rightPanelBar?.getAttribute("data-tauri-drag-region") ?? null,
            };
        });

        expect(metrics.tabStripTop).toBeCloseTo(metrics.workbenchTop, 1);
        expect(metrics.leftPanelBarTop).toBeCloseTo(metrics.workbenchTop, 1);
        expect(metrics.tabStripHeight).toBeGreaterThanOrEqual(38);
        expect(metrics.leftPanelBarHeight).toBeGreaterThanOrEqual(38);
        expect(metrics.tabStripDragRegion).not.toBeNull();
        expect(metrics.leftPanelBarDragRegion).not.toBeNull();
        if (metrics.rightPanelBarTop !== null && metrics.rightPanelBarHeight !== null) {
            expect(metrics.rightPanelBarTop).toBeCloseTo(metrics.workbenchTop, 1);
            expect(metrics.rightPanelBarHeight).toBeGreaterThanOrEqual(38);
            expect(metrics.rightPanelBarDragRegion).not.toBeNull();
        }
    });

    test("real app shell should keep the titlebar out of layout flow", async ({ page }) => {
        await page.goto("/");

        await expect(page.locator(".app-shell")).toBeVisible();
        await expect(page.locator(".app-titlebar")).toBeVisible();
        await expect(page.locator("[data-workbench-layout-mode='layout-v2']")).toBeVisible();

        const metrics = await page.evaluate(() => {
            const shell = document.querySelector<HTMLElement>(".app-shell");
            const titlebar = document.querySelector<HTMLElement>(".app-titlebar");
            const content = document.querySelector<HTMLElement>(".app-content");

            if (!shell || !titlebar || !content) {
                throw new Error("app shell selectors missing");
            }

            const shellRect = shell.getBoundingClientRect();
            const titlebarRect = titlebar.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            const titlebarStyle = window.getComputedStyle(titlebar);

            return {
                shellTop: shellRect.top,
                titlebarTop: titlebarRect.top,
                titlebarHeight: titlebarRect.height,
                titlebarPosition: titlebarStyle.position,
                contentTop: contentRect.top,
            };
        });

        expect(metrics.titlebarPosition).toBe("absolute");
        expect(metrics.titlebarTop).toBeCloseTo(metrics.shellTop, 1);
        expect(metrics.contentTop).toBeCloseTo(metrics.shellTop, 1);
        expect(metrics.titlebarHeight).toBeGreaterThan(0);
    });
});
