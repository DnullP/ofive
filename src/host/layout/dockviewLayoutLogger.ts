/**
 * @module host/layout/dockviewLayoutLogger
 * @description Dockview 布局运行时结构化日志助手。
 *
 * 该模块将 Dockview 布局健康、动画、交互恢复等事件格式化为统一日志输出。
 * 日志最终会被 frontendLogBridge 转发到 Tauri 后端，或在 mock web 中显示为前端告警。
 *
 * @dependencies
 *  - ./dockviewLayoutRuntime
 *
 * @example
 *   logDockviewRuntime("warn", "health-issue", "drag artifacts remain", { issueCount: 2 });
 *
 * @exports
 *  - DockviewRuntimeLogLevel
 *  - logDockviewRuntime
 */

import type { DockviewLayoutRuntimeEventType } from "./dockviewLayoutRuntime";

/** Dockview 运行时日志级别。 */
export type DockviewRuntimeLogLevel = "debug" | "info" | "warn" | "error";

/**
 * @function logDockviewRuntime
 * @description 输出一条带结构化上下文的 Dockview 运行时日志。
 * @param level 日志级别。
 * @param eventType 事件类型。
 * @param message 日志消息。
 * @param details 额外上下文。
 */
export function logDockviewRuntime(
    level: DockviewRuntimeLogLevel,
    eventType: DockviewLayoutRuntimeEventType,
    message: string,
    details?: Record<string, unknown>,
): void {
    const payload = {
        scope: "dockview-layout",
        eventType,
        message,
        details: details ?? {},
    };

    if (level === "debug") {
        console.debug("[dockview-layout]", payload);
        return;
    }

    if (level === "info") {
        console.info("[dockview-layout]", payload);
        return;
    }

    if (level === "warn") {
        console.warn("[dockview-layout]", payload);
        return;
    }

    console.error("[dockview-layout]", payload);
}