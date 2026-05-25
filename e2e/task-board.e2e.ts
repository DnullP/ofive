/**
 * @module e2e/task-board
 * @description 任务看板联动 E2E：覆盖图标打开、全仓查询、气泡编辑和文件回写。
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/mockVault
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

interface CodeMirrorContentElement extends HTMLElement {
    cmTile?: {
        view?: {
            focus(): void;
            state: {
                doc: {
                    length: number;
                    toString(): string;
                };
            };
            dispatch(spec: unknown): void;
        };
    };
}

/**
 * @function waitForLayoutReady
 * @description 等待主布局进入可交互状态。
 * @param page Playwright 页面对象。
 */
async function waitForLayoutReady(page: Page): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
}

async function readActiveEditorText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as CodeMirrorContentElement | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found on .cm-content");
        }

        return view.state.doc.toString();
    });
}

async function focusActiveEditorEnd(page: Page): Promise<void> {
    await page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as CodeMirrorContentElement | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found on .cm-content");
        }

        view.dispatch({
            selection: {
                anchor: view.state.doc.length,
            },
            scrollIntoView: true,
        });
        view.focus();
    });
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
        await targetCard.getByRole("button", { name: /Edit|编辑/ }).click();

        const popover = page.locator(".task-board__popover.is-positioned");
        await expect(popover).toBeVisible();
        await expect(page.locator(".task-board .task-board__popover")).toHaveCount(0);
        await expect.poll(async () => popover.evaluate((element) => {
            return Boolean(element.closest("[data-workbench-overlay-layer='true']"));
        })).toBe(true);
        await expect.poll(async () => popover.evaluate((element) => {
            const overlayLayer = element.closest("[data-workbench-overlay-layer='true']");
            if (!(overlayLayer instanceof HTMLElement)) {
                return false;
            }

            const overlayRect = overlayLayer.getBoundingClientRect();
            const popoverRect = element.getBoundingClientRect();
            return popoverRect.top >= overlayRect.top
                && popoverRect.left >= overlayRect.left
                && popoverRect.right <= overlayRect.right
                && popoverRect.bottom <= overlayRect.bottom;
        })).toBe(true);
        await expect(popover.getByText(/Due time|截止时间/)).toHaveCount(0);
        await popover.locator(".task-board__input").last().fill("2026-03-26T18:45");
        await popover.getByRole("button", { name: /Low|低/ }).click();
        await popover.getByRole("button").filter({ hasText: /Save|保存/ }).click();

        await expect(popover).toHaveCount(0);

        const lowPriorityColumn = page.locator(".task-board__column").filter({ hasText: /Low|低优先级/ });
        await expect(lowPriorityColumn.locator(".task-board__task-card", { hasText: "Verify task board flow" })).toBeVisible();

        await page.getByRole("button", { name: /All|全部/ }).click();
        await expect(lowPriorityColumn.locator(".task-board__task-card", { hasText: "Verify task board flow" })).toBeVisible();
        await expect(page.locator(".task-board__column").filter({ hasText: /High|高优先级/ }).locator(
            ".task-board__task-card",
            { hasText: "Verify task board flow" },
        )).toHaveCount(0);
    });

    test("调整已打开任务的优先级后，原 editor 仍保持可编辑", async ({ page }) => {
        await gotoMockVaultPage(page, "task-board-open-editor-sync");
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-task-board").click();
        await expect(page.locator(".task-board")).toBeVisible();
        await page.getByRole("button", { name: /All|全部/ }).click();

        const targetCard = page.locator(".task-board__task-card", { hasText: "Verify task board flow" });
        await targetCard.getByRole("button", { name: /Open|打开/ }).click();
        await page.locator(".layout-v2-tab-section__tab-main", { hasText: "task-board-e2e.md" }).waitFor({ state: "visible" });
        await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });

        await page.locator(".layout-v2-tab-section__tab-main", { hasText: /任务看板|Task Board/ }).click();
        await targetCard.getByRole("button", { name: /Edit|编辑/ }).click();

        const popover = page.locator(".task-board__popover.is-positioned");
        await expect(popover).toBeVisible();
        await popover.getByRole("button", { name: /Low|低/ }).click();
        await popover.getByRole("button").filter({ hasText: /Save|保存/ }).click();
        await expect(popover).toHaveCount(0);

        await page.locator(".layout-v2-tab-section__tab-main", { hasText: "task-board-e2e.md" }).click();
        await expect(page.locator(".layout-v2-tab-section__card--active .cm-line", {
            hasText: "Verify task board flow",
        })).toContainText("!low");

        const marker = " editable-after-board-sync";
        await focusActiveEditorEnd(page);
        await page.keyboard.type(marker);

        await expect.poll(async () => readActiveEditorText(page)).toContain(marker);
    });

    test("应支持自定义过滤列并拖拽调整列宽", async ({ page }) => {
        await gotoMockVaultPage(page, "task-board-custom-columns");
        await waitForLayoutReady(page);

        await page.getByTestId("activity-bar-item-task-board").click();
        await expect(page.locator(".task-board")).toBeVisible();
        await page.getByRole("button", { name: /All|全部/ }).click();
        await expect(page.getByRole("button", { name: /Refresh|刷新/ })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Add column|添加列/ })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Edit board|编辑看板/ })).toBeVisible();

        const firstColumn = page.locator(".task-board__column").first();
        const initialWidth = await firstColumn.evaluate((element) => element.getBoundingClientRect().width);
        const resizeHandle = firstColumn.locator(".task-board__column-resizer");
        const firstColumnBox = await firstColumn.boundingBox();
        const handleBox = await resizeHandle.boundingBox();
        expect(firstColumnBox).not.toBeNull();
        expect(handleBox).not.toBeNull();

        if (!firstColumnBox || !handleBox) {
            throw new Error("Task board column resize handle not found");
        }

        const handleCenterX = handleBox.x + handleBox.width / 2;
        const gapCenterX = firstColumnBox.x + firstColumnBox.width + 4;
        expect(Math.abs(handleCenterX - gapCenterX)).toBeLessThanOrEqual(2);

        await page.mouse.move(firstColumnBox.x + firstColumnBox.width / 2, firstColumnBox.y + 36);
        await expect.poll(async () => resizeHandle.evaluate((element) => {
            return getComputedStyle(element).opacity;
        })).toBe("0");

        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await expect.poll(async () => resizeHandle.evaluate((element) => {
            return getComputedStyle(element).opacity;
        })).toBe("1");
        await page.mouse.down();
        await page.mouse.move(handleBox.x + 76, handleBox.y + handleBox.height / 2, { steps: 4 });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        await page.mouse.up();

        await expect.poll(async () => firstColumn.evaluate((element) => {
            return Math.round(element.getBoundingClientRect().width);
        })).toBeGreaterThan(Math.round(initialWidth + 40));

        await page.getByRole("button", { name: /Edit board|编辑看板/ }).click();
        await expect(page.getByRole("button", { name: /Save edit|保存编辑/ })).toBeVisible();
        await expect(page.getByRole("button", { name: /Add column|添加列/ })).toBeVisible();

        const highColumnBox = await page.locator(".task-board__column").first().boundingBox();
        const mediumColumn = page.locator(".task-board__column").filter({ hasText: /Medium|中优先级/ });
        const mediumHandle = mediumColumn.getByRole("button", { name: /Drag Medium|拖动.*中优先级/ });
        const mediumHandleBox = await mediumHandle.boundingBox();
        expect(highColumnBox).not.toBeNull();
        expect(mediumHandleBox).not.toBeNull();
        if (!highColumnBox || !mediumHandleBox) {
            throw new Error("Task board reorder handles not found");
        }

        await page.mouse.move(
            mediumHandleBox.x + mediumHandleBox.width / 2,
            mediumHandleBox.y + mediumHandleBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(highColumnBox.x + 8, mediumHandleBox.y + mediumHandleBox.height / 2, { steps: 4 });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        await page.mouse.up();
        await expect(page.locator(".task-board__column").first()).toContainText(/Medium|中优先级/);

        await page.locator(".task-board__column").first().getByRole("button", {
            name: /Configure Medium|配置.*中优先级/,
        }).click();
        const editDialog = page.getByRole("dialog", { name: /Edit column|编辑列/ });
        await expect(editDialog).toBeVisible();
        await expect.poll(async () => editDialog.evaluate((element) => {
            return Boolean(element.closest("[data-workbench-overlay-layer='true']"));
        })).toBe(true);
        await expect(editDialog.locator(".task-board__custom-column-editor")).toHaveCount(1);
        await editDialog.locator(".task-board__custom-column-name input").fill("Board focus");
        await editDialog.getByRole("button", { name: /Save column|保存列/ }).click();
        await expect(editDialog).toHaveCount(0);
        await expect(page.locator(".task-board__column").first()).toContainText("Board focus");

        await page.getByRole("button", { name: /Add column|添加列/ }).first().click();
        const dialog = page.getByRole("dialog", { name: /Add column|添加列/ });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator(".task-board__custom-column-editor")).toHaveCount(1);

        const editor = dialog.locator(".task-board__custom-column-editor").last();
        await expect(editor).toBeVisible();
        await editor.locator(".task-board__custom-column-name input").fill("Board tag");

        const condition = editor.locator(".task-board__condition-row").first();
        await condition.locator("select").nth(0).selectOption("tag");
        await condition.locator("select").nth(1).selectOption("equals");
        await condition.locator("input").fill("board");

        const customColumn = page.locator(".task-board__column.is-custom").filter({ hasText: "Board tag" });
        await expect(customColumn).toHaveCount(0);
        await dialog.getByRole("button", { name: /Save column|保存列/ }).click();
        await expect(dialog).toHaveCount(0);

        await expect(customColumn.locator(".task-board__task-card", {
            hasText: "Verify task board flow",
        })).toBeVisible();
        await expect(customColumn.locator(".task-board__task-card", {
            hasText: "Completed task",
        })).toHaveCount(0);

        await page.getByRole("button", { name: /Save edit|保存编辑/ }).click();
        await expect(page.getByRole("button", { name: /Edit board|编辑看板/ })).toBeVisible();
        await expect(page.getByRole("button", { name: /Add column|添加列/ })).toHaveCount(0);
        await expect(page.locator(".task-board__column").first()).toContainText("Board focus");
    });
});
