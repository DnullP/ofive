/**
 * @module e2e/activity-bar-reorder
 * @description Activity icon 拖拽排序后切换 activity 的回归测试。
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

async function waitForWorkbench(page: Page): Promise<void> {
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-left']").waitFor({ state: "visible" });
    await page.getByTestId("activity-bar-item-files").waitFor({ state: "visible" });
    await page.getByTestId("activity-bar-item-search").waitFor({ state: "visible" });
}

async function waitForNextFrame(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function readLeftActivityOrder(page: Page): Promise<string[]> {
    return page
        .locator("[data-layout-role='activity-icon'][data-layout-bar-id='left-activity-bar']")
        .evaluateAll((items) => items
            .map((item) => item.getAttribute("data-layout-icon-id"))
            .filter((id): id is string => typeof id === "string" && id.length > 0));
}

async function expectIconBefore(page: Page, iconId: string, beforeIconId: string): Promise<void> {
    await expect.poll(async () => {
        const order = await readLeftActivityOrder(page);
        return order.indexOf(iconId) >= 0 && order.indexOf(beforeIconId) >= 0
            ? order.indexOf(iconId) < order.indexOf(beforeIconId)
            : false;
    }).toBe(true);
}

async function dragIconBefore(page: Page, source: Locator, target: Locator): Promise<void> {
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const startX = sourceBox!.x + sourceBox!.width / 2;
    const startY = sourceBox!.y + sourceBox!.height / 2;
    const targetX = targetBox!.x + targetBox!.width / 2;
    const targetY = targetBox!.y + 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 10, { steps: 4 });
    await page.mouse.move(targetX, targetY, { steps: 18 });
    await waitForNextFrame(page);
    await page.mouse.up();
    await waitForNextFrame(page);
}

test.describe("activity bar reorder", () => {
    test("keeps dragged activity order while switching icons", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        await gotoMockVaultPage(page, "activity-bar-reorder", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);

        const filesButton = page.getByTestId("activity-bar-item-files");
        const searchButton = page.getByTestId("activity-bar-item-search");

        await dragIconBefore(page, searchButton, filesButton);
        await expectIconBefore(page, "search", "files");

        await searchButton.click();
        await expect(page.locator("[data-layout-role='panel-content'][data-layout-panel-id='search']")).toBeVisible();
        await expectIconBefore(page, "search", "files");

        await filesButton.click();
        await expect(page.locator(".file-tree")).toBeVisible();
        await expectIconBefore(page, "search", "files");
        expect(pageErrors).toEqual([]);
    });
});
