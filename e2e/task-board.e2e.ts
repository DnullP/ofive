/**
 * @module e2e/task-board
 * @description 任务看板联动 E2E：覆盖图标打开、全仓查询、气泡编辑和文件回写。
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/mockVault
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

/**
 * @function waitForLayoutReady
 * @description 等待主布局进入可交互状态。
 * @param page Playwright 页面对象。
 */
async function waitForLayoutReady(page: Page): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await page.locator(".dv-tab").first().waitFor({ state: "visible" });
}

test.describe("任务看板", () => {
    test("应支持通过 icon 打开、查询任务并通过气泡框修改元数据", async ({ page }) => {
        await gotoMockVaultPage(page, "task-board-e2e");
        await waitForLayoutReady(page);

        const activityButton = page.getByTestId("activity-bar-item-task-board");
        await expect(activityButton).toBeVisible();
        await activityButton.click();

        await expect(page.locator(".task-board")).toBeVisible();
        await expect(page.locator(".task-board")).toContainText(/2 tasks|2 个任务/);
        await page.getByRole("button", { name: /All|全部/ }).click();
        await expect(page.locator(".task-board__task-card")).toHaveCount(2);
        await expect(page.locator(".task-board__task-card", { hasText: "Verify task board flow" })).toBeVisible();
        await expect(page.locator(".task-board__task-card", { hasText: "Completed task" })).toBeVisible();
        await expect(page.locator(".task-board__task-card", { hasText: "Hidden task" })).toHaveCount(0);

        const targetCard = page.locator(".task-board__task-card", { hasText: "Verify task board flow" });
        await targetCard.getByRole("button").filter({ hasText: /Edit|编辑/ }).click();

        const popover = page.locator(".task-board__popover.is-positioned");
        await expect(popover).toBeVisible();
        await popover.locator(".task-board__input").fill("2026-03-26T18:45");
        await popover.getByRole("button", { name: /Low|低/ }).click();
        await popover.getByRole("button").filter({ hasText: /Save|保存/ }).click();

        await expect(popover).toHaveCount(0);

        const lowPriorityColumn = page.locator(".task-board__column").filter({ hasText: /Low|低优先级/ });
        await expect(lowPriorityColumn.locator(".task-board__task-card", { hasText: "Verify task board flow" })).toBeVisible();

        await page.getByRole("button", { name: /Refresh|刷新/ }).click();
        await page.getByRole("button", { name: /All|全部/ }).click();
        await expect(lowPriorityColumn.locator(".task-board__task-card", { hasText: "Verify task board flow" })).toBeVisible();
        await expect(page.locator(".task-board__column").filter({ hasText: /High|高优先级/ }).locator(
            ".task-board__task-card",
            { hasText: "Verify task board flow" },
        )).toHaveCount(0);
    });
});