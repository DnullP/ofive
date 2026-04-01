/**
 * @module plugins/log-notification/logNotificationTestActivityPlugin
 * @description 日志通知测试活动插件：在左侧活动栏注册一个 callback 图标，
 *   点击后向宿主消息中心发送一条 greet 测试消息，用于验证通知链路。
 * @dependencies
 *   - react
 *   - lucide-react
 *   - ../../host/notifications/notificationCenter
 *   - ../../host/registry/activityRegistry
 *
 * @example
 *   由插件运行时自动发现并激活；点击左侧测试图标后会出现 greet 消息。
 *
 * @exports
 *   - activatePlugin
 */

import React from "react";
import { Hand } from "lucide-react";

import { publishNotification } from "../../host/notifications/notificationCenter";
import { registerActivity } from "../../host/registry/activityRegistry";

const LOG_NOTIFICATION_TEST_ACTIVITY_ID = "log-notification-test-activity";

/**
 * @function emitGreetingNotification
 * @description 向宿主消息中心发送一条 greet 测试消息。
 */
function emitGreetingNotification(): void {
    publishNotification({
        level: "info",
        title: "Test Message",
        message: "greet",
        source: "module",
    });
}

/**
 * @function activatePlugin
 * @description 注册左侧测试消息活动图标。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterActivity = registerActivity({
        type: "callback",
        id: LOG_NOTIFICATION_TEST_ACTIVITY_ID,
        title: "Test Message",
        icon: React.createElement(Hand, { size: 18, strokeWidth: 1.8 }),
        defaultSection: "bottom",
        defaultBar: "left",
        defaultOrder: 999,
        onActivate: () => {
            console.info("[log-notification-test-activity] greet notification requested");
            emitGreetingNotification();
        },
    });

    console.info("[log-notification-test-activity] plugin activated");

    return () => {
        unregisterActivity();
        console.info("[log-notification-test-activity] plugin disposed");
    };
}