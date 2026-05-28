/**
 * @module e2e/scroll-boundary-overscroll
 * @description 滚动边界回归：关键纵向滚动容器应禁用 overscroll 回弹链路。
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const SCROLL_NOTE_PATH = "test-resources/notes/scroll-regression.md";

type OverscrollTarget = {
    name: string;
    selector: string;
};

const PROBE_TARGETS: OverscrollTarget[] = [
    { name: "settings sidebar list", selector: ".settings-tab-sidebar-list" },
    { name: "wikilink preview body", selector: ".cm-wikilink-preview__body" },
    { name: "architecture page", selector: ".architecture-devtools" },
    { name: "architecture dag scroll", selector: ".architecture-dag-scroll" },
];

async function waitForWorkbench(page: Page): Promise<void> {
    await gotoMockVaultPage(page, "scroll-boundary-overscroll", MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-left']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-right']").waitFor({ state: "visible" });
}

async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

async function openScrollRegressionNote(page: Page): Promise<void> {
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${SCROLL_NOTE_PATH}']`).click();
    await page.locator(".layout-v2-tab-section__card--active .cm-scroller").waitFor({ state: "visible" });
}

async function openAiChatPanel(page: Page): Promise<void> {
    await page.locator("[data-testid='sidebar-right'] [data-layout-role='panel'][data-layout-panel-id='ai-chat']").click();
    await page.locator(".ai-chat-messages").waitFor({ state: "visible" });
}

async function createStyleProbeTargets(page: Page, targets: OverscrollTarget[]): Promise<void> {
    await page.evaluate((probeTargets) => {
        const existingProbe = document.getElementById("overscroll-style-probe");
        existingProbe?.remove();

        const probeRoot = document.createElement("div");
        probeRoot.id = "overscroll-style-probe";
        probeRoot.style.position = "fixed";
        probeRoot.style.left = "-10000px";
        probeRoot.style.top = "0";
        probeRoot.style.width = "160px";
        probeRoot.style.height = "160px";
        probeRoot.style.pointerEvents = "none";
        document.body.append(probeRoot);

        for (const target of probeTargets) {
            const element = document.createElement("div");
            element.className = target.selector.replace(/^\./, "");
            element.textContent = target.name;
            probeRoot.append(element);
        }
    }, targets);
}

async function expectOverscrollYNone(page: Page, targets: OverscrollTarget[]): Promise<void> {
    const styles = await page.evaluate((items) => items.map((item) => {
        const element = item.selector === "html"
            ? document.documentElement
            : item.selector === "body"
                ? document.body
                : document.querySelector<HTMLElement>(item.selector);
        if (!element) {
            throw new Error(`Missing overscroll target: ${item.name} (${item.selector})`);
        }

        return {
            name: item.name,
            overscrollBehaviorY: getComputedStyle(element).overscrollBehaviorY,
        };
    }), targets);

    for (const style of styles) {
        expect(style.overscrollBehaviorY, style.name).toBe("none");
    }
}

test.describe("scroll boundary overscroll", () => {
    test("disables vertical overscroll on app scroll surfaces", async ({ page }) => {
        await waitForWorkbench(page);
        await openScrollRegressionNote(page);
        await openAiChatPanel(page);

        await expectOverscrollYNone(page, [
            { name: "html", selector: "html" },
            { name: "body", selector: "body" },
            { name: "root", selector: "#root" },
            { name: "app shell", selector: ".app-shell" },
            { name: "file tree", selector: ".tree-root" },
            { name: "ai chat messages", selector: ".ai-chat-messages" },
            { name: "side panel body", selector: ".layout-v2-panel-section__pane-body" },
            { name: "editor scroller", selector: ".layout-v2-tab-section__card--active .cm-scroller" },
        ]);

        await createStyleProbeTargets(page, PROBE_TARGETS);
        await expectOverscrollYNone(page, PROBE_TARGETS);
    });
});
