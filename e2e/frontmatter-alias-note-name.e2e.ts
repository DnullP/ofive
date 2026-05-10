/**
 * @module e2e/frontmatter-alias-note-name
 * @description 验证 frontmatter alias 会作为笔记名称参与各类用户入口匹配。
 *
 * 覆盖场景：
 * 1. web-mock 中已有 `network-segment.md` 的 frontmatter alias: `网段`。
 * 2. `[[网段]]` 应解析到该笔记。
 * 3. Quick Switcher 输入 `网段` 应出现该笔记候选。
 * 4. 搜索面板的“文件名”范围输入 `网段` 应命中该笔记。
 * 5. WikiLink 补全建议输入 `网段` 应出现该笔记。
 *
 * @dependencies
 *   - @playwright/test
 */

import { expect, test, type Page } from "@playwright/test";

const NETWORK_NOTE_PATH = "test-resources/notes/network-segment.md";

async function waitForMockLayoutReady(page: Page): Promise<void> {
    await page.goto("/web-mock/mock-tauri-test.html?showControls=0");
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await page.getByTestId("activity-bar-item-files").waitFor({ state: "visible" });
}

async function openQuickSwitcher(page: Page): Promise<void> {
    await page.keyboard.press("Meta+O");

    const quickSwitcher = page.locator(".quick-switcher-panel");
    try {
        await expect(quickSwitcher).toBeVisible({ timeout: 2000 });
    } catch {
        await page.evaluate(async () => {
            const module = await import("/src/plugins/quick-switcher/quickSwitcherEvents.ts");
            module.notifyQuickSwitcherOpenRequested();
        });
        await expect(quickSwitcher).toBeVisible();
    }
}

test("frontmatter alias should behave as a note name in wikilink, quick switcher, and search", async ({ page }) => {
    await waitForMockLayoutReady(page);

    const apiResults = await page.evaluate(async (aliasText) => {
        const vaultApi = await import("/src/api/vaultApi.ts");
        const [resolvedWikiLink, quickSwitchItems, searchItems, wikiLinkSuggestions] = await Promise.all([
            vaultApi.resolveWikiLinkTarget("", aliasText),
            vaultApi.searchVaultMarkdownFiles(aliasText, 10),
            vaultApi.searchVaultMarkdown(aliasText, { scope: "fileName", limit: 10 }),
            vaultApi.suggestWikiLinkTargets(aliasText, 10),
        ]);

        return {
            resolvedWikiLinkPath: resolvedWikiLink?.relativePath ?? null,
            quickSwitchPaths: quickSwitchItems.map((item) => item.relativePath),
            fileNameSearchPaths: searchItems.map((item) => item.relativePath),
            wikiLinkSuggestionPaths: wikiLinkSuggestions.map((item) => item.relativePath),
        };
    }, "网段");

    expect(apiResults.resolvedWikiLinkPath).toBe(NETWORK_NOTE_PATH);
    expect(apiResults.quickSwitchPaths).toContain(NETWORK_NOTE_PATH);
    expect(apiResults.fileNameSearchPaths).toContain(NETWORK_NOTE_PATH);
    expect(apiResults.wikiLinkSuggestionPaths).toContain(NETWORK_NOTE_PATH);

    await openQuickSwitcher(page);
    const quickSwitcher = page.locator(".quick-switcher-panel");
    await quickSwitcher.locator(".quick-switcher-input").fill("网段");
    await expect(
        quickSwitcher.locator(".quick-switcher-item").filter({ hasText: NETWORK_NOTE_PATH }).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".quick-switcher-panel")).toHaveCount(0);

    await page.getByTestId("activity-bar-item-search").click();
    const searchPanel = page.locator(".search-panel");
    await expect(searchPanel).toBeVisible();
    await searchPanel.locator(".search-scope-button").last().click();
    await searchPanel.locator(".search-query-field input").fill("网段");
    await expect(
        searchPanel.locator(".search-result").filter({ hasText: NETWORK_NOTE_PATH }).first(),
    ).toBeVisible();
});
