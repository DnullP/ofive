/**
 * @module e2e/editor-tabout
 * @description CodeMirror TabOut mock-web 回归测试。
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";

async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.addInitScript(() => {
        localStorage.clear();
    });
    await page.goto(MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section").first().waitFor({ state: "visible" });
}

async function openMockGuide(page: Page): Promise<void> {
    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
    await page.locator(`.tree-item[data-tree-path='${GUIDE_NOTE_PATH}']`).click();
    await page.getByRole("button", { name: "guide.md" }).first().waitFor({ state: "visible" });
    await page.locator(".cm-content").first().waitFor({ state: "visible" });
}

test.describe("editor tabout", () => {
    test("Tab moves cursor after the nearest closing bracket", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openMockGuide(page);

        await page.locator(".cm-content").first().click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.type("(alpha)");
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("Tab");
        await page.keyboard.type("X");

        await expect.poll(
            async () => page.locator(".cm-content").first().textContent(),
            { timeout: 2_000 },
        ).toContain("(alpha)X");
    });
});
