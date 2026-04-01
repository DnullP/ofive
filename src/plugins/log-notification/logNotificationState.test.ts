/**
 * @module plugins/log-notification/logNotificationState.test
 * @description 日志提示插件状态机测试：覆盖 upsert、倒计时与 hover 后重置倒计时。
 * @dependencies
 *   - bun:test
 *   - ./logNotificationState
 *
 * @example
 *   bun test src/plugins/log-notification/logNotificationState.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    applyNotificationCenterEvent,
    setNotificationHovered,
    tickNotificationState,
} from "./logNotificationState";

describe("logNotificationState", () => {
    /**
     * @function should_upsert_notification_and_reset_countdown
     * @description 同一 notificationId 再次 upsert 时，应重置剩余倒计时。
     */
    it("should upsert notification and reset countdown", () => {
        const initial = applyNotificationCenterEvent([], {
            type: "upsert",
            notification: {
                notificationId: "job-1",
                level: "warn",
                title: null,
                message: "building",
                source: "module",
                progress: 20,
                autoCloseMs: 3000,
                createdAt: 1,
                updatedAt: 1,
            },
        });
        const ticked = tickNotificationState(initial, 1500);
        const updated = applyNotificationCenterEvent(ticked, {
            type: "upsert",
            notification: {
                notificationId: "job-1",
                level: "warn",
                title: null,
                message: "building more",
                source: "module",
                progress: 55,
                autoCloseMs: 3000,
                createdAt: 1,
                updatedAt: 2,
            },
        });

        expect(updated).toHaveLength(1);
        expect(updated[0]?.remainingMs).toBe(3000);
        expect(updated[0]?.message).toBe("building more");
    });

    /**
     * @function should_remove_notification_after_timeout
     * @description 倒计时归零后，消息应被自动移除。
     */
    it("should remove notification after timeout", () => {
        const initial = applyNotificationCenterEvent([], {
            type: "upsert",
            notification: {
                notificationId: "warn-1",
                level: "warn",
                title: null,
                message: "watch failed",
                source: "backend-log",
                progress: null,
                autoCloseMs: 500,
                createdAt: 1,
                updatedAt: 1,
            },
        });
        const ticked = tickNotificationState(initial, 600);

        expect(ticked).toHaveLength(0);
    });

    /**
     * @function should_restart_countdown_after_hover_leave
     * @description hover 离开时，消息倒计时应从完整时长重新开始。
     */
    it("should restart countdown after hover leave", () => {
        const initial = applyNotificationCenterEvent([], {
            type: "upsert",
            notification: {
                notificationId: "job-2",
                level: "info",
                title: null,
                message: "syncing",
                source: "module",
                progress: 80,
                autoCloseMs: 2000,
                createdAt: 1,
                updatedAt: 1,
            },
        });
        const ticked = tickNotificationState(initial, 900);
        const hovered = setNotificationHovered(ticked, "job-2", true);
        const afterHoverTick = tickNotificationState(hovered, 900);
        const unhovered = setNotificationHovered(afterHoverTick, "job-2", false);

        expect(afterHoverTick[0]?.remainingMs).toBe(1100);
        expect(unhovered[0]?.remainingMs).toBe(2000);
    });
});