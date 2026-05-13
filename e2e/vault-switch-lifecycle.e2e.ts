/**
 * @module e2e/vault-switch-lifecycle
 * @description 仓库切换生命周期回归测试。
 *
 * 覆盖用户复现：打开多个旧仓库 tab 后，在不 reload 的情况下切换仓库；
 * 旧仓库文件 tab 必须先被清理，且旧仓库 autosave pending 不会跨仓库保存。
 *
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/mockVault
 *
 * @example
 *   bunx playwright test e2e/vault-switch-lifecycle.e2e.ts --reporter=line
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";
const NETWORK_NOTE_PATH = "test-resources/notes/network-segment.md";

async function waitForMockLayoutReady(page: Page): Promise<void> {
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab-main").first().waitFor({ state: "visible" });
}

async function ensureMockNotesTreeExpanded(page: Page): Promise<void> {
    const rootItem = page.locator(".tree-item[data-tree-path='test-resources']");
    const notesItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    const guideItem = page.locator(`.tree-item[data-tree-path='${GUIDE_NOTE_PATH}']`);

    await rootItem.waitFor({ state: "visible" });

    if (!await notesItem.isVisible().catch(() => false)) {
        await rootItem.click();
        await notesItem.waitFor({ state: "visible" });
    }

    if (!await guideItem.isVisible().catch(() => false)) {
        await notesItem.click();
    }

    await guideItem.waitFor({ state: "visible" });
}

async function openMockNote(page: Page, relativePath: string): Promise<void> {
    await ensureMockNotesTreeExpanded(page);
    const fileName = relativePath.split("/").pop() ?? relativePath;
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).dblclick();
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: fileName }).waitFor({ state: "visible" });
}

test.describe("vault switch lifecycle", () => {
    test("should clear old vault tabs and pending autosaves before switching vault path", async ({ page }) => {
        const initialVaultPath = await gotoMockVaultPage(page, "vault-switch-lifecycle-a", MOCK_PAGE);
        await waitForMockLayoutReady(page);

        await page.getByTestId("activity-bar-item-architecture-devtools").click();
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "Architecture DevTools" })).toBeVisible();

        await openMockNote(page, GUIDE_NOTE_PATH);
        await openMockNote(page, NETWORK_NOTE_PATH);
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "guide.md" })).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "network-segment.md" })).toBeVisible();

        await page.evaluate(async ({ path }) => {
            const events = await import("/src/host/events/appEventBus.ts");
            events.emitEditorContentChangedEvent({
                articleId: `file:${path}`,
                path,
                content: "dirty content that must not cross vaults",
                updatedAt: Date.now(),
            });
        }, { path: GUIDE_NOTE_PATH });

        await expect.poll(async () => page.evaluate(async () => {
            const autoSave = await import("/src/host/editor/autoSaveService.ts");
            return autoSave.getAutoSaveServiceState().pendingPaths;
        })).toContain(GUIDE_NOTE_PATH);

        const nextVaultPath = `${initialVaultPath}-next`;
        await page.evaluate(async ({ nextVaultPath }) => {
            const vaultStore = await import("/src/host/vault/vaultStore.ts");
            await vaultStore.setCurrentVaultPath(nextVaultPath);
        }, { nextVaultPath });

        await expect.poll(async () => page.evaluate(async () => {
            const vaultStore = await import("/src/host/vault/vaultStore.ts");
            return vaultStore.getVaultStateSnapshot().currentVaultPath;
        })).toBe(nextVaultPath);

        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "guide.md" })).toHaveCount(0);
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "network-segment.md" })).toHaveCount(0);
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "Architecture DevTools" })).toBeVisible();

        await expect.poll(async () => page.evaluate(async () => {
            const autoSave = await import("/src/host/editor/autoSaveService.ts");
            return autoSave.getAutoSaveServiceState().pendingPaths;
        })).toEqual([]);
    });
});
