/**
 * @module host/notifications/notificationCenter.test
 * @description 宿主消息中心单元测试：覆盖发布、更新与关闭事件语义。
 * @dependencies
 *   - bun:test
 *   - ./notificationCenter
 *
 * @example
 *   bun test src/host/notifications/notificationCenter.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    dismissNotification,
    publishNotification,
    publishProgressNotification,
    subscribeNotificationCenter,
} from "./notificationCenter";

describe("notificationCenter", () => {
    /**
     * @function should_publish_normalized_notification_record
     * @description 发布消息后，订阅者应收到带默认值的 upsert 事件。
     */
    it("should publish normalized notification record", () => {
        let capturedEventType = "";
        let capturedMessage = "";
        let capturedSource = "";
        let capturedProgress: number | null = null;

        const unlisten = subscribeNotificationCenter((event) => {
            if (event.type !== "upsert") {
                return;
            }

            capturedEventType = event.type;
            capturedMessage = event.notification.message;
            capturedSource = event.notification.source;
            capturedProgress = event.notification.progress;
        });

        publishNotification({
            level: "warn",
            message: "vault path missing",
        });

        unlisten();

        expect(capturedEventType).toBe("upsert");
        expect(capturedMessage).toBe("vault path missing");
        expect(capturedSource).toBe("module");
        expect(capturedProgress).toBeNull();
    });

    /**
     * @function should_publish_progress_notification_with_clamped_progress
     * @description 进度消息应携带归一化后的进度值。
     */
    it("should publish progress notification with clamped progress", () => {
        let capturedProgress: number | null = null;

        const unlisten = subscribeNotificationCenter((event) => {
            if (event.type !== "upsert") {
                return;
            }

            capturedProgress = event.notification.progress;
        });

        publishProgressNotification({
            message: "semantic index building",
            progress: 132,
        });

        unlisten();

        expect(capturedProgress).not.toBeNull();
        expect(capturedProgress ?? 0).toEqual(100);
    });

    /**
     * @function should_publish_dismiss_event_for_target_notification
     * @description 主动关闭消息时，订阅者应收到 dismiss 事件。
     */
    it("should publish dismiss event for target notification", () => {
        let capturedNotificationId = "";
        const notificationId = publishNotification({
            level: "info",
            message: "build completed",
        });

        const unlisten = subscribeNotificationCenter((event) => {
            if (event.type !== "dismiss") {
                return;
            }

            capturedNotificationId = event.notificationId;
        });

        dismissNotification(notificationId);
        unlisten();

        expect(capturedNotificationId).toBe(notificationId);
    });
});