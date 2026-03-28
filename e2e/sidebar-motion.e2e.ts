/**
 * @module e2e/sidebar-motion.e2e
 * @description 侧栏动效回归测试。
 *
 * 覆盖场景：
 * 1. 左侧活动栏重复点击后，sidebar 应从 visible 进入 exiting 并最终 hidden，不能卡死在 exiting
 * 2. 左侧 sidebar 再次打开后应恢复为 visible，且容器重新挂载
 * 3. 右侧 icon 点击可切换 active 项并正确隐藏/恢复右侧 sidebar
 * 4. 新增 sidebar 动效后，知识图谱入口仍可正常打开 Dockview tab
 *
 * @dependencies
 *   - @playwright/test
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";

/**
 * @function waitForMockLayoutReady
 * @description 等待 mock 布局进入可操作状态。
 * @param page Playwright 页面对象。
 * @returns Promise<void>
 */
async function waitForMockLayoutReady(page: Page): Promise<void> {
    await page.locator(".dockview-layout").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-left']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-right']").waitFor({ state: "visible" });
    await page.locator(".dv-tab").first().waitFor({ state: "visible" });
}

/**
 * @function layoutLocator
 * @description 返回 DockviewLayout 根元素定位器。
 * @param page Playwright 页面对象。
 * @returns 根元素定位器。
 */
function layoutLocator(page: Page): Locator {
    return page.locator(".dockview-layout");
}

/**
 * @function readMotionState
 * @description 读取布局根元素上的 sidebar 动画状态属性。
 * @param page Playwright 页面对象。
 * @param side 侧栏方向。
 * @returns 当前动画状态。
 */
async function readMotionState(page: Page, side: "left" | "right"): Promise<string | null> {
    return layoutLocator(page).getAttribute(`data-${side}-sidebar-motion-state`);
}

/**
 * @function expectSidebarSettled
 * @description 断言侧栏最终稳定在目标状态，并校验容器是否存在。
 * @param page Playwright 页面对象。
 * @param side 侧栏方向。
 * @param expectedState 预期稳定状态。
 * @returns Promise<void>
 */
async function expectSidebarSettled(
    page: Page,
    side: "left" | "right",
    expectedState: "visible" | "hidden",
): Promise<void> {
    await expect.poll(async () => readMotionState(page, side)).toBe(expectedState);

    const sidebar = page.locator(`[data-testid='sidebar-${side}']`);
    if (expectedState === "visible") {
        await expect(sidebar).toBeVisible();
        return;
    }

    await expect(sidebar).toHaveCount(0);
}

test.describe("sidebar motion regression", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await waitForMockLayoutReady(page);
    });

    test("left sidebar exits cleanly and can reopen", async ({ page }) => {
        const filesIcon = page.getByTestId("activity-bar-item-files");

        await expectSidebarSettled(page, "left", "visible");
        await filesIcon.click();

        await expect.poll(async () => {
            const state = await readMotionState(page, "left");
            return state === "exiting" || state === "hidden";
        }).toBe(true);
        await expectSidebarSettled(page, "left", "hidden");

        await filesIcon.click();
        await expect.poll(async () => {
            const state = await readMotionState(page, "left");
            return state === "entering" || state === "visible";
        }).toBe(true);
        await expectSidebarSettled(page, "left", "visible");
    });

    test("right sidebar can switch active item and then hide", async ({ page }) => {
        const outlineIcon = page.getByTestId("right-activity-icon-outline");
        const aiChatIcon = page.getByTestId("right-activity-icon-ai-chat-mock");

        await expectSidebarSettled(page, "right", "visible");

        await outlineIcon.click();
        await expect(outlineIcon).toHaveClass(/active/);

        await aiChatIcon.click();
        await expect(aiChatIcon).toHaveClass(/active/);
        await expectSidebarSettled(page, "right", "visible");

        await aiChatIcon.click();
        await expect.poll(async () => {
            const state = await readMotionState(page, "right");
            return state === "exiting" || state === "hidden";
        }).toBe(true);
        await expectSidebarSettled(page, "right", "hidden");

        await page.keyboard.press("Meta+Shift+K");
        await expectSidebarSettled(page, "right", "visible");
        await expect(outlineIcon).toBeVisible();
    });

    test("knowledge graph tab still opens after sidebar motion transitions", async ({ page }) => {
        await page.getByTestId("activity-bar-item-files").click();
        await expectSidebarSettled(page, "left", "hidden");

        await page.getByTestId("activity-bar-item-knowledge-graph").click();

        await expect(page.locator(".dv-tab", { hasText: "知识图谱" })).toBeVisible();
        await expect(page.locator(".knowledge-graph-tab, .knowledge-graph-canvas").first()).toBeVisible();
    });
});