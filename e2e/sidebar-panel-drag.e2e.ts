/**
 * @module e2e/sidebar-panel-drag.e2e
 * @description 侧栏面板跨容器拖拽 E2E 测试。
 *
 * 验证场景：
 * 1. 左侧栏面板拖拽到右侧栏：面板从左侧消失，出现在右侧
 * 2. 点击右侧栏 activity icon 切换面板
 * 3. 右侧栏面板拖拽回左侧栏（回归：拖回后不消失）
 * 4. Icon-Panel 解耦：拖拽面板时 icon 不跟随移动
 * 5. 面板加入目标 activity 分组：拖到右侧后归属目标 activity
 * 6. 面板往返拖拽后 icon 位置不变
 *
 * 前置条件（Mock 页面默认布局）：
 *   - 左侧栏：资源管理器（files activity）
 *   - 右侧栏：大纲 + 反向链接（outline activity）
 *
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/dockviewDrag
 *
 * @example
 *   bun run test:e2e
 */

import { test, expect } from "@playwright/test";
import { dockviewDragPanel } from "./helpers/dockviewDrag";

/**
 * Mock 页面路径（不依赖 Tauri 后端）
 */
const MOCK_PAGE = "/web-mock/mock-tauri-test.html";

/**
 * 等待应用就绪：侧栏面板渲染完毕。
 *
 * @param page - Playwright Page
 */
async function waitForAppReady(page: import("@playwright/test").Page): Promise<void> {
    /* 等待左侧栏出现 */
    await page.locator("[data-testid='sidebar-left']").waitFor({ state: "visible" });
    /* 等待至少一个面板头出现 */
    await page.locator(".dv-pane-header").first().waitFor({ state: "visible" });
}

test.describe("侧栏面板跨容器拖拽", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await waitForAppReady(page);
    });

    test("Case 1: 将左侧栏面板拖拽到右侧栏", async ({ page }) => {
        /* 获取左侧栏中第一个可拖拽面板头 */
        const leftSidebar = page.locator("[data-testid='sidebar-left']");
        const srcHeader = leftSidebar.locator('.dv-pane-header[draggable="true"]').first();
        const srcTitle = await srcHeader.textContent();
        expect(srcTitle).toBeTruthy();

        /* 获取右侧栏中第一个面板头作为 drop target */
        const rightSidebar = page.locator("[data-testid='sidebar-right']");
        const targetHeader = rightSidebar.locator('.dv-pane-header[draggable="true"]').first();

        /* 执行拖拽：左→右 */
        await dockviewDragPanel(page, srcHeader, targetHeader);

        /* 断言：右侧栏出现被拖入的面板 */
        const rightPanelHeaders = rightSidebar.locator(".dv-pane-header");
        await expect(
            rightPanelHeaders.filter({ hasText: srcTitle! }),
        ).toBeVisible({ timeout: 5000 });

        /* 断言：左侧栏不再包含该面板（可能显示空占位或另一个面板） */
        const leftPanelHeaders = leftSidebar.locator(".dv-pane-header");
        await expect(
            leftPanelHeaders.filter({ hasText: srcTitle! }),
        ).toHaveCount(0);
    });

    test("Case 2: 点击右侧栏 activity icon 切换面板", async ({ page }) => {
        const rightSidebar = page.locator("[data-testid='sidebar-right']");

        /* 右侧栏初始应显示 outline activity 对应的面板 */
        await expect(rightSidebar).toBeVisible();

        /* 确认大纲 icon 存在；若初始尚未进入 active，则先显式激活，避免异步装载抖动 */
        const outlineIcon = page.locator("[data-testid='right-activity-icon-outline']");
        await expect(outlineIcon).toBeVisible();

        const outlineIconClass = (await outlineIcon.getAttribute("class")) ?? "";
        if (!outlineIconClass.includes("active")) {
            await outlineIcon.click();
            await expect(outlineIcon).toHaveClass(/active/);
        }

        /* 点击已激活的 outline icon → toggle OFF，隐藏右侧栏 */
        await outlineIcon.click();
        await expect(rightSidebar).not.toBeVisible({ timeout: 3000 });

        /* 通过键盘快捷键 Cmd+Shift+K 恢复右侧栏（icon 随侧栏一起隐藏） */
        await page.keyboard.press("Meta+Shift+K");
        await expect(rightSidebar).toBeVisible({ timeout: 3000 });

        /* 再次 toggle 回隐藏 */
        await page.keyboard.press("Meta+Shift+K");
        await expect(rightSidebar).not.toBeVisible({ timeout: 3000 });
    });

    test("Case 3: 右侧栏面板拖到左侧栏再拖回", async ({ page }) => {
        const leftSidebar = page.locator("[data-testid='sidebar-left']");
        const rightSidebar = page.locator("[data-testid='sidebar-right']");

        /* 记录右侧栏第一个面板标题（如 "大纲"） */
        const rightHeader = rightSidebar.locator('.dv-pane-header[draggable="true"]').first();
        const rightTitle = await rightHeader.textContent();
        expect(rightTitle).toBeTruthy();

        /* 记录左侧栏面板头作为 drop target */
        const leftTarget = leftSidebar.locator('.dv-pane-header[draggable="true"]').first();

        /* Step 1: 将右侧面板拖到左侧 */
        await dockviewDragPanel(page, rightHeader, leftTarget);

        /* 断言：左侧栏出现被拖入的面板 */
        await expect(
            leftSidebar.locator(".dv-pane-header").filter({ hasText: rightTitle! }),
        ).toBeVisible({ timeout: 5000 });

        /* Step 2: 把面板拖回右侧 */
        const panelOnLeft = leftSidebar.locator(".dv-pane-header").filter({ hasText: rightTitle! });

        /* 右侧栏可能还有面板（如 "反向链接"），也可能显示空占位 */
        const rightEmpty = rightSidebar.locator("[data-testid='right-sidebar-empty']");
        const rightHasEmpty = await rightEmpty.isVisible().catch(() => false);

        if (rightHasEmpty) {
            await dockviewDragPanel(page, panelOnLeft, rightEmpty);
        } else {
            const rightTarget = rightSidebar.locator('.dv-pane-header[draggable="true"]').first();
            await dockviewDragPanel(page, panelOnLeft, rightTarget);
        }

        /* 断言：面板回到右侧栏，没有消失（回归保护） */
        await expect(
            rightSidebar.locator(".dv-pane-header").filter({ hasText: rightTitle! }),
        ).toBeVisible({ timeout: 5000 });
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  Icon-Panel 解耦验证
 * ══════════════════════════════════════════════════════════════════════ */
test.describe("Icon-Panel 解耦：拖拽面板时 icon 不移动", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await waitForAppReady(page);
    });

    test("Case 4: 左→右拖拽后 files icon 仍在左侧活动栏", async ({ page }) => {
        const leftSidebar = page.locator("[data-testid='sidebar-left']");
        const rightSidebar = page.locator("[data-testid='sidebar-right']");

        /* 初始：files icon 在左侧活动栏，outline icon 在右侧 */
        await expect(page.locator("[data-testid='activity-bar-item-files']")).toBeVisible();
        await expect(page.locator("[data-testid='right-activity-icon-outline']")).toBeVisible();

        /* 拖拽 资源管理器 到右侧栏的 大纲 面板 */
        const srcHeader = leftSidebar.locator('.dv-pane-header[draggable="true"]').first();
        const targetHeader = rightSidebar.locator('.dv-pane-header[draggable="true"]').first();
        await dockviewDragPanel(page, srcHeader, targetHeader);

        /* 断言：面板已移到右侧 */
        await expect(
            rightSidebar.locator(".dv-pane-header").filter({ hasText: "资源管理器" }),
        ).toBeVisible({ timeout: 5000 });

        /* 核心断言：files icon 仍在左侧活动栏（没有跟随面板移动） */
        await expect(page.locator("[data-testid='activity-bar-item-files']")).toBeVisible();

        /* 核心断言：右侧 icon 栏没有出现 files icon */
        await expect(page.locator("[data-testid='right-activity-icon-files']")).toHaveCount(0);

        /* outline icon 仍在右侧 */
        await expect(page.locator("[data-testid='right-activity-icon-outline']")).toBeVisible();
    });

    test("Case 5: 面板加入目标 activity 分组，归属右侧 outline 组", async ({ page }) => {
        const leftSidebar = page.locator("[data-testid='sidebar-left']");
        const rightSidebar = page.locator("[data-testid='sidebar-right']");

        /* 拖拽 资源管理器 到右侧栏的 大纲 面板 */
        const srcHeader = leftSidebar.locator('.dv-pane-header[draggable="true"]').first();
        const targetHeader = rightSidebar.locator('.dv-pane-header[draggable="true"]').first();
        await dockviewDragPanel(page, srcHeader, targetHeader);

        /* 断言：右侧栏显示 3 个面板（资源管理器 + 大纲 + 反向链接） */
        const rightHeaders = rightSidebar.locator(".dv-pane-header");
        await expect(rightHeaders).toHaveCount(3, { timeout: 5000 });

        /* 断言：左侧栏面板头为空（显示空占位） */
        const leftHeaders = leftSidebar.locator(".dv-pane-header");
        await expect(leftHeaders).toHaveCount(0);
    });

    test("Case 6: 面板往返拖拽后 icon 位置始终不变", async ({ page }) => {
        const leftSidebar = page.locator("[data-testid='sidebar-left']");
        const rightSidebar = page.locator("[data-testid='sidebar-right']");

        /* Step 1: 左→右 */
        const srcHeader = leftSidebar.locator('.dv-pane-header[draggable="true"]').first();
        const rightTarget = rightSidebar.locator('.dv-pane-header[draggable="true"]').first();
        await dockviewDragPanel(page, srcHeader, rightTarget);

        /* 验证拖拽成功 */
        await expect(
            rightSidebar.locator(".dv-pane-header").filter({ hasText: "资源管理器" }),
        ).toBeVisible({ timeout: 5000 });

        /* icon 位置不变 */
        await expect(page.locator("[data-testid='activity-bar-item-files']")).toBeVisible();
        await expect(page.locator("[data-testid='right-activity-icon-outline']")).toBeVisible();

        /* Step 2: 右→左（拖回空的左侧栏） */
        const panelOnRight = rightSidebar.locator(".dv-pane-header").filter({ hasText: "资源管理器" });
        const leftEmpty = leftSidebar.locator("[data-testid='left-sidebar-empty']");
        await dockviewDragPanel(page, panelOnRight, leftEmpty);

        /* 验证拖回成功 */
        await expect(
            leftSidebar.locator(".dv-pane-header").filter({ hasText: "资源管理器" }),
        ).toBeVisible({ timeout: 5000 });

        /* 核心断言：往返后 icon 位置仍然不变 */
        await expect(page.locator("[data-testid='activity-bar-item-files']")).toBeVisible();
        await expect(page.locator("[data-testid='right-activity-icon-outline']")).toBeVisible();
        await expect(page.locator("[data-testid='right-activity-icon-files']")).toHaveCount(0);
    });
});
