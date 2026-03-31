/**
 * @module host/store/registrations/shortcutManagedStoreRegistration
 * @description 快捷键 store 的治理注册：将 shortcutStore 作为 managed store 接入 host 层统一治理。
 */

import { registerShortcutSettingsSection } from "../../settings/registrars/shortcutSettingsRegistrar";
import {
    getShortcutStateSnapshot,
    subscribeShortcutState,
} from "../../commands/shortcutStore";
import { registerManagedStore } from "../storeRegistry";

/**
 * @function registerShortcutManagedStore
 * @description 注册快捷键 store 的元数据、快照接口与 settings 贡献。
 * @returns 取消注册函数。
 */
export function registerShortcutManagedStore(): () => void {
    return registerManagedStore({
        id: "shortcut",
        title: "Shortcut Store",
        description: "Vault-scoped command shortcut bindings and governance.",
        ownerType: "host",
        scope: "vault-config",
        tags: ["shortcut", "keybinding", "commands", "settings"],
        schema: {
            summary: "Govern vault-scoped command bindings, load lifecycle, and save rollback behavior.",
            state: {
                fields: [
                    {
                        name: "bindings",
                        description: "Normalized shortcut bindings keyed by registered command id.",
                        valueType: "record",
                        initialValue: "buildDefaultShortcuts()",
                        persisted: true,
                        constraints: ["all registered commands must have a binding entry, possibly empty"],
                    },
                    {
                        name: "loadedVaultPath",
                        description: "The vault path whose bindings were last loaded from persistence.",
                        valueType: "string",
                        initialValue: "null",
                    },
                    {
                        name: "isLoading",
                        description: "Binding load or save request is in flight.",
                        valueType: "boolean",
                        initialValue: "false",
                        allowedValues: ["true", "false"],
                    },
                    {
                        name: "error",
                        description: "Latest shortcut load or save error message.",
                        valueType: "string",
                        initialValue: "null",
                    },
                ],
                invariants: [
                    "bindings always cover the current registered command set after normalization",
                    "loadedVaultPath identifies the persistence context for the current bindings snapshot",
                    "isLoading=false after every resolved or rejected async load/save attempt",
                ],
                actions: [
                    {
                        id: "load-shortcuts",
                        description: "Load vault bindings from config and merge them with current command defaults.",
                        updates: ["bindings", "loadedVaultPath", "isLoading", "error"],
                        sideEffects: ["read shortcut config from backend", "notify subscribers"],
                    },
                    {
                        id: "update-binding",
                        description: "Change a single command binding and persist it with rollback on failure.",
                        updates: ["bindings", "isLoading", "error"],
                        sideEffects: ["write shortcut config to backend", "rollback snapshot on save failure"],
                    },
                    {
                        id: "sync-registered-commands",
                        description: "Rebuild bindings when the command registry changes.",
                        updates: ["bindings"],
                        sideEffects: ["subscribe to command registry updates"],
                    },
                    {
                        id: "reset-shortcuts",
                        description: "Reset shortcut state when vault context changes or is cleared.",
                        updates: ["bindings", "loadedVaultPath", "isLoading", "error"],
                    },
                ],
            },
            flow: {
                kind: "state-machine",
                description: "Shortcut store cycles through idle, loading, ready, and error during vault hydration and save attempts.",
                initialState: "idle",
                states: [
                    { id: "idle", description: "No vault-specific shortcut snapshot has been loaded yet." },
                    { id: "loading", description: "Bindings are being loaded or persisted." },
                    { id: "ready", description: "Bindings are normalized and ready for use." },
                    { id: "error", description: "Last load/save attempt failed and error is retained." },
                ],
                transitions: [
                    {
                        event: "load-request",
                        from: ["idle", "ready", "error"],
                        to: "loading",
                        description: "A vault hydration request starts asynchronous loading.",
                        sideEffects: ["read persisted shortcut config"],
                    },
                    {
                        event: "load-success",
                        from: ["loading"],
                        to: "ready",
                        description: "Loaded bindings merge with command defaults and become active.",
                    },
                    {
                        event: "save-request",
                        from: ["ready", "error"],
                        to: "loading",
                        description: "Editing bindings enters a transient persistence phase.",
                        sideEffects: ["write shortcut config"],
                    },
                    {
                        event: "save-success",
                        from: ["loading"],
                        to: "ready",
                        description: "Persisted bindings remain active after save success.",
                    },
                    {
                        event: "request-failure",
                        from: ["loading"],
                        to: "error",
                        description: "Load or save failure records an error snapshot and may rollback bindings.",
                        sideEffects: ["restore previous bindings on failed save"],
                    },
                    {
                        event: "reset-context",
                        from: ["ready", "error"],
                        to: "idle",
                        description: "Vault switch clears the previous persistence context.",
                    },
                ],
                failureModes: [
                    "save failure rolls bindings back to the previous stable snapshot",
                    "loading against a stale vault path must not leak bindings into the next vault context",
                ],
            },
        },
        getSnapshot: () => getShortcutStateSnapshot(),
        subscribe: (listener) => subscribeShortcutState(listener),
        contributions: [{
            kind: "settings",
            activate: () => registerShortcutSettingsSection(),
        }],
    });
}