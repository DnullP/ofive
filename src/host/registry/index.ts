/**
 * @module host/registry
 * @description 组件注册中心统一导出：汇总面板、Tab 组件、活动图标三个注册表。
 *   外部消费者通过此模块即可获取所有注册相关类型和 API。
 *
 * @dependencies
 *   - ./panelRegistry
 *   - ./tabComponentRegistry
 *   - ./activityRegistry
 *   - ./fileOpenerRegistry
 *   - ./overlayRegistry
 *   - ./sidebarHeaderActionRegistry
 *
 * @exports
 *   面板注册：PanelDescriptor, registerPanel, unregisterPanel,
 *            getPanelsSnapshot, subscribePanels, usePanels, resolveTitle
 *   Tab 组件注册：TabComponentDescriptor, registerTabComponent,
 *                unregisterTabComponent, getTabComponentsSnapshot,
 *                subscribeTabComponents, useTabComponents, getTabComponentById
 *   活动图标注册：PanelContainerActivity, CallbackActivity, ActivityDescriptor,
 *               registerActivity, unregisterActivity, getActivitiesSnapshot,
 *               subscribeActivities, useActivities, getActivityById,
 *               resolveActivityTitle
 *   文件 opener 注册：FileOpenerDescriptor, registerFileOpener,
 *                    unregisterFileOpener, getFileOpenersSnapshot,
 *                    subscribeFileOpeners, useFileOpeners, getFileOpenerById,
 *                    getMatchingFileOpeners, resolveFileOpener,
 *                    resolveFileOpenerLabel
 *   Overlay 注册：OverlayDescriptor, OverlayRenderContext,
 *                registerOverlay, unregisterOverlay, getOverlaysSnapshot,
 *                subscribeOverlays, useOverlays
 *   Sidebar Header Action 注册：SidebarHeaderActionDescriptor,
 *                SidebarHeaderActionContext, registerSidebarHeaderAction,
 *                unregisterSidebarHeaderAction, getSidebarHeaderActionsSnapshot,
 *                subscribeSidebarHeaderActions, useSidebarHeaderActions,
 *                resolveSidebarHeaderActionTitle
 */

/* ── 面板注册 ── */
export {
    registerPanel,
    unregisterPanel,
    getPanelsSnapshot,
    subscribePanels,
    usePanels,
    resolveTitle,
} from "./panelRegistry";
export type { PanelDescriptor } from "./panelRegistry";

/* ── Tab 组件注册 ── */
export {
    registerTabComponent,
    unregisterTabComponent,
    getTabComponentsSnapshot,
    subscribeTabComponents,
    useTabComponents,
    getTabComponentById,
} from "./tabComponentRegistry";
export type { TabComponentDescriptor } from "./tabComponentRegistry";

/* ── 文件 opener 注册 ── */
export {
    registerFileOpener,
    unregisterFileOpener,
    getFileOpenersSnapshot,
    subscribeFileOpeners,
    useFileOpeners,
    getFileOpenerById,
    getMatchingFileOpeners,
    resolveFileOpener,
    resolveFileOpenerLabel,
} from "./fileOpenerRegistry";
export type { FileOpenerDescriptor, FileOpenerContext } from "./fileOpenerRegistry";

/* ── Overlay 注册 ── */
export {
    registerOverlay,
    unregisterOverlay,
    getOverlaysSnapshot,
    subscribeOverlays,
    useOverlays,
} from "./overlayRegistry";
export type { OverlayDescriptor, OverlayRenderContext } from "./overlayRegistry";

/* ── Sidebar Header Action 注册 ── */
export {
    registerSidebarHeaderAction,
    unregisterSidebarHeaderAction,
    getSidebarHeaderActionsSnapshot,
    subscribeSidebarHeaderActions,
    useSidebarHeaderActions,
    resolveSidebarHeaderActionTitle,
} from "./sidebarHeaderActionRegistry";
export type {
    SidebarHeaderActionDescriptor,
    SidebarHeaderActionContext,
} from "./sidebarHeaderActionRegistry";

/* ── 活动图标注册 ── */
export {
    registerActivity,
    unregisterActivity,
    getActivitiesSnapshot,
    subscribeActivities,
    useActivities,
    getActivityById,
    resolveActivityTitle,
} from "./activityRegistry";
export type {
    PanelContainerActivity,
    CallbackActivity,
    ActivityDescriptor,
} from "./activityRegistry";
