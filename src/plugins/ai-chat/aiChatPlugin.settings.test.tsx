/**
 * @module plugins/ai-chat/aiChatPlugin.settings.test
 * @description AI chat plugin settings 测试：验证插件激活后会通过中心 settings registry 注册 AI 设置项。
 */

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.restore();

let resetSettingsRegistryForTests = () => {
    /* noop */
};

mock.module("../../api/aiApi", () => ({
    getAiChatHistory: async () => ({ conversations: [] }),
    getAiVendorCatalog: async () => ({ vendors: [] }),
    getAiVendorModels: async () => ({ models: [] }),
    saveAiChatHistory: async () => undefined,
    startAiChatStream: async () => undefined,
    submitAiChatConfirmation: async () => undefined,
    subscribeAiChatStreamEvents: () => () => {
        /* noop */
    },
}));

mock.module("./aiChatSettingsStore", () => ({
    ensureAiChatSettingsLoaded: async () => undefined,
    getAiChatSettingsSnapshot: () => ({
        vaultPath: null,
        settings: null,
        isLoading: false,
        error: null,
    }),
    resetAiChatSettingsStore: () => undefined,
    saveAiChatSettingsToStore: async () => ({ vendorId: "demo", model: "demo" }),
    subscribeAiChatSettingsSnapshot: () => () => {
        /* noop */
    },
}));

mock.module("./aiChatShared", () => ({
    buildPersistableHistory: () => [],
    createConversationRecord: () => ({ id: "conversation" }),
    deriveConversationTitle: () => "title",
    ensureHistoryState: () => ({ conversations: [], activeConversationId: null }),
    filterConversations: () => [],
    formatAiPanelError: () => "error",
    formatConversationTime: () => "now",
    mergeSettingsForVendor: (settings: unknown) => settings,
    resolveVendor: () => null,
    sortConversations: () => [],
}));

mock.module("./aiChatStreamState", () => ({
    createEmptyPendingStreamBinding: () => ({}),
    createPendingStreamBinding: () => ({}),
    reduceAiChatStreamEvent: (state: unknown) => state,
}));

mock.module("./aiChatDebugFilter", () => ({
    filterChatDebugEntries: () => [],
}));

mock.module("./aiChatDebugExport", () => ({
    formatAiChatDebugEntriesForClipboard: () => "",
}));

mock.module("./aiChatInputPolicy", () => ({
    shouldSubmitAiChatComposer: () => false,
}));

mock.module("./aiChatMessageMarkdown", () => ({
    AiChatMessageMarkdown: () => null,
}));

mock.module("./aiChatConfirmationPreview", () => ({
    buildConfirmationPreview: () => null,
}));

mock.module("../../host/registry/activityRegistry", () => ({
    registerActivity: () => () => {
        /* noop */
    },
}));

mock.module("../../host/registry/panelRegistry", () => ({
    registerPanel: () => () => {
        /* noop */
    },
}));

mock.module("../../host/store/storeRegistry", async () => {
    return {
        registerPluginOwnedStore: (_pluginId: string, descriptor: { contributions?: Array<{ kind: string; activate: () => void | (() => void) }> }) => {
            const dispose = descriptor.contributions
                ?.filter((contribution) => contribution.kind === "settings")
                .map((contribution) => contribution.activate())
                .find((candidate) => typeof candidate === "function");

            return () => {
                if (typeof dispose === "function") {
                    dispose();
                }
            };
        },
    };
});

mock.module("../../host/vault/vaultStore", () => ({
    useVaultState: () => ({ currentVaultPath: null }),
}));

mock.module("lucide-react", () => ({
    ArrowUp: () => null,
    Bot: () => null,
    Check: () => null,
    Copy: () => null,
    Plus: () => null,
    Sparkles: () => null,
    X: () => null,
}));

mock.module("../../i18n", () => ({
    default: {
        t: (key: string) => key,
    },
}));

afterEach(() => {
    if (typeof resetSettingsRegistryForTests === "function") {
        resetSettingsRegistryForTests();
    }
    mock.restore();
});

describe("aiChatPlugin settings registration", () => {
    test("激活插件时应向中心 settings registry 注册 AI 设置 section 和 item", async () => {
        const settingsRegistry = await import("../../host/settings/settingsRegistry");
        resetSettingsRegistryForTests = settingsRegistry.__resetSettingsRegistryForTests;

        const { activatePlugin } = await import("./aiChatPlugin");

        const dispose = activatePlugin();
        const section = settingsRegistry
            .getSettingsSectionsSnapshot()
            .find((item) => item.id === "ai-chat");

        expect(section).toBeDefined();
        expect(section?.items.map((item) => item.id)).toEqual(["ai-chat-settings-panel"]);

        dispose();
    });
});