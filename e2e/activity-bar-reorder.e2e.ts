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

interface ActivitySlotSnapshot {
    id: string;
    top: number;
    bottom: number;
    isBottomStart: boolean;
}

async function readLeftActivitySlots(page: Page): Promise<ActivitySlotSnapshot[]> {
    return page.evaluate(() => {
        const bar = document.querySelector<HTMLElement>(
            "[data-layout-role='activity-bar'][data-layout-bar-id='left-activity-bar']",
        );
        if (!bar) {
            throw new Error("left activity bar not found");
        }

        return Array.from(bar.querySelectorAll<HTMLElement>(".layout-v2-activity-bar__icon-slot"))
            .map((slot) => {
                const icon = slot.querySelector<HTMLElement>("[data-layout-role='activity-icon']");
                const id = icon?.getAttribute("data-layout-icon-id") ?? "";
                const rect = slot.getBoundingClientRect();
                return {
                    id,
                    top: rect.top,
                    bottom: rect.bottom,
                    isBottomStart: slot.classList.contains("layout-v2-activity-bar__icon-slot--bottom-start"),
                };
            })
            .filter((slot): slot is ActivitySlotSnapshot => slot.id.length > 0);
    });
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

async function startDragLastTopIconIntoBottomGap(page: Page): Promise<{
    bottomIconIds: string[];
    firstBottomTop: number;
}> {
    const beforeSlots = await readLeftActivitySlots(page);
    const firstBottomIndex = beforeSlots.findIndex((slot) => slot.isBottomStart);
    expect(firstBottomIndex).toBeGreaterThan(0);

    const lastTopSlot = beforeSlots[firstBottomIndex - 1];
    const firstBottomSlot = beforeSlots[firstBottomIndex];
    const source = page.getByTestId(`activity-bar-item-${lastTopSlot.id}`);
    const sourceBox = await source.boundingBox();
    expect(sourceBox).not.toBeNull();

    const startX = sourceBox!.x + sourceBox!.width / 2;
    const startY = sourceBox!.y + sourceBox!.height / 2;
    const targetX = startX;
    const targetY = Math.min(firstBottomSlot.top - 10, lastTopSlot.bottom + 16);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 8, { steps: 4 });
    await page.mouse.move(targetX, targetY, { steps: 16 });
    await waitForNextFrame(page);
    await waitForNextFrame(page);

    return {
        bottomIconIds: beforeSlots.slice(firstBottomIndex).map((slot) => slot.id),
        firstBottomTop: firstBottomSlot.top,
    };
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
        await expect(page.locator(
            "[data-layout-role='panel-content'][data-layout-panel-id='files'] " +
            ".layout-v2-panel-section__pane[data-layout-presentation-state='committed'] .file-tree",
        )).toBeVisible();
        await expectIconBefore(page, "search", "files");
        expect(pageErrors).toEqual([]);
    });

    test("keeps bottom-aligned icons stable while dragging the last top icon into the gap @mouse-drag", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        await gotoMockVaultPage(page, "activity-bar-bottom-gap-reorder", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);

        const before = await startDragLastTopIconIntoBottomGap(page);
        const duringSlots = await readLeftActivitySlots(page);
        const duringFirstBottomIndex = duringSlots.findIndex((slot) => slot.isBottomStart);
        expect(duringFirstBottomIndex).toBeGreaterThan(0);

        const duringBottomSlots = duringSlots.slice(duringFirstBottomIndex);
        expect(duringBottomSlots.map((slot) => slot.id)).toEqual(before.bottomIconIds);
        expect(Math.abs(duringBottomSlots[0].top - before.firstBottomTop)).toBeLessThanOrEqual(2);

        await page.mouse.up();
        await waitForNextFrame(page);
        expect(pageErrors).toEqual([]);
    });
});
