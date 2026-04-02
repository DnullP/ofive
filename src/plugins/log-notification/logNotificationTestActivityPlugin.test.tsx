/**
 * @module plugins/log-notification/logNotificationTestActivityPlugin.test
 * @description 日志通知测试活动插件单元测试：验证左侧 callback activity 注册后，
 *   点击会向通知中心发送 greet 消息。
 * @dependencies
 *   - bun:test
 *   - ../../host/notifications/notificationCenter
 *   - ../../host/registry/activityRegistry
 *   - ./logNotificationTestActivityPlugin
 *
 * @example
 *   bun test src/plugins/log-notification/logNotificationTestActivityPlugin.test.tsx
 */

import { afterEach, describe, expect, it } from "bun:test";

import { getActivitiesSnapshot } from "../../host/registry/activityRegistry";
import { subscribeNotificationCenter } from "../../host/notifications/notificationCenter";
import { activatePlugin } from "./logNotificationTestActivityPlugin";

describe("logNotificationTestActivityPlugin", () => {
    afterEach(() => {
        getActivitiesSnapshot().forEach((activity) => {
            if (activity.id === "log-notification-test-activity") {
                return;
            }
        });
    });

    /**
     * @function should_register_left_callback_activity_and_emit_greet_notification
     * @description 激活插件后，应注册左侧 callback activity，点击后发送 greet 消息。
     */
    it("should register left callback activity and emit greet notification", () => {
        let capturedMessage = "";
        let capturedTitle = "";
        const disposePlugin = activatePlugin();
        const activity = getActivitiesSnapshot().find((item) => {
            return item.id === "log-notification-test-activity";
        });
        const unsubscribe = subscribeNotificationCenter((event) => {
            if (event.type !== "upsert") {
                return;
            }

            capturedTitle = event.notification.title ?? "";
            capturedMessage = event.notification.message;
        });

        expect(activity).toBeDefined();
        expect(activity?.type).toBe("callback");
        expect(activity?.defaultBar).toBe("left");

        if (activity?.type === "callback") {
            activity.onActivate({
                activeTabId: null,
                dockviewApi: null,
                hostPanelId: null,
                convertibleView: null,
                openTab: () => undefined,
                openFile: async () => undefined,
                closeTab: () => undefined,
                setActiveTab: () => undefined,
                activatePanel: () => undefined,
                requestMoveFileToDirectory: () => undefined,
                executeCommand: () => undefined,
            });
        }

        unsubscribe();
        disposePlugin();

        expect(capturedTitle).toBe("Test Message");
        expect(capturedMessage).toBe("greet");
    });
});