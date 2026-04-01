/**
 * @module api/logNotificationApi
 * @description 后端日志通知事件 API：负责订阅 Rust 宿主转发到前端的 WARN / ERROR 日志通知。
 * @dependencies
 *   - @tauri-apps/api/event
 *
 * @example
 *   const unlisten = await subscribeBackendLogNotificationEvents((payload) => {
 *     console.info(payload.level, payload.message);
 *   });
 *
 * @exports
 *   - BACKEND_LOG_NOTIFICATION_EVENT_NAME
 *   - BackendLogNotificationLevel
 *   - BackendLogNotificationSource
 *   - BackendLogNotificationEventPayload
 *   - subscribeBackendLogNotificationEvents
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * @constant BACKEND_LOG_NOTIFICATION_EVENT_NAME
 * @description 宿主日志通知事件名。
 */
export const BACKEND_LOG_NOTIFICATION_EVENT_NAME = "host://log-notification";

/**
 * @type BackendLogNotificationLevel
 * @description 后端日志通知级别。
 */
export type BackendLogNotificationLevel = "warn" | "error";

/**
 * @type BackendLogNotificationSource
 * @description 后端日志通知来源。
 */
export type BackendLogNotificationSource = "backend-log" | "frontend-log";

/**
 * @interface BackendLogNotificationEventPayload
 * @description 宿主发送到前端的日志通知负载。
 */
export interface BackendLogNotificationEventPayload {
    /** 消息唯一 ID。 */
    notificationId: string;
    /** 日志级别。 */
    level: BackendLogNotificationLevel;
    /** 可选标题。 */
    title: string | null;
    /** 消息正文。 */
    message: string;
    /** 原始日志 target。 */
    target: string;
    /** 日志来源。 */
    source: BackendLogNotificationSource;
    /** 自动关闭毫秒数。 */
    autoCloseMs: number;
    /** 可选进度；普通日志为空。 */
    progress: number | null;
    /** 创建时间戳。 */
    createdAt: number;
}

/**
 * @function isTauriRuntime
 * @description 判断当前是否运行在 Tauri 宿主环境。
 * @returns Tauri 环境返回 true。
 */
function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };

    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

/**
 * @function subscribeBackendLogNotificationEvents
 * @description 订阅宿主日志通知事件。
 * @param handler 事件处理函数。
 * @returns 取消订阅函数。
 */
export async function subscribeBackendLogNotificationEvents(
    handler: (payload: BackendLogNotificationEventPayload) => void,
): Promise<UnlistenFn> {
    if (!isTauriRuntime()) {
        return () => {
            // 浏览器模式下无宿主日志事件。
        };
    }

    return listen<BackendLogNotificationEventPayload>(
        BACKEND_LOG_NOTIFICATION_EVENT_NAME,
        (event) => {
            handler(event.payload);
        },
    );
}