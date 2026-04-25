/**
 * @module e2e/main-tab-predestroy
 * @description 主区 tab 从右向左拖拽时的预销毁回归测试。
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const MOUSE_DRAG_TAG = "@mouse-drag";

async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await page.locator("[data-testid='main-dockview-host']").waitFor({ state: "visible" });
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: "首页" }).first().waitFor({ state: "visible" });
}

async function openMockGuideTab(page: Page): Promise<void> {
    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes/guide.md']").click();
    await page.locator(".layout-v2-tab-section__tab-main", { hasText: "guide.md" }).first().waitFor({ state: "visible" });
}

async function dragLocatorToPoint(
    page: Page,
    locator: Locator,
    targetX: number,
    targetY: number,
): Promise<void> {
    const box = await locator.boundingBox();
    if (!box) {
        throw new Error("dragLocatorToPoint: source bounds missing");
    }

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(200);
}

async function createRightSideSplit(page: Page): Promise<void> {
    const sourceTab = page.locator(".layout-v2-tab-section__tab-main", { hasText: "guide.md" }).first();
    const targetContent = page.locator('.layout-v2-tab-section[data-tab-section-id="main-tabs"] .layout-v2-tab-section__content').first();
    const targetBounds = await targetContent.boundingBox();
    if (!targetBounds) {
        throw new Error("createRightSideSplit: target bounds missing");
    }

    await dragLocatorToPoint(
        page,
        sourceTab,
        targetBounds.x + targetBounds.width - 16,
        targetBounds.y + targetBounds.height / 2,
    );
}

async function readProjectedTabSections(page: Page): Promise<Array<{ id: string | null; titles: string[] }>> {
    return page.evaluate(() => {
        const overlayRoot = document.querySelector<HTMLElement>("[data-layout-tab-preview-overlay='true']");
        const queryRoot: ParentNode = overlayRoot ?? document;
        return Array.from(queryRoot.querySelectorAll<HTMLElement>(".layout-v2-tab-section")).map((node) => ({
            id: node.getAttribute("data-tab-section-id"),
            titles: Array.from(node.querySelectorAll<HTMLElement>(".layout-v2-tab-section__tab-title")).map((item) => item.textContent ?? ""),
        }));
    });
}

test.describe("main tab pre-destroy", () => {
    test(`right-to-left lone-tab drag should not leave an empty shell ${MOUSE_DRAG_TAG}`, async ({ page }) => {
        await waitForMockWorkbench(page);
        await openMockGuideTab(page);
        await createRightSideSplit(page);

        const sourceTab = page.locator('.layout-v2-tab-section[data-tab-section-id="main-tabs-tabs"] .layout-v2-tab-section__tab-main', {
            hasText: "guide.md",
        }).first();
        const sourceBounds = await sourceTab.boundingBox();
        if (!sourceBounds) {
            throw new Error("right-to-left pre-destroy: source bounds missing");
        }

        const startX = sourceBounds.x + sourceBounds.width / 2;
        const startY = sourceBounds.y + sourceBounds.height / 2;

        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX - 24, startY, { steps: 10 });
        await page.waitForTimeout(120);

        const sections = await readProjectedTabSections(page);
        expect(sections).toHaveLength(1);
        expect(sections[0]?.id).toBe("main-tabs");
        expect(sections.some((section) => section.titles.length === 0)).toBe(false);
        await expect(page.getByText("No open tabs")).toHaveCount(0);

        await page.mouse.up();
    });
});