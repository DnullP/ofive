/**
 * @module e2e/file-tree-root-drop
 * @description 文件树拖拽到仓库根目录的回归测试。
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const SOURCE_NOTE_PATH = "test-resources/notes/guide.md";
const SOURCE_FOLDER_PATH = "test-resources/notes";
const ROOT_TARGET_NOTE_PATH = "root-target.md";
const ROOT_NOTE_PATH = "guide.md";
const ROOT_FOLDER_PATH = "notes";

async function waitForMockFileTree(page: Page): Promise<void> {
    await gotoMockVaultPage(page, "file-tree-root-drop", MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator(".file-tree").waitFor({ state: "visible" });
}

async function expandMockNotes(page: Page): Promise<void> {
    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
    await expect(page.locator(`.tree-item[data-tree-path='${SOURCE_NOTE_PATH}']`)).toBeVisible();
}

async function expandMockTestResources(page: Page): Promise<void> {
    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await expect(page.locator(`.tree-item[data-tree-path='${SOURCE_FOLDER_PATH}']`)).toBeVisible();
}

async function dragTreeItemToRootLevelFile(
    page: Page,
    sourceRelativePath: string,
    targetRelativePath: string,
): Promise<void> {
    const source = page.locator(`.tree-item[data-tree-path='${sourceRelativePath}']`);
    const target = page.locator(`.tree-item[data-tree-path='${targetRelativePath}']`);
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox) {
        throw new Error("dragTreeItemToRoot: source or target bounds missing");
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 6, sourceBox.y + sourceBox.height / 2 + 6, { steps: 4 });
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 16 });
    await page.mouse.up();
}

test.describe("file tree root drop", () => {
    test("moves a nested file into the vault root by dropping on a root-level file @mouse-drag", async ({ page }) => {
        await waitForMockFileTree(page);
        await expandMockNotes(page);
        await expect(page.locator("[data-tree-root-drop-target='true']")).toHaveCount(0);
        await expect(page.locator(`.tree-item[data-tree-path='${ROOT_TARGET_NOTE_PATH}']`)).toBeVisible();

        await dragTreeItemToRootLevelFile(page, SOURCE_NOTE_PATH, ROOT_TARGET_NOTE_PATH);

        await expect(page.locator(`.tree-item[data-tree-path='${SOURCE_NOTE_PATH}']`)).toHaveCount(0);
        await expect(page.locator(`.tree-item[data-tree-path='${ROOT_NOTE_PATH}']`)).toBeVisible();
    });

    test("moves a nested folder into the vault root by dropping on a root-level file @mouse-drag", async ({ page }) => {
        await waitForMockFileTree(page);
        await expandMockTestResources(page);
        await expect(page.locator("[data-tree-root-drop-target='true']")).toHaveCount(0);
        await expect(page.locator(`.tree-item[data-tree-path='${ROOT_TARGET_NOTE_PATH}']`)).toBeVisible();

        await dragTreeItemToRootLevelFile(page, SOURCE_FOLDER_PATH, ROOT_TARGET_NOTE_PATH);

        await expect(page.locator(`.tree-item[data-tree-path='${SOURCE_FOLDER_PATH}']`)).toHaveCount(0);
        await expect(page.locator(`.tree-item[data-tree-path='${ROOT_FOLDER_PATH}']`)).toBeVisible();
    });
});
