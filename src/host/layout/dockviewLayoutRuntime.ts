/**
 * @module host/layout/dockviewLayoutRuntime
 * @description Dockview 布局运行时事件总线与历史缓冲。
 *
 * 该模块负责统一承载 Dockview 相关的布局快照、健康监控、交互审计、
 * 动画观测与恢复事件，避免这些运行时信息分散在多个 ref / window 事件里。
 *
 * @dependencies
 *  - ./dockviewLayoutDebugContract
 *
 * @example
 *   const runtime = createDockviewLayoutRuntime();
 *   runtime.publish("health-issue", { snapshot, issues: snapshot.issues });
 *   runtime.getEvents();
 *
 * @exports
 *  - DockviewLayoutRuntimeEventType
 *  - DockviewLayoutRuntimeEvent
 *  - DockviewLayoutRuntimePayloadMap
 *  - DockviewLayoutRuntimeStore
 *  - createDockviewLayoutRuntime
 */

import type {
    DockviewLayoutAnimationObservation,
    DockviewLayoutHealthIssue,
    DockviewLayoutHealthSnapshot,
    DockviewLayoutSnapshot,
    DockviewLayoutTimelineEntry,
    DockviewTabReorderAuditEntry,
} from "./dockviewLayoutDebugContract";

/** Dockview 运行时浏览器事件名称。 */
export const DOCKVIEW_LAYOUT_RUNTIME_EVENT = "ofive:dockview-layout-runtime";

/** Dockview 运行时事件类型。 */
export type DockviewLayoutRuntimeEventType =
    | "health-snapshot"
    | "health-issue"
    | "interaction-recovered"
    | "layout-snapshot"
    | "timeline-entry"
    | "animation-observation"
    | "tab-reorder-audit";

/** Dockview 运行时事件载荷映射。 */
export interface DockviewLayoutRuntimePayloadMap {
    "health-snapshot": {
        snapshot: DockviewLayoutHealthSnapshot;
    };
    "health-issue": {
        snapshot: DockviewLayoutHealthSnapshot;
        issues: DockviewLayoutHealthIssue[];
    };
    "interaction-recovered": {
        before: DockviewLayoutHealthSnapshot;
        after: DockviewLayoutHealthSnapshot;
    };
    "layout-snapshot": {
        snapshot: DockviewLayoutSnapshot;
    };
    "timeline-entry": {
        entry: DockviewLayoutTimelineEntry;
    };
    "animation-observation": {
        observation: DockviewLayoutAnimationObservation;
    };
    "tab-reorder-audit": {
        entry: DockviewTabReorderAuditEntry;
    };
}

/**
 * @interface DockviewLayoutRuntimeEvent
 * @description 一条 Dockview 运行时总线事件。
 */
export interface DockviewLayoutRuntimeEvent<
    TType extends DockviewLayoutRuntimeEventType = DockviewLayoutRuntimeEventType,
> {
    sequence: number;
    timestamp: number;
    type: TType;
    payload: DockviewLayoutRuntimePayloadMap[TType];
}

/**
 * @interface DockviewLayoutRuntimeStore
 * @description Dockview 运行时缓冲与发布接口。
 */
export interface DockviewLayoutRuntimeStore {
    publish: <TType extends DockviewLayoutRuntimeEventType>(
        type: TType,
        payload: DockviewLayoutRuntimePayloadMap[TType],
    ) => DockviewLayoutRuntimeEvent<TType>;
    getEvents: () => DockviewLayoutRuntimeEvent[];
    clearEvents: () => void;
}

/**
 * @function createDockviewLayoutRuntime
 * @description 创建 Dockview 运行时事件缓冲。
 * @returns 运行时事件存储。
 */
export function createDockviewLayoutRuntime(): DockviewLayoutRuntimeStore {
    let sequence = 1;
    let events: DockviewLayoutRuntimeEvent[] = [];

    return {
        publish: (type, payload) => {
            const event: DockviewLayoutRuntimeEvent<typeof type> = {
                sequence: sequence++,
                timestamp: Date.now(),
                type,
                payload,
            };
            events = [...events, event].slice(-300);

            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent(DOCKVIEW_LAYOUT_RUNTIME_EVENT, {
                    detail: event,
                }));
            }

            return event;
        },
        getEvents: () => [...events],
        clearEvents: () => {
            events = [];
        },
    };
}