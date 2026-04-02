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
 *   - DockviewTabStripSnapshot
 *   - DockviewTabReorderAuditEntry
 *   - DockviewLayoutDebugApi
 */

import type { DockviewGroupRectSnapshot } from "./dockviewLayoutAnimationState";
import type { DockviewLayoutRuntimeEvent } from "./dockviewLayoutRuntime";

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
    | "pointerdrag-tab"
    | "dragstart-tab"
    | "split-trigger-evaluated"
    | "drop-host"
    | "drop-result"
    | "health-alert"
    | "health-recovery"
    | "remove-panel"
    | "dragend-tab"
    | "pointerup-tab"
    | "layout-change"
    | "active-panel-change"
    | "wait-layout-ready"
    | "play-attempt";

/** Dockview tab 重排审计事件类型。 */
export type DockviewTabReorderAuditEntryType =
    | "drag-session-start"
    | "preview-updated"
    | "preview-cleared"
    | "dom-order-changed"
    | "drop-committed"
    | "drag-session-end";

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
 * @interface DockviewTabStripSnapshot
 * @description 当前 Dockview 中一个 tab strip 的顺序快照。
 */
export interface DockviewTabStripSnapshot {
    stripIndex: number;
    groupIndex: number;
    tabLabels: string[];
}

/**
 * @interface DockviewTabReorderAuditEntry
 * @description 一次 tab 重排交互的审计记录。
 */
export interface DockviewTabReorderAuditEntry {
    sequence: number;
    sessionId: number | null;
    type: DockviewTabReorderAuditEntryType;
    timestamp: number;
    sourceLabel: string | null;
    sourceGroupIndex: number | null;
    sourceIndex: number | null;
    targetGroupIndex: number | null;
    targetIndex: number | null;
    insertionLeft: number | null;
    shiftedTabLabels: string[];
    tabStrips: DockviewTabStripSnapshot[];
    details?: Record<string, string | number | boolean | null>;
}

/** Dockview 布局健康问题严重级别。 */
export type DockviewLayoutHealthIssueSeverity = "info" | "warn" | "error";

/**
 * @interface DockviewLayoutHealthIssue
 * @description 一条 Dockview 运行时健康问题记录。
 */
export interface DockviewLayoutHealthIssue {
    code: string;
    severity: DockviewLayoutHealthIssueSeverity;
    message: string;
    details?: Record<string, string | number | boolean | null>;
}

/**
 * @interface DockviewLayoutHealthSnapshot
 * @description 当前 Dockview 布局与拖拽交互状态的健康快照。
 */
export interface DockviewLayoutHealthSnapshot {
    timestamp: number;
    activeTabId: string | null;
    groupCount: number;
    tabCount: number;
    dragInProgress: boolean;
    dropCommitted: boolean;
    pendingPointerDrag: boolean;
    contentPreviewCount: number;
    dragPreviewCount: number;
    dragSourceTabCount: number;
    dragSourceGroupCount: number;
    issues: DockviewLayoutHealthIssue[];
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
    getHealthSnapshot: () => DockviewLayoutHealthSnapshot;
    recoverInteractionState: () => void;
    getRuntimeEvents: () => DockviewLayoutRuntimeEvent[];
    clearRuntimeEvents: () => void;
    getTabReorderAuditEntries: () => DockviewTabReorderAuditEntry[];
    clearTabReorderAuditEntries: () => void;
}
