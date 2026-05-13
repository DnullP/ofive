import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

async function waitForWorkbench(page: Page): Promise<void> {
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-left']").waitFor({ state: "visible" });
    await page.getByTestId("activity-bar-item-files").waitFor({ state: "visible" });
}

async function openAgentSkillsPanel(page: Page): Promise<void> {
    await page.getByTestId("activity-bar-item-files").click();
    const panelIcon = page.locator(
        "[data-layout-panel-section-id='left-panel-section'] [data-layout-role='panel'][data-layout-panel-id='agent-skills']",
    );
    await expect(panelIcon).toBeVisible();
    await panelIcon.click();
    await expect(page.locator(".agent-skills-panel")).toBeVisible();
}

test.describe("agent skills panel", () => {
    test("creates and edits a vault-backed Agent SKILL in mock web", async ({ page }) => {
        await gotoMockVaultPage(page, "agent-skills", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);
        await openAgentSkillsPanel(page);

        await page.locator(".agent-skills-create input").fill("research-helper");
        await page.locator(".agent-skills-create textarea").fill("research local notes");
        await page.locator(".agent-skills-create button").click();

        await expect(page.locator(".agent-skills-list button", { hasText: "research-helper" })).toBeVisible();
        await expect(page.locator(".agent-skills-editor")).toHaveValue(/name: research-helper/u);

        await page.locator(".agent-skills-reference input").fill("references/context.md");
        await page.locator(".agent-skills-reference button").click();
        await expect(page.locator(".agent-skills-files button", { hasText: "references/context.md" })).toBeVisible();
    });
});
