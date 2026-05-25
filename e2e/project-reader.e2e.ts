/**
 * @module e2e/project-reader
 * @description 外部项目阅读器基础链路回归测试。
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

async function waitForWorkbench(page: Page): Promise<void> {
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-left']").waitFor({ state: "visible" });
    await page.getByTestId("activity-bar-item-files").waitFor({ state: "visible" });
}

async function openProjectReaderPanel(page: Page): Promise<void> {
    await page.getByTestId("activity-bar-item-files").click();
    await expect(page.getByTestId("activity-bar-item-project-reader")).toHaveCount(0);
    const projectReaderPanelIcon = page.locator(
        "[data-layout-panel-section-id='left-panel-section'] [data-layout-role='panel'][data-layout-panel-id='project-reader']",
    );
    await expect(projectReaderPanelIcon).toBeVisible();
    await projectReaderPanelIcon.click();
}

async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

async function openMockNote(page: Page, relativePath: string): Promise<void> {
    await page.getByTestId("activity-bar-item-files").click();
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
}

async function readVisibleEditorState(page: Page): Promise<{
    title: string | null;
}> {
    return page.evaluate(() => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card[aria-hidden='false']");
        const titleInput = activeCard?.querySelector(".cm-tab-title-input");

        return {
            title: titleInput instanceof HTMLInputElement ? titleInput.value : null,
        };
    });
}

async function waitForVisibleEditorTitle(page: Page, expectedTitle: string): Promise<void> {
    await expect.poll(async () => (await readVisibleEditorState(page)).title).toBe(expectedTitle);
}

async function openBacklinksPanel(page: Page) {
    const rightSidebar = page.locator("[aria-label='Right Extension Panel']");
    const backlinksPanelButton = rightSidebar.locator("[data-layout-panel-id='backlinks'][data-layout-role='panel']");
    await expect(backlinksPanelButton).toBeVisible();
    await backlinksPanelButton.click();
    return rightSidebar.locator(".layout-v2-panel-section__pane-body");
}

async function resolveLocatorPoint(page: Page, locator: Locator, missingBoxMessage: string): Promise<{ x: number; y: number }> {
    await expect(locator).toBeVisible();
    let box: { x: number; y: number; width: number; height: number } | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        box = await locator.boundingBox();
        if (box) {
            break;
        }
        await page.waitForTimeout(50);
    }

    expect(box).not.toBeNull();
    if (!box) {
        throw new Error(missingBoxMessage);
    }

    return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
    };
}

async function hoverTokenWithModifier(page: Page, locator: Locator, modifier: "Meta" | "Control"): Promise<void> {
    await page.keyboard.down(modifier);
    try {
        await expect.poll(async () => {
            const { x, y } = await resolveLocatorPoint(
                page,
                locator,
                "Project reader token is missing a bounding box.",
            );
            await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
            await page.mouse.move(x - 24, y);
            await page.mouse.move(x, y);
            const className = await locator.evaluate((element) => element.className);
            return typeof className === "string"
                ? className.includes("project-reader-code-token--hovered")
                : false;
        }).toBe(true);
    } finally {
        await page.keyboard.up(modifier);
    }
}

async function clickTokenWithModifier(page: Page, locator: Locator, modifier: "Meta" | "Control"): Promise<void> {
    const { x, y } = await resolveLocatorPoint(page, locator, "Project reader token is missing a bounding box.");
    await page.keyboard.down(modifier);
    try {
        await page.mouse.move(x, y);
        await page.mouse.click(x, y);
    } finally {
        await page.keyboard.up(modifier);
    }
}

async function selectTextInsideLocator(locator: Locator, text: string): Promise<void> {
    await locator.evaluate((element, targetText) => {
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            const value = node.textContent ?? "";
            const offset = value.indexOf(targetText);
            if (offset >= 0) {
                const range = element.ownerDocument.createRange();
                range.setStart(node, offset);
                range.setEnd(node, offset + targetText.length);

                const selection = element.ownerDocument.defaultView?.getSelection();
                if (!selection) {
                    throw new Error("Unable to access browser text selection.");
                }

                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }

            node = walker.nextNode();
        }

        throw new Error(`Unable to find text "${targetText}" inside project reader code.`);
    }, text);
}

test.describe("project reader", () => {
    test("should preview project source wikilink on modifier hover", async ({ page }) => {
        await gotoMockVaultPage(page, "project-reader-preview", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);

        await openMockNote(page, "test-resources/notes/project-reader-preview.md");
        await page.locator(".layout-v2-tab-section__card--active .cm-line", { hasText: "Project Reader Preview" }).click();

        const projectWikiLink = page.locator(".layout-v2-tab-section__card--active .cm-rendered-wikilink-display", {
            hasText: "createMainRuntime",
        });
        await expect(projectWikiLink).toBeVisible();

        await page.keyboard.down("Control");
        try {
            await projectWikiLink.hover();
            const preview = page.locator(".cm-wikilink-preview-tooltip .project-reader-wikilink-preview");
            await expect(preview).toBeVisible();
            await expect(preview).toContainText("export function createMainRuntime(): AppRuntime");
            await expect(preview).toContainText("return createApp();");
            await expect(page.locator(".cm-wikilink-preview-tooltip .cm-wikilink-preview__status")).toHaveCount(0);
        } finally {
            await page.keyboard.up("Control");
        }
    });

    test("should open imported project, read code and resolve symbol popup", async ({ page }) => {
        await gotoMockVaultPage(page, "project-reader", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);

        await openProjectReaderPanel(page);
        const panel = page.locator(".project-reader-panel");
        await expect(panel).toBeVisible();

        const projectSelect = page.locator(".project-reader-project-select");
        await expect(projectSelect).toBeVisible();
        await expect(projectSelect).toHaveValue(/mock-ofive/);

        await page.locator(".tree-item[data-tree-path='src']").click();
        await page.locator(".tree-item[data-tree-path='src/main.ts']").click();

        const codeTab = page.locator(".project-reader-code-tab");
        await expect(codeTab).toBeVisible();
        await expect(codeTab.locator(".project-reader-code-meta")).toContainText("src/main.ts");
        await expect(codeTab.locator(".project-reader-code-line").filter({ hasText: "createMainRuntime" })).toBeVisible();
        await expect(codeTab.locator(".project-reader-code-line.is-referenced").first()).toBeVisible();
        await expect(codeTab.locator(".project-reader-code-reference")).toHaveCount(0);

        let backlinksPaneBody = await openBacklinksPanel(page);
        await expect(backlinksPaneBody.locator(".backlinks-count")).toBeVisible();
        await expect(backlinksPaneBody.locator(".backlinks-item").filter({ hasText: "note1.md" })).toBeVisible();
        await backlinksPaneBody.locator(".backlinks-item").filter({ hasText: "note1.md" }).first().click();
        await waitForVisibleEditorTitle(page, "note1");
        await expect(page.locator(".layout-v2-tab-section__tab-main", { hasText: "note1.md" })).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__card--active .cm-line", { hasText: "同一个Session" })).toBeVisible();
        await page.locator(".layout-v2-tab-section__tab-main", { hasText: "main.ts" }).first().click();
        await expect(codeTab.locator(".project-reader-code-meta")).toContainText("src/main.ts");

        const runtimeLineText = codeTab.locator(".project-reader-code-line", { hasText: "AppRuntime" })
            .first()
            .locator(".project-reader-code-text");
        const runtimeLineBox = await runtimeLineText.boundingBox();
        expect(runtimeLineBox).not.toBeNull();
        if (!runtimeLineBox) {
            throw new Error("Project reader runtime line is missing a bounding box.");
        }

        await selectTextInsideLocator(runtimeLineText, "AppRuntime");
        await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? ""))
            .toContain("AppRuntime");
        await runtimeLineText.click({ button: "right", position: { x: 12, y: Math.max(2, runtimeLineBox.height / 2) } });
        await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? ""))
            .toContain("AppRuntime");
        await page.keyboard.press("Escape");
        await page.evaluate(() => window.getSelection()?.removeAllRanges());

        const appRuntimeToken = () => codeTab.locator(".project-reader-code-token", { hasText: "AppRuntime" }).first();
        const runtimeToken = appRuntimeToken();
        await expect(runtimeToken).toBeVisible();
        await hoverTokenWithModifier(page, runtimeToken, "Meta");

        await clickTokenWithModifier(page, appRuntimeToken(), "Meta");

        await page.locator(".tree-item[data-tree-path='src/alternate.ts']").click();
        await expect(codeTab.locator(".project-reader-code-meta")).toContainText("src/alternate.ts");

        backlinksPaneBody = await openBacklinksPanel(page);
        await expect(backlinksPaneBody.locator(".backlinks-count")).toBeVisible();
        await expect(backlinksPaneBody.locator(".backlinks-item").filter({ hasText: "note2.md" })).toBeVisible();
        await backlinksPaneBody.locator(".backlinks-item").filter({ hasText: "note2.md" }).first().click();
        await waitForVisibleEditorTitle(page, "note2");
        await expect(page.locator(".layout-v2-tab-section__tab-main", { hasText: "note2.md" })).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__card--active .cm-line", { hasText: "名为Session的结构" })).toBeVisible();
        await page.locator(".layout-v2-tab-section__tab-main", { hasText: "alternate.ts" }).first().click();

        await clickTokenWithModifier(page, appRuntimeToken(), "Meta");
        await expect(codeTab.locator(".project-reader-code-meta")).toContainText("src/alternate.ts");
        await expect(codeTab.locator(".project-reader-code-line.is-target-line")).toBeVisible();
    });

    test("should search imported project text, symbols and ast-grep patterns", async ({ page }) => {
        await gotoMockVaultPage(page, "project-reader-search", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);

        await openProjectReaderPanel(page);
        const panel = page.locator(".project-reader-panel");
        await expect(panel).toBeVisible();

        const searchInput = panel.locator(".project-reader-search-input");
        await searchInput.fill("createMainRuntime");
        const mainResult = panel.locator(".project-reader-search-result", {
            has: page.locator(".project-reader-search-result__path", { hasText: "src/main.ts:7" }),
        });
        await expect(mainResult).toBeVisible();

        await mainResult.click();
        const codeTab = page.locator(".project-reader-code-tab");
        await expect(codeTab.locator(".project-reader-code-meta")).toContainText("src/main.ts");
        await expect(codeTab.locator(".project-reader-code-line.is-target-line")).toBeVisible();

        await panel.locator(".project-reader-search-mode-button").click();
        await panel.locator(".project-reader-search-mode-menu-item", { hasText: "Symbol" }).click();
        await searchInput.fill("Runtime");
        await expect(panel.locator(".project-reader-search-result", {
            has: page.locator(".project-reader-search-result__path", { hasText: "src/runtime.ts:" }),
        })).toBeVisible();

        await panel.locator(".project-reader-search-mode-button").click();
        await panel.locator(".project-reader-search-mode-menu-item", { hasText: "AST" }).click();
        await searchInput.fill("function $NAME() { $$$BODY }");
        await expect(panel.locator(".project-reader-search-result").filter({ hasText: "function" }).first()).toBeVisible();
    });

    test("should keep long project source tabs vertically scrollable", async ({ page }) => {
        await gotoMockVaultPage(page, "project-reader-scroll", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);

        await openProjectReaderPanel(page);
        await page.locator(".tree-item[data-tree-path='src']").click();
        await page.locator(".tree-item[data-tree-path='src/long-scroll.ts']").click();

        const codeTab = page.locator(".project-reader-code-tab");
        const scroller = codeTab.locator(".project-reader-code-scroller");
        await expect(codeTab.locator(".project-reader-code-meta")).toContainText("src/long-scroll.ts");
        await expect(scroller.locator(".project-reader-code-line").filter({ hasText: "line 160" })).toHaveCount(1);

        const beforeScroll = await scroller.evaluate((element) => ({
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            scrollTop: element.scrollTop,
            overflowY: window.getComputedStyle(element).overflowY,
        }));

        expect(beforeScroll.overflowY).toBe("auto");
        expect(beforeScroll.scrollHeight - beforeScroll.clientHeight).toBeGreaterThan(400);

        await scroller.hover();
        await page.mouse.wheel(0, 700);

        await expect.poll(async () => scroller.evaluate((element) => element.scrollTop))
            .toBeGreaterThan(beforeScroll.scrollTop + 120);
    });

    test("should show project source references in the backlinks panel", async ({ page }) => {
        await gotoMockVaultPage(page, "project-reader-backlinks", "/web-mock/mock-tauri-test.html?showControls=0");
        await waitForWorkbench(page);

        await openProjectReaderPanel(page);
        await page.locator(".tree-item[data-tree-path='src']").click();
        await page.locator(".tree-item[data-tree-path='src/main.ts']").click();

        const codeTab = page.locator(".project-reader-code-tab");
        await expect(codeTab).toBeVisible();
        await expect(codeTab.locator(".project-reader-code-meta")).toContainText("src/main.ts");
        await expect(codeTab.locator(".project-reader-code-line.is-referenced").first()).toBeVisible();
        await expect(codeTab.locator(".project-reader-code-reference")).toHaveCount(0);

        const paneBody = await openBacklinksPanel(page);

        await expect(paneBody.locator(".backlinks-count")).toBeVisible();
        await expect(paneBody.locator(".backlinks-item").filter({ hasText: "note1.md" })).toBeVisible();
        await expect(paneBody.locator(".backlinks-item").filter({ hasText: "createMainRuntime" })).toBeVisible();

        await paneBody.locator(".backlinks-item").filter({ hasText: "note1.md" }).first().click();
        await waitForVisibleEditorTitle(page, "note1");
        await expect(page.locator(".layout-v2-tab-section__card--active .cm-line", { hasText: "同一个Session" })).toBeVisible();
    });
});
