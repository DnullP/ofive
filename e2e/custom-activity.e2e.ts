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
    await page.locator(".layout-v2-tab-section__tab").first().waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-left']").first().waitFor({ state: "visible" });
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
    // 快捷键绑定可能尚未加载完成，等待后重试
    try {
        await expect(commandPalette).toBeVisible({ timeout: 2000 });
    } catch {
        await page.keyboard.press("Meta+J");
        await expect(commandPalette).toBeVisible();
    }

    const commandInput = commandPalette.locator(".command-palette-input");
    await commandInput.fill("customActivity.create");
    await commandPalette
        .locator(".command-palette-item")
        .filter({ hasText: "customActivity.create" })
        .first()
        .click();

    const modal = page.locator(".custom-activity-modal");
    await expect(modal).toBeVisible();
    await modal.locator(".custom-activity-modal__input").fill(activityName);
    await modal.locator(".custom-activity-modal__button.primary").click();
    await expect(modal).toHaveCount(0);
}

/**
 * 通过 HTML5 DragEvent 将 Activity icon 从一个栏拖到另一个栏。
 *
 * @param page - Playwright 页面对象
 * @param source - 拖拽源 icon locator
 * @param target - 放置目标 icon bar locator
 * @returns Promise<void>
 */
async function dragActivityIcon(
    page: Page,
    source: ReturnType<Page["locator"]>,
    target: ReturnType<Page["locator"]>,
): Promise<void> {
    await source.waitFor({ state: "visible" });
    await target.waitFor({ state: "visible" });
    await source.dragTo(target);
    await page.waitForTimeout(300);
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
    const target = page.locator("[aria-label='Right Extension Panel'] .sidebar-icon-bar").first();
    await dragActivityIcon(page, source, target);
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

/**
 * @function waitForRightCustomCalendarPersistence
 * @description 等待自定义右侧容器及其承载的日历 panel 真实写入后端配置，避免在 debounce 保存完成前 reload。
 * @param page Playwright 页面对象。
 * @param activityRegistrationId 自定义 activity 的运行时注册 id。
 * @param activityConfigId 自定义 activity 的配置 id。
 * @returns Promise<void>
 */
async function waitForRightCustomCalendarPersistence(
    page: Page,
    activityRegistrationId: string,
    activityConfigId: string,
): Promise<void> {
    await expect.poll(async () => {
        return page.evaluate(async ({ nextActivityRegistrationId, nextActivityConfigId }) => {
            const vaultApi = await import("/src/api/vaultApi.ts");
            const config = await vaultApi.getCurrentVaultConfig();

            const activityBarItems = Array.isArray(config.entries.activityBar?.items)
                ? config.entries.activityBar.items
                : [];
            const sidebarLayout = config.entries.sidebarLayout;
            const rightRail = sidebarLayout && typeof sidebarLayout === "object"
                ? (sidebarLayout as {
                    right?: { activeActivityId?: string | null };
                    panelStates?: Array<{ id?: string; position?: string; activityId?: string }>;
                }).right
                : undefined;
            const panelStates = sidebarLayout && typeof sidebarLayout === "object" && Array.isArray((sidebarLayout as { panelStates?: unknown }).panelStates)
                ? (sidebarLayout as { panelStates: Array<{ id?: string; position?: string; activityId?: string }> }).panelStates
                : [];

            const targetActivity = activityBarItems.find((item) => item?.id === nextActivityRegistrationId);
            const calendarPanelState = panelStates.find((item) => item.id === "calendar-panel");
            const customPanelState = panelStates.find((item) => item.id === `custom-panel:${nextActivityConfigId}`);

            return Boolean(
                targetActivity?.bar === "right" &&
                rightRail?.activeActivityId === nextActivityRegistrationId &&
                calendarPanelState?.position === "right" &&
                calendarPanelState?.activityId === nextActivityRegistrationId &&
                customPanelState?.position === "right" &&
                customPanelState?.activityId === nextActivityRegistrationId,
            );
        }, {
            nextActivityRegistrationId: activityRegistrationId,
            nextActivityConfigId: activityConfigId,
        });
    }).toBe(true);
}

/**
 * @function waitForCustomActivityRemovalPersistence
 * @description 等待自定义 activity 从后端配置中真正移除，避免 reload 抢在异步保存完成前发生。
 * @param page Playwright 页面对象。
 * @param activityRegistrationId 自定义 activity 的运行时注册 id。
 * @param activityConfigId 自定义 activity 的配置 id。
 * @returns Promise<void>
 */
async function waitForCustomActivityRemovalPersistence(
    page: Page,
    activityRegistrationId: string,
    activityConfigId: string,
): Promise<void> {
    await expect.poll(async () => {
        return page.evaluate(async ({ nextActivityRegistrationId, nextActivityConfigId }) => {
            const vaultApi = await import("/src/api/vaultApi.ts");
            const config = await vaultApi.getCurrentVaultConfig();

            const activityBarItems = Array.isArray(config.entries.activityBar?.items)
                ? config.entries.activityBar.items
                : [];
            const customActivities = Array.isArray(config.entries.customActivities?.items)
                ? config.entries.customActivities.items
                : [];
            const sidebarPanelStates = Array.isArray(config.entries.sidebarLayout?.panelStates)
                ? config.entries.sidebarLayout.panelStates
                : [];

            const registrationStillPresent = activityBarItems.some((item) => item?.id === nextActivityRegistrationId);
            const configStillPresent = customActivities.some((item) => item?.id === nextActivityConfigId);
            const panelStillPresent = sidebarPanelStates.some((item) => item?.id === `custom-panel:${nextActivityConfigId}`);

            return !registrationStillPresent && !configStillPresent && !panelStillPresent;
        }, {
            nextActivityRegistrationId: activityRegistrationId,
            nextActivityConfigId: activityConfigId,
        });
    }).toBe(true);
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
        // 新创建的自定义 Activity 没有关联的 panel，所以只展示空态
        await expect(leftSidebar.getByTestId("left-sidebar-empty")).toBeVisible();
    });

    test("创建使用 Calendar 图标的自定义 Activity 后不应让原生日历按钮消失", async ({ page }) => {
        const activityName = `MCP自定义日历-${Date.now()}`;

        await gotoMockVaultPage(page, "custom-activity-calendar-icon");
        await waitForLayoutReady(page);

        const calendarActivityButton = page.getByTestId("activity-bar-item-calendar");
        await expect(calendarActivityButton).toBeVisible();

        await page.keyboard.press("Meta+J");

        const commandPalette = page.locator(".command-palette-panel");
        try {
            await expect(commandPalette).toBeVisible({ timeout: 2000 });
        } catch {
            await page.keyboard.press("Meta+J");
            await expect(commandPalette).toBeVisible();
        }

        const commandInput = commandPalette.locator(".command-palette-input");
        await commandInput.fill("customActivity.create");
        await commandPalette
            .locator(".command-palette-item")
            .filter({ hasText: "customActivity.create" })
            .first()
            .click();

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
        await expect(page.getByRole("main", { name: "Dockview Main Area" })).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__tab").first()).toBeVisible();
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
        await waitForCustomActivityRemovalPersistence(page, createdActivityRegistrationId, createdActivityId);
        await page.reload();
        await waitForLayoutReady(page);

        await expect(page.getByTitle(activityName)).toHaveCount(0);
        await expect(page.getByTestId("activity-bar-item-calendar")).toBeVisible();
    });

    test.skip("右侧自定义容器中的日历 panel 在 reload 后应与 icon 位置一起恢复", async ({ page }) => {
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
        const calendarTab = page.locator(".layout-v2-tab-section__tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();

        await dockviewDragPanel(page, calendarTab, rightEmptyContainer);

        const calendarPaneHeader = rightSidebar.locator(".layout-v2-panel-section__pane-header", { hasText: "Calendar" }).first();
        await expect(calendarPaneHeader).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "Calendar" })).toHaveCount(0);

        await page.waitForTimeout(450);
        await page.reload();
        await waitForLayoutReady(page);

        await expect(page.getByTestId(`activity-bar-item-${activityRegistrationId}`)).toHaveCount(0);
        await expect(page.getByTestId(`right-activity-icon-${activityRegistrationId}`)).toBeVisible();
        await expect(rightSidebar.locator(".layout-v2-panel-section__pane-header", { hasText: activityName }).first()).toHaveCount(0);
        await expect(rightSidebar.locator(".layout-v2-panel-section__pane-header", { hasText: "Calendar" }).first()).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__tab", { hasText: "Calendar" })).toHaveCount(0);
    });

    test.skip("删除名称为日历的自定义容器后不应触发 Dockview 崩溃且 reload 仍可启动", async ({ page }) => {
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
        const calendarTab = page.locator(".layout-v2-tab-section__tab", { hasText: "Calendar" });
        await expect(calendarTab).toBeVisible();
        await dockviewDragPanel(page, calendarTab, rightEmptyContainer);

        await expect(rightSidebar.locator(".layout-v2-panel-section__pane-header", { hasText: "Calendar" }).first()).toBeVisible();

        await deleteCustomActivity(page, activityConfigId);

        await page.waitForTimeout(450);
        await expect(page.locator("main").first()).toBeVisible();
        await expect(page.locator(".layout-v2-tab-section__tab").first()).toBeVisible();
        expect(pageErrors).toEqual([]);

        await page.reload();
        await waitForLayoutReady(page);

        await expect(page.getByTestId(`right-activity-icon-${activityRegistrationId}`)).toHaveCount(0);
        await expect(page.getByTitle(activityName)).toHaveCount(0);
        await expect(page.getByTestId("activity-bar-item-calendar")).toBeVisible();
        expect(pageErrors).toEqual([]);
    });
});