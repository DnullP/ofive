/**
 * @module plugins/ai-chat/aiChatRuntimeManagedStoreRegistration
 * @description Managed Store registration for AI chat runtime state.
 */

import {
    getAiChatRuntimeSnapshot,
    subscribeAiChatRuntimeSnapshot,
} from "./aiChatRuntimeStore";
import { registerPluginOwnedStore } from "../../host/store/storeRegistry";

const AI_CHAT_PLUGIN_ID = "ai-chat";

/**
 * @function registerAiChatRuntimeManagedStore
 * @description 注册 AI chat 运行态 store，确保会话/stream UI 状态独立于组件 lifecycle 被审计。
 * @returns 取消注册函数。
 */
export function registerAiChatRuntimeManagedStore(): () => void {
    return registerPluginOwnedStore(AI_CHAT_PLUGIN_ID, {
        storeId: "runtime",
        title: "AI Chat Runtime Store",
        description: "Frontend-owned chat UI runtime cache that survives panel/tab remounts during active sessions.",
        scope: "plugin-private",
        tags: ["ai-chat", "runtime", "stream", "conversation"],
        schema: {
            summary: "Keep AI chat conversation bindings, drafts, debug state, and stream UI state independent from React component lifecycle.",
            state: {
                fields: [
                    {
                        name: "vaultPath",
                        description: "Vault path whose runtime snapshot is currently active.",
                        valueType: "string",
                        initialValue: "null",
                    },
                    {
                        name: "activeTab",
                        description: "Visible AI chat tab within the plugin surface.",
                        valueType: "union",
                        initialValue: "chat",
                        allowedValues: ["history", "chat", "debug"],
                    },
                    {
                        name: "draft",
                        description: "Composer draft retained across sidebar or convertible-view remounts.",
                        valueType: "string",
                        initialValue: "empty string",
                    },
                    {
                        name: "bindingsByConversation",
                        description: "Pending stream bindings keyed by conversation id.",
                        valueType: "record",
                        initialValue: "empty record",
                    },
                    {
                        name: "historyState",
                        description: "Loaded conversation history snapshot for the current vault.",
                        valueType: "object",
                        initialValue: "null",
                    },
                    {
                        name: "error",
                        description: "Latest runtime-level chat error message.",
                        valueType: "string",
                        initialValue: "null",
                    },
                ],
                invariants: [
                    "runtime state is reset when vaultPath changes",
                    "active stream bindings are owned by the plugin store/hub rather than individual mounted views",
                    "component remount can restore draft, history, bindings, debug entries, and confirmations from this snapshot",
                ],
                actions: [
                    {
                        id: "hydrate-runtime",
                        description: "Initialize a mounted AI chat surface from the runtime snapshot.",
                        updates: [],
                        sideEffects: ["read runtime snapshot during component mount"],
                    },
                    {
                        id: "persist-runtime-patch",
                        description: "Write UI runtime changes back to the plugin-owned snapshot.",
                        updates: ["activeTab", "draft", "bindingsByConversation", "historyState", "error"],
                    },
                    {
                        id: "reset-runtime",
                        description: "Clear runtime state for a vault switch or plugin reset.",
                        updates: ["vaultPath", "activeTab", "draft", "bindingsByConversation", "historyState", "error"],
                    },
                ],
            },
            flow: {
                kind: "state-machine",
                description: "AI runtime moves between idle, active, streaming, and reset snapshots as UI mounts and backend stream events arrive.",
                initialState: "idle",
                states: [
                    { id: "idle", description: "No chat runtime state is active." },
                    { id: "active", description: "Chat runtime snapshot is available without an active backend stream." },
                    { id: "streaming", description: "At least one conversation has an active pending stream binding." },
                    { id: "reset", description: "Runtime has been cleared for a vault or plugin lifecycle boundary." },
                ],
                transitions: [
                    {
                        event: "component-hydrate",
                        from: ["idle", "active", "streaming"],
                        to: "active",
                        description: "A mounted surface restores its UI state from the runtime snapshot.",
                    },
                    {
                        event: "stream-start",
                        from: ["active"],
                        to: "streaming",
                        description: "Submitting a chat prompt records a pending stream binding.",
                        sideEffects: ["start backend AI chat stream"],
                    },
                    {
                        event: "stream-settle",
                        from: ["streaming"],
                        to: "active",
                        description: "A stream done, stopped, or error event clears the active pending binding.",
                    },
                    {
                        event: "reset-context",
                        from: ["idle", "active", "streaming"],
                        to: "reset",
                        description: "Vault switch or plugin disposal clears runtime state.",
                    },
                ],
                failureModes: [
                    "backend stream events received while no view is mounted are buffered by aiChatStreamEventHub and replayed after remount",
                    "component remount must not unsubscribe the backend stream listener or lose pending stream bindings",
                    "vault switch resets runtime snapshot before loading the next vault history",
                ],
            },
        },
        getSnapshot: () => getAiChatRuntimeSnapshot(),
        subscribe: (listener) => subscribeAiChatRuntimeSnapshot(listener),
    });
}
