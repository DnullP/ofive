/**
 * @module plugins/log-notification/logNotificationPlugin
 * @description 右上角消息提示插件：
 *   1. 注册宿主 overlay 渲染入口
 *   2. 订阅后端 WARN / ERROR 日志事件并转发到宿主消息中心
 *   3. 让业务模块通过宿主消息中心消费该插件，而不直接依赖插件实现
 *
 * @dependencies
 *   - react
 *   - ../../api/logNotificationApi
 *   - ../../host/notifications/notificationCenter
 *   - ../../host/registry
 *   - ./LogNotificationOverlay
 *
 * @example
 *   由插件运行时自动发现并激活。
 *
 * @exports
 *   - activatePlugin
 */

import React from "react";
import { subscribeBackendLogNotificationEvents } from "../../api/logNotificationApi";
import { publishNotification } from "../../host/notifications/notificationCenter";
import { registerOverlay } from "../../host/registry";
import { LogNotificationOverlay } from "./LogNotificationOverlay";

const LOG_NOTIFICATION_OVERLAY_ID = "log-notification";

/**
 * @function activatePlugin
 * @description 激活日志提示插件并注册后端日志桥接。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterOverlay = registerOverlay({
        id: LOG_NOTIFICATION_OVERLAY_ID,
        order: 90,
        render: () => React.createElement(LogNotificationOverlay),
    });

    let disposed = false;
    let bridgeUnlisten: (() => void) | null = null;

    void subscribeBackendLogNotificationEvents((payload) => {
        publishNotification({
            notificationId: payload.notificationId,
            level: payload.level,
            title: payload.title,
            message: payload.message,
            source: payload.source,
            progress: payload.progress,
            autoCloseMs: payload.autoCloseMs,
            createdAt: payload.createdAt,
            updatedAt: payload.createdAt,
        });
    })
        .then((unlisten) => {
            if (disposed) {
                unlisten();
                return;
            }

            bridgeUnlisten = unlisten;
            console.info("[log-notification-plugin] backend log bridge started");
        })
        .catch((error) => {
            console.error("[log-notification-plugin] backend log bridge start failed", {
                message: error instanceof Error ? error.message : String(error),
            });
        });

    console.info("[log-notification-plugin] plugin activated");

    return () => {
        disposed = true;
        if (bridgeUnlisten) {
            bridgeUnlisten();
            bridgeUnlisten = null;
        }
        unregisterOverlay();
        console.info("[log-notification-plugin] plugin disposed");
    };
}