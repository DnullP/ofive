/**
 * @module utils/frontendLogBridge
 * @description 前端日志桥接模块：将浏览器端 console 日志同步发送到 Tauri 后端日志。
 * @dependencies
 *  - @tauri-apps/api/core
 *
 * @example
 *   setupFrontendLogBridge();
 *
 * @exports
 *  - setupFrontendLogBridge: 初始化 console 桥接
 */

import { invoke } from "@tauri-apps/api/core";
import { publishNotification } from "../host/notifications/notificationCenter";

/**
 * @type LogLevel
 * @description 前端日志级别。
 */
type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * @type ConsoleMethod
 * @description Console 原始方法签名。
 */
type ConsoleMethod = (...args: unknown[]) => void;

let initialized = false;

/**
 * @function isTauriRuntime
 * @description 判断是否运行在 Tauri 宿主环境。
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
 * @function stringifyLogArgs
 * @description 将 console 参数序列化为可传输文本。
 * @param args 原始日志参数。
 * @returns 序列化后的字符串。
 */
function stringifyLogArgs(args: unknown[]): string {
    return args
        .map((item) => {
            if (typeof item === "string") {
                return item;
            }

            if (item instanceof Error) {
                return JSON.stringify({
                    name: item.name,
                    message: item.message,
                    stack: item.stack,
                });
            }

            try {
                return JSON.stringify(item);
            } catch {
                return String(item);
            }
        })
        .join(" ");
}

/**
 * @function sendLogToBackend
 * @description 通过 Tauri invoke 将日志转发到后端。
 * @param level 日志级别。
 * @param message 主日志文本。
 * @param context 上下文信息。
 */
async function sendLogToBackend(level: LogLevel, message: string, context: string): Promise<void> {
    await invoke("forward_frontend_log", {
        level,
        message,
        context,
    });
}

/**
 * @function patchConsoleMethod
 * @description 为单个 console 方法打补丁，保留原始输出并新增后端转发。
 * @param level 日志级别。
 * @param original 原始 console 方法。
 */
function patchConsoleMethod(level: LogLevel, original: ConsoleMethod): void {
    const wrapped: ConsoleMethod = (...args: unknown[]) => {
        original(...args);

        if ((level === "warn" || level === "error") && !isTauriRuntime()) {
            publishNotification({
                level,
                message: stringifyLogArgs(args),
                source: "frontend-log",
            });
        }

        if (!isTauriRuntime()) {
            return;
        }

        const message = stringifyLogArgs(args);
        const context = JSON.stringify({
            href: typeof window !== "undefined" ? window.location.href : "",
            ts: Date.now(),
        });

        void sendLogToBackend(level, message, context).catch(() => {
            original("[frontend-log-bridge] failed to forward log");
        });
    };

    if (level === "debug") {
        console.debug = wrapped;
        return;
    }

    if (level === "info") {
        console.info = wrapped;
        return;
    }

    if (level === "warn") {
        console.warn = wrapped;
        return;
    }

    console.error = wrapped;
}

/**
 * @function setupFrontendLogBridge
 * @description 初始化前端日志桥接，保证仅初始化一次。
 */
export function setupFrontendLogBridge(): void {
    if (initialized) {
        return;
    }
    initialized = true;

    const originalDebug = console.debug.bind(console);
    const originalInfo = console.info.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    patchConsoleMethod("debug", originalDebug);
    patchConsoleMethod("info", originalInfo);
    patchConsoleMethod("warn", originalWarn);
    patchConsoleMethod("error", originalError);

    console.info("[frontend-log-bridge] initialized");
}
