/**
 * @module e2e/outline-reveal
 * @description Outline heading clicks should reveal the target heading near the editor center.
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const OUTLINE_NOTE_PATH = "test-resources/notes/outline-reveal.md";
const TARGET_HEADING = "Deep Outline Target";

interface CodeMirrorContentElement extends HTMLElement {
    cmTile?: {
        view?: {
            scrollDOM: HTMLElement;
            coordsAtPos(position: number): { top: number; bottom: number } | null;
            state: {
                doc: {
                    toString(): string;
                    lineAt(position: number): { from: number };
                };
            };
        };
    };
}

async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.addInitScript(() => {
        localStorage.clear();
    });
    await gotoMockVaultPage(page, "outline-reveal", MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
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

async function openOutlineFixture(page: Page): Promise<void> {
    await page.getByTestId("activity-bar-item-files").click();
    await expandMockNotes(page);
    await page.locator(`.tree-item[data-tree-path='${OUTLINE_NOTE_PATH}']`).click();
    await page.getByRole("button", { name: "outline-reveal.md" }).first().waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
}

async function readHeadingVisualPosition(page: Page): Promise<{
    deltaFromCenter: number;
    lineCenter: number;
    scrollerCenter: number;
    scrollTop: number;
}> {
    return page.evaluate((targetHeading) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as CodeMirrorContentElement | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found on active editor.");
        }

        const targetOffset = view.state.doc.toString().indexOf(`## ${targetHeading}`);
        if (targetOffset < 0) {
            throw new Error(`Target heading not found: ${targetHeading}`);
        }

        const targetLine = view.state.doc.lineAt(targetOffset);
        const coords = view.coordsAtPos(targetLine.from);
        if (!coords) {
            throw new Error("Target heading coordinates unavailable.");
        }

        const scrollerRect = view.scrollDOM.getBoundingClientRect();
        const lineCenter = (coords.top + coords.bottom) / 2;
        const scrollerCenter = scrollerRect.top + scrollerRect.height / 2;

        return {
            deltaFromCenter: Math.abs(lineCenter - scrollerCenter),
            lineCenter,
            scrollerCenter,
            scrollTop: view.scrollDOM.scrollTop,
        };
    }, TARGET_HEADING);
}

test.describe("outline reveal alignment", () => {
    test("clicking a deep heading centers the target line in the active editor", async ({ page }) => {
        await waitForMockWorkbench(page);
        await openOutlineFixture(page);

        await page.locator("[data-testid='sidebar-right'] [data-layout-panel-id='outline'][data-layout-role='panel']").click();
        await page.getByRole("button", { name: TARGET_HEADING }).click();

        await expect.poll(async () => (await readHeadingVisualPosition(page)).deltaFromCenter)
            .toBeLessThan(80);

        const position = await readHeadingVisualPosition(page);
        expect(position.scrollTop).toBeGreaterThan(1200);
        expect(position.lineCenter).toBeGreaterThan(0);
        expect(position.scrollerCenter).toBeGreaterThan(0);
    });
});
