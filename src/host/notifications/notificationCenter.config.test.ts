/**
 * @module host/notifications/notificationCenter.config.test
 * @description 宿主消息中心与配置联动回归测试：关闭前端通知后不应再派发消息事件。
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

interface MockVaultConfig {
    schemaVersion: number;
    entries: Record<string, unknown>;
}

let currentVaultConfig: MockVaultConfig = {
    schemaVersion: 1,
    entries: {},
};

mock.module("../../api/vaultApi", () => ({
    getCurrentVaultConfig: async () => structuredClone(currentVaultConfig),
    saveCurrentVaultConfig: async (nextConfig: MockVaultConfig) => {
        currentVaultConfig = structuredClone(nextConfig);
        return structuredClone(nextConfig);
    },
    subscribeVaultFsEvents: async () => {
        return () => {
            /* noop */
        };
    },
    subscribeVaultConfigEvents: async () => {
        return () => {
            /* noop */
        };
    },
    isSelfTriggeredVaultConfigEvent: () => false,
}));

const { syncConfigStateForVault } = await import("../config/configStore");
const { publishNotification, subscribeNotificationCenter } = await import("./notificationCenter");

afterEach(async () => {
    await syncConfigStateForVault("", true);
    mock.restore();
});

describe("notificationCenter config gating", () => {
    beforeEach(async () => {
        currentVaultConfig = {
            schemaVersion: 1,
            entries: {
                features: {
                    notificationsEnabled: false,
                },
            },
        };

        await syncConfigStateForVault("/tmp/notifications-disabled-vault", true);
    });

    it("should skip dispatching notifications when frontend notifications are disabled", () => {
        let capturedEventType = "";

        const unlisten = subscribeNotificationCenter((event) => {
            capturedEventType = event.type;
        });

        publishNotification({
            level: "warn",
            message: "should not be shown",
        });

        unlisten();

        expect(capturedEventType).toBe("");
    });
});