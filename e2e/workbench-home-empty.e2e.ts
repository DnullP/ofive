import { expect, test } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";

test.describe("workbench empty home", () => {
    test("renders quick-start home when no main tabs are open", async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await page.locator("[data-testid='main-dockview-host']").waitFor({ state: "visible" });

        const home = page.locator(".workbench-home-empty");
        await expect(home).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__tab-main", { hasText: /首页|Home/ })).toHaveCount(0);

        const createNoteButton = home.getByRole("button", { name: /创建新笔记|Create New Note/ });
        const randomNoteButton = home.getByRole("button", { name: /随机打开笔记|Open Random Note/ });
        const openVaultButton = home.getByRole("button", { name: /打开仓库|Open Vault/ });

        await expect(createNoteButton).toBeEnabled({ timeout: 10_000 });
        await expect(randomNoteButton).toBeEnabled({ timeout: 10_000 });
        await expect(openVaultButton).toBeVisible();

        await createNoteButton.click();
        await expect(page.locator(".create-entry-panel")).toBeVisible();
        await page.locator(".create-entry-button", { hasText: /取消|Cancel/ }).click();
        await expect(page.locator(".create-entry-panel")).toHaveCount(0);

        await randomNoteButton.click();
        await expect(home).toHaveCount(0);
        await expect(page.locator(".layout-v2-tab-section__tab-main").filter({ hasText: /\.md|\.markdown/ })).toBeVisible();
        await expect(page.locator(".cm-editor")).toBeVisible();
    });
});
