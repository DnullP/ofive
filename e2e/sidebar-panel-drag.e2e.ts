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

/**
 * Mock 页面路径（不依赖 Tauri 后端）
 */
const MOCK_PAGE = "/web-mock/mock-tauri-test.html";

/* ══════════════════════════════════════════════════════════════════════
 *  右侧栏 icon 切换（layout-v2 迁移后，无需 DnD）
 * ══════════════════════════════════════════════════════════════════════ */
test.describe("右侧栏 activity icon 切换面板", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(MOCK_PAGE);
        await page.locator("[data-testid='sidebar-right']").waitFor({ state: "visible" });
        await page.locator(".layout-v2-panel-section__panel-tab").first().waitFor({ state: "visible" });
    });

    test("Case 2: 键盘快捷键切换右侧栏显隐", async ({ page }) => {
        const rightSidebar = page.locator("[data-testid='sidebar-right']");

        await expect(rightSidebar).toBeVisible();

        const outlineTab = page.locator("[data-layout-panel-id='outline'][data-layout-role='panel']");
        await expect(outlineTab).toBeVisible();

        /* 通过键盘快捷键 Cmd+Shift+K 隐藏右侧栏 */
        await page.keyboard.press("Meta+Shift+K");
        await expect(rightSidebar).toHaveCount(0);

        /* 通过键盘快捷键 Cmd+Shift+K 恢复右侧栏 */
        await page.keyboard.press("Meta+Shift+K");
        await expect(rightSidebar).toBeVisible({ timeout: 3000 });

        /* 再次 toggle 回隐藏 */
        await page.keyboard.press("Meta+Shift+K");
        await expect(rightSidebar).toHaveCount(0);
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  layout-v2 panel icon split 持久化恢复
 * ══════════════════════════════════════════════════════════════════════ */

/** 浏览器 fallback vault config 的 localStorage key 前缀。 */
const BROWSER_FALLBACK_CONFIG_PREFIX = "ofive:browser-fallback:vault-config:";

/**
 * 将 panel icon 拖到目标 panel content 底部以触发 split。
 *
 * @param page - Playwright Page。
 * @param panelId - 被拖拽的 panel id。
 * @param targetPanelSectionId - 目标 panel section id。
 */
async function splitPanelToBottom(
    page: import("@playwright/test").Page,
    panelId: string,
    targetPanelSectionId: string,
): Promise<void> {
    const source = page.locator(
        `.layout-v2-panel-section__panel-tab[data-layout-panel-id='${panelId}']`,
    ).first();
    const target = page.locator(
        `[data-layout-role='panel-content'][data-layout-panel-section-id='${targetPanelSectionId}']`,
    ).first();

    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
        targetBox!.x + targetBox!.width / 2,
        targetBox!.y + targetBox!.height - 8,
        { steps: 12 },
    );
    await page.mouse.up();
}

test.describe("layout-v2 panel icon split 持久化恢复", () => {
    test("panel icon split 后 reload 应恢复拓扑且不触发 React <fa> 错误", async ({ page }) => {
        const pageErrors: string[] = [];
        const reactWarnings: string[] = [];
        const vaultPath = `/mock/panel-icon-split-restore-${Date.now()}`;
        const storageKey = `${BROWSER_FALLBACK_CONFIG_PREFIX}${vaultPath}`;

        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });
        page.on("console", (message) => {
            const text = message.text();
            if (text.includes("An error occurred in the <") || text.includes("<fa>")) {
                reactWarnings.push(text);
            }
        });

        await page.goto(`${MOCK_PAGE}?showControls=0&mockVaultPath=${encodeURIComponent(vaultPath)}`);
        await page.evaluate((key) => window.localStorage.removeItem(key), storageKey);
        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        await splitPanelToBottom(page, "backlinks", "right-panel-section");

        await expect.poll(async () => page.evaluate((key) => {
            const raw = window.localStorage.getItem(key);
            if (!raw) return false;
            const config = JSON.parse(raw) as {
                entries?: { sidebarLayout?: { panelLayout?: { sections?: Array<{ id?: string }> } } };
            };
            return config.entries?.sidebarLayout?.panelLayout?.sections?.some(
                (section) => section.id === "right-sidebar-panels",
            ) ?? false;
        }, storageKey)).toBe(true);

        await page.reload();
        await page.locator("[data-layout-role='panel-section']").first().waitFor({ state: "visible" });

        const restoredSectionIds = await page.locator("[data-layout-role='panel-section']").evaluateAll(
            (elements) => elements.map((element) => element.getAttribute("data-layout-panel-section-id")),
        );

        expect(restoredSectionIds).toContain("right-sidebar-panels");
        await expect(page.locator(
            "[data-layout-role='panel'][data-layout-panel-section-id='right-sidebar-panels'][data-layout-panel-id='backlinks']",
        )).toBeVisible();
        expect(pageErrors).toEqual([]);
        expect(reactWarnings).toEqual([]);
    });
});
