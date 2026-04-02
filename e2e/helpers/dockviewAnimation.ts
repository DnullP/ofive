/**
 * @module e2e/helpers/dockviewAnimation
 * @description Dockview split 动画审计辅助工具。
 *
 * 通过 mock 页面暴露的 `window.__OFIVE_MOCK_DOCKVIEW__` 调用主区调试能力，
 * 并采集动画观测记录与布局快照，供 E2E 审计不同方向/布局场景是否触发动画。
 *
 * @dependencies
 *   - @playwright/test
 *
 * @example
 *   const result = await runDockviewAnimationAudit(page, async () => {
 *     await openMockSplitTab(page, { id: "case-a", position: "right" });
 *   });
 */

import type { Page } from "@playwright/test";
import type {
    DockviewLayoutAnimationObservation,
    DockviewLayoutSnapshot,
    DockviewTabReorderAuditEntry,
    DockviewLayoutTimelineEntry,
} from "../../src/host/layout/dockviewLayoutDebugContract";
export type {
    DockviewLayoutAnimationObservation,
    DockviewLayoutSnapshot,
    DockviewTabReorderAuditEntry,
    DockviewLayoutTimelineEntry,
} from "../../src/host/layout/dockviewLayoutDebugContract";

export interface DockviewAnimationAuditResult {
    observations: DockviewAnimationObservation[];
    layout: DockviewLayoutSnapshot;
    didPlay: boolean;
    lastPlayStatus: DockviewAnimationObservation["status"] | null;
}

/**
 * @function waitForMockDockviewDebugApi
 * @description 等待 mock 页面上的 Dockview 调试 API 可用。
 * @param page Playwright 页面对象。
 */
export async function waitForMockDockviewDebugApi(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        return typeof window.__OFIVE_MOCK_DOCKVIEW__ !== "undefined";
    });
}

/**
 * @function waitForDockviewAnimationsToSettle
 * @description 等待主区现有 Web Animations 全部结束，避免把前序场景的动画混入当前审计。
 * @param page Playwright 页面对象。
 * @param timeoutMs 最长等待时间。
 */
export async function waitForDockviewAnimationsToSettle(
    page: Page,
    timeoutMs = 1_500,
): Promise<void> {
    await page.waitForFunction(() => {
        const animatedElements = Array.from(
            document.querySelectorAll<HTMLElement>(
                ".dv-groupview, .dv-tabs-and-actions-container, .dv-content-container",
            ),
        );
        return animatedElements.every((element) => {
            return element.getAnimations().every((animation) => {
                return animation.playState !== "running" && animation.playState !== "pending";
            });
        });
    }, undefined, { timeout: timeoutMs });
    await page.waitForTimeout(60);
}

/**
 * @function clearDockviewAnimationObservations
 * @description 清空当前页面上的动画观测记录。
 * @param page Playwright 页面对象。
 */
export async function clearDockviewAnimationObservations(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__OFIVE_MOCK_DOCKVIEW__?.clearAnimationObservations();
    });
}

/**
 * @function clearDockviewTimelineEntries
 * @description 清空当前页面上的 Dockview timeline 日志。
 * @param page Playwright 页面对象。
 */
export async function clearDockviewTimelineEntries(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__OFIVE_MOCK_DOCKVIEW__?.clearTimelineEntries();
    });
}

/**
 * @function getDockviewAnimationObservations
 * @description 读取当前页面上的动画观测记录。
 * @param page Playwright 页面对象。
 * @returns 动画观测列表。
 */
export async function getDockviewAnimationObservations(
    page: Page,
): Promise<DockviewAnimationObservation[]> {
    return page.evaluate(() => {
        return window.__OFIVE_MOCK_DOCKVIEW__?.getAnimationObservations() ?? [];
    });
}

/**
 * @function getDockviewTimelineEntries
 * @description 读取当前页面上的 Dockview timeline 日志。
 * @param page Playwright 页面对象。
 * @returns timeline 列表。
 */
export async function getDockviewTimelineEntries(page: Page): Promise<DockviewLayoutTimelineEntry[]> {
    return page.evaluate(() => {
        return window.__OFIVE_MOCK_DOCKVIEW__?.getTimelineEntries() ?? [];
    });
}

/**
 * @function getDockviewLayoutSnapshot
 * @description 读取当前 Dockview group 几何快照。
 * @param page Playwright 页面对象。
 * @returns 布局快照。
 */
export async function getDockviewLayoutSnapshot(page: Page): Promise<DockviewLayoutSnapshot> {
    return page.evaluate(() => {
        return window.__OFIVE_MOCK_DOCKVIEW__?.getLayoutSnapshot() ?? { groups: [] };
    });
}

/**
 * @function clearDockviewTabReorderAuditEntries
 * @description 清空当前页面上的 tab 重排审计记录。
 * @param page Playwright 页面对象。
 */
export async function clearDockviewTabReorderAuditEntries(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__OFIVE_MOCK_DOCKVIEW__?.clearTabReorderAuditEntries();
    });
}

/**
 * @function getDockviewTabReorderAuditEntries
 * @description 读取当前页面上的 tab 重排审计记录。
 * @param page Playwright 页面对象。
 * @returns tab 重排审计列表。
 */
export async function getDockviewTabReorderAuditEntries(
    page: Page,
): Promise<DockviewTabReorderAuditEntry[]> {
    return page.evaluate(() => {
        return window.__OFIVE_MOCK_DOCKVIEW__?.getTabReorderAuditEntries() ?? [];
    });
}

/**
 * @function openMockSplitTab
 * @description 通过 mock debug API 打开一个 split tab。
 * @param page Playwright 页面对象。
 * @param options 目标 tab 与 split 方向。
 */
export async function openMockSplitTab(
    page: Page,
    options: {
        id: string;
        title: string;
        component: string;
        position: "top" | "bottom" | "left" | "right";
    },
): Promise<void> {
    await page.evaluate((input) => {
        window.__OFIVE_MOCK_DOCKVIEW__?.openSplitTab(input);
    }, options);
}

/**
 * @function closeMockTab
 * @description 通过 mock debug API 关闭指定 tab。
 * @param page Playwright 页面对象。
 * @param tabId 目标 tab ID。
 */
export async function closeMockTab(page: Page, tabId: string): Promise<void> {
    await page.evaluate((id) => {
        window.__OFIVE_MOCK_DOCKVIEW__?.closeTab(id);
    }, tabId);
}

/**
 * @function activateMockTab
 * @description 通过 mock debug API 激活指定 tab。
 * @param page Playwright 页面对象。
 * @param tabId 目标 tab ID。
 */
export async function activateMockTab(page: Page, tabId: string): Promise<void> {
    await page.evaluate((id) => {
        window.__OFIVE_MOCK_DOCKVIEW__?.activateTab(id);
    }, tabId);
}

/**
 * @function runDockviewAnimationAudit
 * @description 清空观测后执行动作，并在短时间内收集动画结果。
 * @param page Playwright 页面对象。
 * @param action 触发布局变化的动作。
 * @param settleMs 采样前等待时长。
 * @returns 动画审计结果。
 */
export async function runDockviewAnimationAudit(
    page: Page,
    action: () => Promise<void>,
    settleMs = 700,
): Promise<DockviewAnimationAuditResult> {
    await clearDockviewAnimationObservations(page);
    await clearDockviewTimelineEntries(page);
    await action();
    await page.waitForTimeout(settleMs);

    const observations = await getDockviewAnimationObservations(page);
    const layout = await getDockviewLayoutSnapshot(page);
    const playObservations = observations.filter((item) => item.phase === "play");
    const lastPlay = playObservations.at(-1) ?? null;

    return {
        observations,
        layout,
        didPlay: playObservations.some((item) => item.status === "played"),
        lastPlayStatus: lastPlay?.status ?? null,
    };
}