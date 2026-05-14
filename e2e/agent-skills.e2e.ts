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
    test("creates a vault-backed Agent SKILL and opens its files in an editor tab", async ({ page }) => {
        await gotoMockVaultPage(page, "agent-skills", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);
        await openAgentSkillsPanel(page);

        await page.locator(".agent-skills-add-button").click();
        await expect(page.locator(".agent-skills-create-modal")).toBeVisible();
        await page.getByTestId("agent-skills-name-input").fill("research-helper");
        await page.getByTestId("agent-skills-description-input").fill("research local notes");
        await page.locator(".agent-skills-create-modal button[type='submit']").click();

        await expect(page.locator(".agent-skills-create-modal")).toBeHidden();
        await expect(page.locator(".agent-skills-skill-list [data-agent-skill-name='research-helper']")).toBeVisible();
        await expect(page.locator(".agent-skills-file-tree [data-agent-skill-file-path='SKILL.md']")).toBeVisible();

        await page.locator(".agent-skills-file-tree [data-agent-skill-file-path='SKILL.md']").click();

        const activeEditor = page.locator(".layout-v2-tab-section__card--active");
        await expect(activeEditor.locator(".cm-content")).toBeVisible();
        await expect(activeEditor.locator(".cm-content")).toContainText("name: research-helper");
    });
});
