/**
 * @module e2e/custom-activity.e2e
 * @description 自定义 Activity 创建流程 E2E 回归测试。
 *
 * 覆盖场景：
 * 1. 通过指令搜索执行 `customActivity.create`
 * 2. 打开自定义 Activity 创建 modal
 * 3. 创建 panel-container 类型的自定义 Activity
 * 4. 验证左侧活动栏出现新按钮，并可打开默认 panel
 *
 * @dependencies
 *   - @playwright/test
 */

import { expect, test, type Page } from "@playwright/test";
import { dockviewDragPanel } from "./helpers/dockviewDrag";
import { gotoMockVaultPage } from "./helpers/mockVault";

/**
 * 等待布局进入可操作状态。
 *
 * @param page - Playwright 页面对象
 * @returns Promise<void>
 */
async function waitForLayoutReady(page: Page): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await page.locator(".dv-tab").first().waitFor({ state: "visible" });
    await page.locator(".dv-pane-header").first().waitFor({ state: "visible" });
}

async function deleteCustomActivity(page: Page, activityId: string): Promise<void> {
    await page.evaluate(async (targetActivityId) => {
        const configModule = await import("/src/plugins/custom-activity/customActivityConfig.ts");
        const activityBarModule = await import("/src/host/layout/activityBarStore.ts");
        const configStoreModule = await import("/src/host/store/configStore.ts");
        const targetRegistrationId = `custom-activity:${targetActivityId}`;

        const nextActivityBarItems: Array<{
            id: string;
            section: "top" | "bottom";
            visible: boolean;
            bar?: "left" | "right";
        }> = [];

        const config = configStoreModule.getConfigSnapshot().backendConfig;
        const items = (config?.entries?.activityBar as {
            items?: Array<{
                id?: string;
                section?: "top" | "bottom";
                visible?: boolean;
                bar?: "left" | "right";
            }>;
        } | undefined)?.items;
        if (Array.isArray(items)) {
            nextActivityBarItems.push(
                ...items.filter((item): item is {
                    id: string;
                    section: "top" | "bottom";
                    visible: boolean;
                    bar?: "left" | "right";
                } => typeof item.id === "string" && item.id !== targetRegistrationId),
            );
        }

        activityBarModule.updateActivityBarConfig({ items: nextActivityBarItems });
        await configModule.removeCustomActivityFromVaultConfig(targetActivityId);
    }, activityId);
}

/**
 * 通过现有命令面板创建一个默认的自定义 panel-container activity。
 *
 * @param page - Playwright 页面对象
 * @param activityName - 自定义 activity 名称
 * @returns Promise<void>
 */
async function createCustomPanelContainer(page: Page, activityName: string): Promise<void> {
    await page.keyboard.press("Meta+J");

    const commandPalette = page.locator(".command-palette-panel");
    await expect(commandPalette).toBeVisible();

    const commandInput = commandPalette.locator(".command-palette-input");
    await commandInput.fill("customActivity.create");
    await page.keyboard.press("Enter");

    const modal = page.locator(".custom-activity-modal");
    await expect(modal).toBeVisible();
    await modal.locator(".custom-activity-modal__input").fill(activityName);
    await modal.locator(".custom-activity-modal__button.primary").click();
    await expect(modal).toHaveCount(0);
}

/**
 * 将左侧 ActivityBar 中的图标拖到右侧 SidebarIconBar。
 *
 * @param page - Playwright 页面对象
 * @param activityRegistrationId - 运行时 activity 注册 id
 * @returns Promise<void>
 */
async function moveActivityIconToRightBar(page: Page, activityRegistrationId: string): Promise<void> {
    const source = page.getByTestId(`activity-bar-item-${activityRegistrationId}`);
    const target = page.locator(".sidebar-icon-bar").first();
    await dockviewDragPanel(page, source, target);
}

/**
 * 从当前可见的 activity 按钮 DOM 上解析运行时注册 id。
 *
 * @param page - Playwright 页面对象
 * @param activityName - activity 按钮标题
 * @returns Promise<string>
 */
async function resolveActivityRegistrationIdFromButton(page: Page, activityName: string): Promise<string> {
    const button = page.getByTitle(activityName).first();
    await expect(button).toBeVisible();
    const testId = await button.getAttribute("data-testid");
    if (!testId) {
        throw new Error(`activity button testid missing for: ${activityName}`);
    }

    if (testId.startsWith("activity-bar-item-")) {
        return testId.slice("activity-bar-item-".length);
    }
    if (testId.startsWith("right-activity-icon-")) {
        return testId.slice("right-activity-icon-".length);
    }

    throw new Error(`unexpected activity button testid: ${testId}`);
}

test.describe("自定义 Activity", () => {
    test("可通过现有指令创建自定义按钮并正常打开 panel", async ({ page }) => {
        const activityName = `测试按钮-${Date.now()}`;

        await gotoMockVaultPage(page, "custom-activity-create-command");
        await waitForLayoutReady(page);

        const explorerActivityButton = page.getByTestId("activity-bar-item-files");
        const searchActivityButton = page.getByTestId("activity-bar-item-search");
        const calendarActivityButton = page.getByTestId("activity-bar-item-calendar");
        await expect(explorerActivityButton).toBeVisible();
        await expect(searchActivityButton).toBeVisible();
        await expect(calendarActivityButton).toBeVisible();

        await createCustomPanelContainer(page, activityName);
        await expect(explorerActivityButton).toBeVisible();
        await expect(searchActivityButton).toBeVisible();
        await expect(calendarActivityButton).toBeVisible();

        const activityButton = page.getByTitle(activityName);
        await expect(activityButton).toBeVisible();

        await activityButton.click();

        const leftSidebar = page.locator("[aria-label='Left Extension Panel']");
        await expect(leftSidebar.getByTestId("left-sidebar-header")).toContainText(activityName);
        await expect(leftSidebar.getByTestId("left-sidebar-empty")).toBeVisible();
        await expect(leftSidebar.locator(".dv-pane-header", { hasText: activityName })).toHaveCount(0);
    });

    test("创建使用 Calendar 图标的自定义 Activity 后不应让原生日历按钮消失", async ({ page }) => {
        const activityName = `MCP自定义日历-${Date.now()}`;

        await gotoMockVaultPage(page, "custom-activity-calendar-icon");
        await waitForLayoutReady(page);

        const calendarActivityButton = page.getByTestId("activity-bar-item-calendar");
        await expect(calendarActivityButton).toBeVisible();

        await page.keyboard.press("Meta+J");

        const commandPalette = page.locator(".command-palette-panel");
        await expect(commandPalette).toBeVisible();

        const commandInput = commandPalette.locator(".command-palette-input");
        await commandInput.fill("customActivity.create");
        await page.keyboard.press("Enter");

        const modal = page.locator(".custom-activity-modal");
        await expect(modal).toBeVisible();

        await modal.locator(".custom-activity-modal__input").fill(activityName);
        await modal.getByRole("button", { name: "Calendar" }).click();
        await modal.locator(".custom-activity-modal__button.primary").click();

        await expect(modal).toHaveCount(0);
        await expect(calendarActivityButton).toBeVisible();
        await expect(page.getByTitle(activityName)).toBeVisible();
    });

    test("删除自定义 Activity 后不应让布局崩溃", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        const activityName = `删除测试-${Date.now()}`;

        await gotoMockVaultPage(page, "custom-activity-delete-no-crash");
        await waitForLayoutReady(page);

        await createCustomPanelContainer(page, activityName);

        const createdActivityButton = page.getByTitle(activityName);
        await expect(createdActivityButton).toBeVisible();
        await createdActivityButton.click();

        const createdActivityRegistrationId = await resolveActivityRegistrationIdFromButton(page, activityName);
        const createdActivityId = createdActivityRegistrationId.replace(/^custom-activity:/, "");
        await deleteCustomActivity(page, createdActivityId);

        await expect(createdActivityButton).toHaveCount(0);
        await expect(page.locator("main").first()).toBeVisible();
        await expect(page.locator(".dv-tab").first()).toBeVisible();
        expect(pageErrors).toEqual([]);
    });

    test("删除自定义 Activity 后 reload 不应恢复该 icon", async ({ page }) => {
        const activityName = `删除持久化-${Date.now()}`;
        await gotoMockVaultPage(page, "custom-activity-delete-persistence");
        await waitForLayoutReady(page);

        await createCustomPanelContainer(page, activityName);

        const createdActivityButton = page.getByTitle(activityName);
        await expect(createdActivityButton).toBeVisible();

        const createdActivityRegistrationId = await resolveActivityRegistrationIdFromButton(page, activityName);
        const createdActivityId = createdActivityRegistrationId.replace(/^custom-activity:/, "");
        await deleteCustomActivity(page, createdActivityId);

        await expect(createdActivityButton).toHaveCount(0);
        await page.waitForTimeout(450);
        await page.reload();
        await waitForLayoutReady(page);

        await expect(page.getByTitle(activityName)).toHaveCount(0);
        await expect(page.getByTestId("activity-bar-item-calendar")).toBeVisible();
    });

    test("右侧自定义容器中的日历 panel 在 reload 后应与 icon 位置一起恢复", async ({ page }) => {
        const activityName = `右栏日历容器-${Date.now()}`;
        await gotoMockVaultPage(page, "custom-activity-right-calendar-reload");
        await waitForLayoutReady(page);

        await createCustomPanelContainer(page, activityName);

        const activityRegistrationId = await resolveActivityRegistrationIdFromButton(page, activityName);
        const activityConfigId = activityRegistrationId.replace(/^custom-activity:/, "");
        await moveActivityIconToRightBar(page, activityRegistrationId);

        const leftActivityIcon = page.getByTestId(`activity-bar-item-${activityRegistrationId}`);
        const rightActivityIcon = page.getByTestId(`right-activity-icon-${activityRegistrationId}`);
        await expect(leftActivityIcon).toHaveCount(0);
        await expect(rightActivityIcon).toBeVisible();

        const rightSidebar = page.locator("[aria-label='Right Extension Panel']");
        const rightEmptyContainer = rightSidebar.getByTestId("right-sidebar-empty");
        await expect(rightEmptyContainer).toBeVisible();

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();

        await dockviewDragPanel(page, calendarTab, rightEmptyContainer);

        const calendarPaneHeader = rightSidebar.locator(".dv-pane-header", { hasText: "Calendar" }).first();
        await expect(calendarPaneHeader).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toHaveCount(0);

        await page.waitForTimeout(450);
        await page.reload();
        await waitForLayoutReady(page);

        await expect(page.getByTestId(`activity-bar-item-${activityRegistrationId}`)).toHaveCount(0);
        await expect(page.getByTestId(`right-activity-icon-${activityRegistrationId}`)).toBeVisible();
        await expect(rightSidebar.locator(".dv-pane-header", { hasText: activityName }).first()).toHaveCount(0);
        await expect(rightSidebar.locator(".dv-pane-header", { hasText: "Calendar" }).first()).toBeVisible();
        await expect(page.locator(".dv-tab", { hasText: "Calendar" })).toHaveCount(0);
    });

    test("删除名称为日历的自定义容器后不应触发 Dockview 崩溃且 reload 仍可启动", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        const activityName = "日历";
        await gotoMockVaultPage(page, "custom-activity-delete-calendar-named-container");
        await waitForLayoutReady(page);

        await page.keyboard.press("Meta+J");
        const commandPalette = page.locator(".command-palette-panel");
        await expect(commandPalette).toBeVisible();

        const commandInput = commandPalette.locator(".command-palette-input");
        await commandInput.fill("customActivity.create");
        await page.keyboard.press("Enter");

        const modal = page.locator(".custom-activity-modal");
        await expect(modal).toBeVisible();
        await modal.locator(".custom-activity-modal__input").fill(activityName);
        await modal.getByRole("button", { name: "Calendar" }).click();
        await modal.locator(".custom-activity-modal__button.primary").click();
        await expect(modal).toHaveCount(0);

        const activityRegistrationId = await resolveActivityRegistrationIdFromButton(page, activityName);
        const activityConfigId = activityRegistrationId.replace(/^custom-activity:/, "");
        await moveActivityIconToRightBar(page, activityRegistrationId);

        const rightSidebar = page.locator("[aria-label='Right Extension Panel']");
        const rightEmptyContainer = rightSidebar.getByTestId("right-sidebar-empty");
        await expect(rightEmptyContainer).toBeVisible();

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".dv-tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();
        await dockviewDragPanel(page, calendarTab, rightEmptyContainer);

        await expect(rightSidebar.locator(".dv-pane-header", { hasText: "Calendar" }).first()).toBeVisible();

        await deleteCustomActivity(page, activityConfigId);

        await page.waitForTimeout(450);
        await expect(page.locator("main").first()).toBeVisible();
        await expect(page.locator(".dv-tab").first()).toBeVisible();
        expect(pageErrors).toEqual([]);

        await page.reload();
        await waitForLayoutReady(page);

        await expect(page.getByTestId(`right-activity-icon-${activityRegistrationId}`)).toHaveCount(0);
        await expect(page.getByTitle(activityName)).toHaveCount(0);
        await expect(page.getByTestId("activity-bar-item-calendar")).toBeVisible();
        expect(pageErrors).toEqual([]);
    });
});