/**
 * @module plugins/semantic-index/semanticIndexPlugin.test
 * @description semantic-index 插件测试：验证插件激活后会注册 AI 设置项与主动全量同步命令。
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import type {
    NotificationProgressOptions,
    NotificationPublishOptions,
} from "../../host/notifications/notificationCenter";

const startSemanticIndexFullSyncMock = mock(async () => ({
    workerStatus: "running",
    pendingFileCount: 0,
    hasPendingRebuild: false,
    lastEnqueuedAtMs: null,
    lastProcessedAtMs: null,
    totalFileCount: 0,
    processedFileCount: 0,
    failedFileCount: 0,
    currentFilePath: null,
    lastError: null,
}));

const getSemanticIndexStatusMock = mock(async () => ({
    status: "ready",
    activeModelId: "demo-model",
    activeModelReady: true,
    indexedChunkCount: 0,
    lastUpdatedAtMs: null,
    lastError: null,
    queueStatus: {
        workerStatus: "idle",
        pendingFileCount: 0,
        hasPendingRebuild: false,
        lastEnqueuedAtMs: null,
        lastProcessedAtMs: null,
        totalFileCount: 0,
        processedFileCount: 0,
        failedFileCount: 0,
        currentFilePath: null,
        lastError: null,
    },
}));

const publishNotificationMock = mock((payload: NotificationPublishOptions) => payload.notificationId ?? "notification-test");
const publishProgressNotificationMock = mock((payload: NotificationProgressOptions) => payload.notificationId ?? "notification-progress-test");

const actualSemanticIndexApi = await import("../../api/semanticIndexApi");

mock.module("../../api/semanticIndexApi", () => ({
    ...actualSemanticIndexApi,
    getSemanticIndexModelCatalog: async () => ({ models: [] }),
    getSemanticIndexSettings: async () => ({
        enabled: false,
        modelId: "demo-model",
        embeddingProvider: "fastembed",
        vectorStore: "sqlite-vec",
        chunkingStrategy: "heading-paragraph",
        searchResultLimit: 10,
        chunkStrategyVersion: 1,
    }),
    getSemanticIndexStatus: (...args: []) => getSemanticIndexStatusMock(...args),
    installSemanticIndexModel: async () => ({
        modelId: "demo-model",
        displayName: "Demo Model",
        installStatus: "installed",
        isDefault: true,
        dimensions: 384,
        lastError: null,
    }),
    saveSemanticIndexSettings: async (settings: unknown) => settings,
    startSemanticIndexFullSync: (...args: []) => startSemanticIndexFullSyncMock(...args),
}));

mock.module("../../host/notifications/notificationCenter", () => ({
    publishNotification: (payload: NotificationPublishOptions) => publishNotificationMock(payload),
    publishProgressNotification: (payload: NotificationProgressOptions) => publishProgressNotificationMock(payload),
}));

let resetSettingsRegistryForTests = () => {
    /* noop */
};

afterEach(() => {
    resetSettingsRegistryForTests();
    mock.restore();
});

describe("semanticIndexPlugin settings registration", () => {
    test("激活插件时应将 semantic-index 设置项注册到 AI 对话 section", async () => {
        const settingsRegistry = await import("../../host/settings/settingsRegistry");
        resetSettingsRegistryForTests = settingsRegistry.__resetSettingsRegistryForTests;
        const unregisterAiSection = settingsRegistry.registerSettingsSection({
            id: "ai-chat",
            title: "settings.aiSection",
            order: 45,
        });

        const { activatePlugin } = await import("./semanticIndexPlugin");

        const dispose = activatePlugin();
        const section = settingsRegistry
            .getSettingsSectionsSnapshot()
            .find((item) => item.id === "ai-chat");

        expect(section).toBeDefined();
        expect(section?.items.map((item) => item.id)).toEqual(["semantic-index-settings-panel"]);

        dispose();
        unregisterAiSection();
    });

    test("激活插件时应注册主动触发全量语义索引命令", async () => {
        const settingsRegistry = await import("../../host/settings/settingsRegistry");
        resetSettingsRegistryForTests = settingsRegistry.__resetSettingsRegistryForTests;

        const commandSystem = await import("../../host/commands/commandSystem");
        const { activatePlugin } = await import("./semanticIndexPlugin");

        const dispose = activatePlugin();
        const command = commandSystem.getCommandDefinition("semanticIndex.fullSyncRepository");

        expect(command).toBeDefined();
        expect(command?.title).toBe("semanticIndexPlugin.fullSyncCommand");

        dispose();
        expect(commandSystem.getCommandDefinition("semanticIndex.fullSyncRepository")).toBeUndefined();
    });

    test("执行主动全量语义索引命令时应调用后端 full sync 并发送通知", async () => {
        const settingsRegistry = await import("../../host/settings/settingsRegistry");
        resetSettingsRegistryForTests = settingsRegistry.__resetSettingsRegistryForTests;

        const commandSystem = await import("../../host/commands/commandSystem");
        const { activatePlugin } = await import("./semanticIndexPlugin");

        const dispose = activatePlugin();
        const command = commandSystem.getCommandDefinition("semanticIndex.fullSyncRepository");

        expect(command).toBeDefined();

        await command?.execute({
            activeTabId: null,
            closeTab: () => undefined,
            openFileTab: () => undefined,
            getExistingMarkdownPaths: () => [],
        });
        await Promise.resolve();

        expect(startSemanticIndexFullSyncMock).toHaveBeenCalledTimes(1);
        expect(getSemanticIndexStatusMock).toHaveBeenCalledTimes(1);
        expect(publishNotificationMock).toHaveBeenCalledTimes(1);
        expect(publishProgressNotificationMock).toHaveBeenCalledTimes(0);

        dispose();
    });
});