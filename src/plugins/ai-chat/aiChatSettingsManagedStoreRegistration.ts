/**
 * @module plugins/ai-chat/aiChatSettingsManagedStoreRegistration
 * @description Managed Store registration for AI chat settings.
 */

import {
    getAiChatSettingsSnapshot,
    subscribeAiChatSettingsSnapshot,
} from "./aiChatSettingsStore";
import { registerPluginOwnedStore } from "../../host/store/storeRegistry";

const AI_CHAT_PLUGIN_ID = "ai-chat";

export interface AiChatSettingsManagedStoreRegistrationOptions {
    registerSettingsSection: () => void | (() => void);
}

/**
 * @function registerAiChatSettingsManagedStore
 * @description 注册 AI chat settings store，并通过 contribution 连接设置页。
 * @param options 设置 contribution 注册选项。
 * @returns 取消注册函数。
 */
export function registerAiChatSettingsManagedStore(
    options: AiChatSettingsManagedStoreRegistrationOptions,
): () => void {
    return registerPluginOwnedStore(AI_CHAT_PLUGIN_ID, {
        storeId: "settings",
        title: "AI Chat Settings Store",
        description: "Vault-scoped AI chat settings and provider configuration state.",
        scope: "plugin-private",
        tags: ["ai-chat", "settings", "llm"],
        schema: {
            summary: "Govern vault-scoped AI chat settings hydration, save, and reset behavior for the plugin.",
            state: {
                fields: [
                    {
                        name: "vaultPath",
                        description: "The vault path whose AI settings are currently loaded.",
                        valueType: "string",
                        initialValue: "null",
                    },
                    {
                        name: "settings",
                        description: "The currently loaded AI chat settings snapshot.",
                        valueType: "object",
                        initialValue: "null",
                        persisted: true,
                    },
                    {
                        name: "isLoading",
                        description: "Settings load or save request is in flight.",
                        valueType: "boolean",
                        initialValue: "false",
                        allowedValues: ["true", "false"],
                    },
                    {
                        name: "error",
                        description: "Latest AI settings load or save error message.",
                        valueType: "string",
                        initialValue: "null",
                    },
                ],
                invariants: [
                    "settings belongs to vaultPath when vaultPath is non-null",
                    "isLoading=false after every resolved or rejected settings request",
                ],
                actions: [
                    {
                        id: "ensure-loaded",
                        description: "Load AI settings for the active vault and cache the snapshot.",
                        updates: ["vaultPath", "settings", "isLoading", "error"],
                        sideEffects: ["invoke ai settings read API"],
                    },
                    {
                        id: "save-settings",
                        description: "Persist AI settings for the active vault and refresh the cached snapshot.",
                        updates: ["vaultPath", "settings", "isLoading", "error"],
                        sideEffects: ["invoke ai settings save API"],
                    },
                    {
                        id: "reset-settings",
                        description: "Clear cached AI settings when vault context changes or plugin resets.",
                        updates: ["vaultPath", "settings", "isLoading", "error"],
                    },
                ],
            },
            flow: {
                kind: "state-machine",
                description: "AI chat settings move through idle, loading, ready, and error snapshots around async persistence.",
                initialState: "idle",
                states: [
                    { id: "idle", description: "No vault settings snapshot is currently loaded." },
                    { id: "loading", description: "AI settings are being loaded or saved." },
                    { id: "ready", description: "AI settings snapshot is available for the active vault." },
                    { id: "error", description: "Last async settings request failed and error is retained." },
                ],
                transitions: [
                    {
                        event: "load-or-save-request",
                        from: ["idle", "ready", "error"],
                        to: "loading",
                        description: "A load or save request enters the async loading phase.",
                        sideEffects: ["invoke ai chat settings API"],
                    },
                    {
                        event: "request-success",
                        from: ["loading"],
                        to: "ready",
                        description: "Successful load or save produces a ready settings snapshot.",
                    },
                    {
                        event: "request-failure",
                        from: ["loading"],
                        to: "error",
                        description: "Failed load or save records an error snapshot.",
                    },
                    {
                        event: "reset-context",
                        from: ["ready", "error"],
                        to: "idle",
                        description: "Vault switch or plugin reset clears cached settings.",
                    },
                ],
                failureModes: [
                    "async API failure leaves the previous settings snapshot or null plus error",
                    "vault switch must reset cached settings before the next load completes",
                ],
            },
        },
        getSnapshot: () => getAiChatSettingsSnapshot(),
        subscribe: (listener) => subscribeAiChatSettingsSnapshot(listener),
        contributions: [{
            kind: "settings",
            activate: options.registerSettingsSection,
        }],
    });
}
