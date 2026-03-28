/**
 * @module host/layout/dockviewLayoutDebugContract
 * @description Dockview 主区动画调试与测试契约。
 *
 * 该模块定义前端运行时埋点、mock 调试桥接、E2E 审计之间共享的数据结构，
 * 避免动画观测类型在生产代码、mock 页面和测试辅助层之间各自漂移。
 *
 * @dependencies
 *   - ./dockviewLayoutAnimationState
 *
 * @example
 *   const observations = debugApi.getAnimationObservations();
 *   const timeline = debugApi.getTimelineEntries();
 *   const snapshot = debugApi.getLayoutSnapshot();
 *
 * @exports
 *   - DockviewLayoutAnimationObservation
 *   - DockviewLayoutTimelineEntry
 *   - DockviewLayoutSnapshot
 *   - DockviewLayoutDebugApi
 */

import type { DockviewGroupRectSnapshot } from "./dockviewLayoutAnimationState";

/** Dockview 动画观测阶段。 */
export type DockviewLayoutAnimationObservationPhase = "capture" | "play";

/** Dockview 动画观测状态。 */
export type DockviewLayoutAnimationObservationStatus =
    | "captured"
    | "ignored-no-groups"
    | "played"
    | "skipped-reduced-motion"
    | "skipped-expired"
    | "skipped-empty-layout"
    | "skipped-equivalent-layout"
    | "skipped-no-visible-delta";

/** Dockview 时序日志事件类型。 */
export type DockviewLayoutTimelineEntryType =
    | "pointerdown-tab"
    | "dragstart-tab"
    | "drop-host"
    | "dragend-tab"
    | "pointerup-tab"
    | "layout-change"
    | "active-panel-change"
    | "wait-layout-ready"
    | "play-attempt";

/**
 * @interface DockviewLayoutAnimationObservation
 * @description 一次 Dockview 动画埋点记录。
 */
export interface DockviewLayoutAnimationObservation {
    sequence: number;
    phase: DockviewLayoutAnimationObservationPhase;
    status: DockviewLayoutAnimationObservationStatus;
    reason: "split-entering" | "split-settling";
    source: "programmatic" | "drag";
    timestamp: number;
    previousGroupCount: number;
    currentGroupCount: number;
    animatedGroupCount: number;
    newGroupCount: number;
}

/**
 * @interface DockviewLayoutTimelineEntry
 * @description 一次 Dockview 布局交互时间线事件。
 */
export interface DockviewLayoutTimelineEntry {
    sequence: number;
    type: DockviewLayoutTimelineEntryType;
    timestamp: number;
    pendingAnimationId: number | null;
    activeTabId: string | null;
    groupCount: number;
    details?: Record<string, string | number | boolean | null>;
}

/**
 * @interface DockviewDebugTabDefinition
 * @description 调试环境用于 openSplitTab 的最小 tab 描述。
 */
export interface DockviewDebugTabDefinition {
    id: string;
    title: string;
    component: string;
    params?: Record<string, unknown>;
}

/**
 * @interface DockviewLayoutSnapshot
 * @description 当前 Dockview group 几何快照。
 */
export interface DockviewLayoutSnapshot {
    groups: DockviewGroupRectSnapshot[];
}

/**
 * @interface DockviewLayoutDebugApi
 * @description 暴露给 mock 页面和自动化测试的 Dockview 调试契约。
 */
export interface DockviewLayoutDebugApi {
    openSplitTab: (
        tab: DockviewDebugTabDefinition,
        position?: "top" | "bottom" | "left" | "right",
    ) => void;
    closeTab: (tabId: string) => void;
    hasTab: (tabId: string) => boolean;
    activateTab: (tabId: string) => void;
    getAnimationObservations: () => DockviewLayoutAnimationObservation[];
    clearAnimationObservations: () => void;
    getTimelineEntries: () => DockviewLayoutTimelineEntry[];
    clearTimelineEntries: () => void;
    getLayoutSnapshot: () => DockviewLayoutSnapshot;
}
