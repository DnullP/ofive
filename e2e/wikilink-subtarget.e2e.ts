/**
 * @module e2e/wikilink-subtarget
 * @description WikiLink line/title/paragraph subtarget navigation and preview behavior.
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const GLASS_MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0&glass=1&tint=0.06&surface=0.18&inactiveSurface=0.12&blur=16";
const SOURCE_PATH = "test-resources/notes/wikilink-subtarget-source.md";
const TARGET_TAB_LABEL = "wikilink-subtarget-target.md";

async function waitForMockWorkbench(page: Page, mockPage = MOCK_PAGE): Promise<void> {
    await page.addInitScript(() => {
        localStorage.clear();
    });
    await gotoMockVaultPage(page, "wikilink-subtarget", mockPage);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section").first().waitFor({ state: "visible" });
}

async function waitForEditorFrames(page: Page, frameCount = 4): Promise<void> {
    await page.evaluate(async (count) => {
        for (let index = 0; index < count; index += 1) {
            await new Promise<void>((resolve) => {
                window.requestAnimationFrame(() => resolve());
            });
        }
    }, frameCount);
}

async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

async function openSourceNote(page: Page): Promise<void> {
    await page.getByTestId("activity-bar-item-files").click();
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${SOURCE_PATH}']`).click();
    await page.getByRole("button", { name: "wikilink-subtarget-source.md" }).first().waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
    await waitForEditorFrames(page, 2);
}

async function clickRenderedWikiLink(page: Page, label: string): Promise<void> {
    const link = page.locator(
        ".layout-v2-tab-section__card--active .cm-rendered-wikilink-display",
        { hasText: label },
    ).first();
    await expect(link).toBeVisible();
    await link.click();
    await page.getByRole("button", { name: TARGET_TAB_LABEL }).first().waitFor({ state: "visible" });
    await waitForEditorFrames(page, 4);
}

async function getActiveSelectionLineText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as (HTMLElement & {
            cmTile?: {
                view?: {
                    state: {
                        selection: {
                            main: {
                                head: number;
                            };
                        };
                        doc: {
                            lineAt(position: number): { text: string };
                        };
                    };
                };
            };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found.");
        }

        return view.state.doc.lineAt(view.state.selection.main.head).text;
    });
}

async function dispatchCmdHoverOnWikiLink(page: Page, label: string): Promise<void> {
    await page.evaluate((targetLabel) => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card--active");
        const link = Array.from(activeCard?.querySelectorAll<HTMLElement>(".cm-rendered-wikilink-display") ?? [])
            .find((element) => element.textContent?.trim() === targetLabel);
        if (!link) {
            throw new Error(`Rendered wikilink not found: ${targetLabel}`);
        }

        const rect = link.getBoundingClientRect();
        link.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            ctrlKey: true,
            metaKey: true,
        }));
    }, label);
    await waitForEditorFrames(page, 4);
}

async function switchToReadMode(page: Page): Promise<void> {
    await page.locator(".layout-v2-tab-section__card--active .cm-tab-mode-toggle").click();
    await page.locator(".layout-v2-tab-section__card--active .cm-tab-reader").waitFor({ state: "visible" });
    await waitForEditorFrames(page, 2);
}

function parseCssAlpha(color: string): number {
    const match = color.match(/^rgba?\(([^)]+)\)$/u);
    if (!match) {
        return 1;
    }

    const parts = match[1].split(",").map((part) => part.trim());
    return parts.length >= 4 ? Number(parts[3]) : 1;
}

test.describe("wikilink subtargets", () => {
    test("clicking line, title, and paragraph wikilinks reveals the specific target", async ({ page }) => {
        await waitForMockWorkbench(page);

        await openSourceNote(page);
        await clickRenderedWikiLink(page, "line target");
        await expect.poll(() => getActiveSelectionLineText(page)).toContain("Line landing marker");

        await openSourceNote(page);
        await clickRenderedWikiLink(page, "title target");
        await expect.poll(() => getActiveSelectionLineText(page)).toContain("## Deep Anchor");

        await openSourceNote(page);
        await clickRenderedWikiLink(page, "paragraph target");
        await expect.poll(() => getActiveSelectionLineText(page)).toContain("Third paragraph landing marker");
    });

    test("hover preview opens around the requested title subtarget", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openSourceNote(page);

        await dispatchCmdHoverOnWikiLink(page, "title target");

        const preview = page.locator(".cm-wikilink-preview-tooltip").last();
        const previewBody = preview.locator(".cm-wikilink-preview__body");
        await expect(preview).toBeVisible();
        await expect(preview.locator(".cm-rendered-header-h2", { hasText: "Deep Anchor" })).toBeVisible();
        await expect.poll(async () => previewBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    });

    test("hover preview keeps an opaque floating surface in glass mode", async ({ page }) => {
        await waitForMockWorkbench(page, GLASS_MOCK_PAGE);
        await openSourceNote(page);

        await dispatchCmdHoverOnWikiLink(page, "title target");

        const preview = page.locator(".cm-wikilink-preview-tooltip").last();
        await expect(preview).toBeVisible();
        await expect(preview.locator(".cm-rendered-header-h2", { hasText: "Deep Anchor" })).toBeVisible();

        const surface = await preview.evaluate((element) => {
            const tooltip = window.getComputedStyle(element);
            const body = element.querySelector<HTMLElement>(".cm-wikilink-preview__body");
            const reader = element.querySelector<HTMLElement>(".cm-tab-reader");
            const bodyStyle = body ? window.getComputedStyle(body) : null;
            const readerStyle = reader ? window.getComputedStyle(reader) : null;

            return {
                bodyBackgroundColor: bodyStyle?.backgroundColor ?? "",
                readerBackgroundColor: readerStyle?.backgroundColor ?? "",
                tooltipBackdropFilter: tooltip.backdropFilter || tooltip.webkitBackdropFilter || "",
                tooltipBackgroundColor: tooltip.backgroundColor,
            };
        });

        expect(parseCssAlpha(surface.tooltipBackgroundColor)).toBeGreaterThanOrEqual(0.75);
        expect(parseCssAlpha(surface.bodyBackgroundColor)).toBeGreaterThanOrEqual(0.75);
        expect(parseCssAlpha(surface.readerBackgroundColor)).toBeGreaterThanOrEqual(0.75);
        expect(surface.tooltipBackdropFilter).toContain("blur");
    });

    test("read mode wikilink navigation reveals the title subtarget in the reader", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openSourceNote(page);
        await switchToReadMode(page);

        await page.locator(
            ".layout-v2-tab-section__card--active .cm-tab-reader .cm-rendered-wikilink",
            { hasText: "title target" },
        ).click();

        const activeReader = page.locator(".layout-v2-tab-section__card--active .cm-tab-reader");
        await expect(activeReader.locator(".cm-rendered-header-h2", { hasText: "Deep Anchor" })).toBeVisible();
        await expect.poll(async () => activeReader.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    });
});
