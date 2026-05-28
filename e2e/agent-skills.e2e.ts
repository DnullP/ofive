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

async function createResearchHelperSkill(page: Page): Promise<void> {
    await page.locator(".agent-skills-add-button").click();
    await expect(page.locator(".agent-skills-create-modal")).toBeVisible();
    await page.getByTestId("agent-skills-name-input").fill("research-helper");
    await page.getByTestId("agent-skills-description-input").fill("research local notes");
    await page.locator(".agent-skills-create-modal button[type='submit']").click();

    await expect(page.locator(".agent-skills-create-modal")).toBeHidden();
    await expect(page.locator(".agent-skills-skill-list [data-agent-skill-name='research-helper']")).toBeVisible();
    await expect(page.locator(".agent-skills-file-tree [data-agent-skill-file-path='SKILL.md']")).toBeVisible();
}

async function readActiveEditorDocument(page: Page): Promise<string> {
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: { view?: { state?: { doc?: { toString(): string } } } };
        }) | null;
        return content?.cmTile?.view?.state?.doc?.toString() ?? "";
    });
}

test.describe("agent skills panel", () => {
    test("opens the built-in WikiLink SKILL as a read-only reader tab", async ({ page }) => {
        await gotoMockVaultPage(page, "agent-skills-builtin-wikilink", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);
        await openAgentSkillsPanel(page);

        const builtinSkill = page.locator(".agent-skills-skill-list [data-agent-skill-name='ofive-wikilink-syntax']");
        await expect(builtinSkill).toBeVisible();
        await expect(builtinSkill).toHaveAttribute("data-agent-skill-read-only", "true");
        await builtinSkill.click();

        await page.locator(".agent-skills-file-tree [data-agent-skill-file-path='SKILL.md']").click();

        const activeEditor = page.locator(".layout-v2-tab-section__card--active");
        await expect(activeEditor.locator(".cm-tab.cm-tab-reading")).toBeVisible();
        await expect(activeEditor.locator(".cm-tab-reader")).toBeVisible();
        await expect(activeEditor.locator(".cm-tab-mode-toggle")).toHaveCount(0);
        await expect(activeEditor.locator(".cm-tab-title-input")).toHaveAttribute("readonly", "");
        await expect(activeEditor.locator(".cm-tab-editor")).toHaveClass(/is-hidden/);
        await expect(activeEditor.locator(".cm-tab-reader")).toContainText("[[Daily Note#L42]]");
        await expect(activeEditor.locator(".cm-tab-reader")).toContainText("[[mock-ofive:/src/main.ts:7:1-9:1|createMainRuntime]]");
    });

    test("creates a vault-backed Agent SKILL and opens its files in an editor tab", async ({ page }) => {
        await gotoMockVaultPage(page, "agent-skills", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);
        await openAgentSkillsPanel(page);

        await createResearchHelperSkill(page);

        await page.locator(".agent-skills-file-tree [data-agent-skill-file-path='SKILL.md']").click();

        const activeEditor = page.locator(".layout-v2-tab-section__card--active");
        await expect(activeEditor.locator(".cm-content")).toBeVisible();
        await expect.poll(() => readActiveEditorDocument(page)).toContain("name: research-helper");
    });

    test("reopens a SKILL file with latest vault content instead of stale editor context", async ({ page }) => {
        await gotoMockVaultPage(page, "agent-skills-stale-editor-snapshot", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);
        await openAgentSkillsPanel(page);
        await createResearchHelperSkill(page);

        await page.locator(".agent-skills-file-tree [data-agent-skill-file-path='SKILL.md']").click();
        await expect.poll(() => readActiveEditorDocument(page)).toContain("Use this skill when research local notes");

        await page.locator(".layout-v2-tab-section__tab--focused .layout-v2-tab-section__tab-close").click();
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "SKILL.md" })).toHaveCount(0);

        const updatedSkillContent = [
            "---",
            "name: research-helper",
            "description: research local notes",
            "---",
            "# research-helper",
            "",
            "Agent wrote newer workflow marker.",
            "",
        ].join("\n");
        await page.evaluate(async (content) => {
            const vaultApi = await import("/src/api/vaultApi.ts");
            await vaultApi.writeAgentSkillFile("research-helper", "SKILL.md", content);
        }, updatedSkillContent);

        await page.locator(".agent-skills-file-tree [data-agent-skill-file-path='SKILL.md']").click();

        await expect.poll(() => readActiveEditorDocument(page)).toContain("Agent wrote newer workflow marker.");
        await expect.poll(() => readActiveEditorDocument(page)).not.toContain("Use this skill when research local notes");
    });
});
