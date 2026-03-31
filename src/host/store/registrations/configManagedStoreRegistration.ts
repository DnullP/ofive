/**
 * @module host/store/registrations/configManagedStoreRegistration
 * @description 配置 store 的治理注册：将 configStore 作为 host-owned managed store 接入状态中枢。
 */

import { getConfigSnapshot, subscribeConfigState } from "../../config/configStore";
import { registerManagedStore } from "../storeRegistry";

/**
 * @function registerConfigManagedStore
 * @description 注册配置 store 的元数据与快照接口。
 * @returns 取消注册函数。
 */
export function registerConfigManagedStore(): () => void {
    return registerManagedStore({
        id: "config",
        title: "Config Store",
        description: "Vault-scoped and frontend-local configuration state.",
        ownerType: "host",
        scope: "vault-config",
        tags: ["config", "settings", "vault"],
        schema: {
            summary: "Govern vault-scoped backend config and frontend settings hydration for the active vault.",
            state: {
                fields: [
                    {
                        name: "loadedVaultPath",
                        description: "The vault path whose config has been hydrated into memory.",
                        valueType: "string",
                        initialValue: "null",
                        constraints: ["null means no vault config has been loaded yet"],
                    },
                    {
                        name: "backendConfig",
                        description: "The backend-owned persisted vault config snapshot.",
                        valueType: "object",
                        initialValue: "null",
                        persisted: true,
                    },
                    {
                        name: "featureSettings",
                        description: "The normalized feature flags projected from backend config.",
                        valueType: "object",
                        initialValue: "DEFAULT_FEATURE_SETTINGS",
                    },
                    {
                        name: "frontendSettings",
                        description: "Frontend-only editor and UI settings for the active vault.",
                        valueType: "object",
                        initialValue: "DEFAULT_FRONTEND_SETTINGS",
                        persisted: true,
                    },
                    {
                        name: "isLoading",
                        description: "Hydration or persistence is in flight.",
                        valueType: "boolean",
                        initialValue: "false",
                        allowedValues: ["true", "false"],
                    },
                    {
                        name: "error",
                        description: "Latest config loading or saving error message.",
                        valueType: "string",
                        initialValue: "null",
                    },
                ],
                invariants: [
                    "frontendSettings and featureSettings always stay normalized even when backendConfig is null",
                    "loadedVaultPath and backendConfig describe the same active vault snapshot",
                    "isLoading=true means the current snapshot may be in a transient hydration or persistence phase",
                ],
                actions: [
                    {
                        id: "load-config",
                        description: "Load active vault config from backend and normalize derived frontend state.",
                        updates: ["loadedVaultPath", "backendConfig", "featureSettings", "frontendSettings", "isLoading", "error"],
                        sideEffects: ["invoke backend config read APIs", "emit config change notifications"],
                    },
                    {
                        id: "update-backend-config",
                        description: "Persist backend-owned config fields and refresh derived state.",
                        updates: ["backendConfig", "featureSettings", "isLoading", "error"],
                        sideEffects: ["invoke backend config write APIs", "emit config change notifications"],
                    },
                    {
                        id: "update-frontend-settings",
                        description: "Persist frontend-only settings for the active vault.",
                        updates: ["frontendSettings", "isLoading", "error"],
                        sideEffects: ["invoke backend config write APIs", "emit config change notifications"],
                    },
                    {
                        id: "reset-config",
                        description: "Reset config snapshot when vault context changes or becomes unavailable.",
                        updates: ["loadedVaultPath", "backendConfig", "featureSettings", "frontendSettings", "isLoading", "error"],
                    },
                ],
            },
            flow: {
                kind: "state-machine",
                description: "Config store alternates between idle, loading, ready, and error snapshots around vault hydration and persistence.",
                initialState: "idle",
                states: [
                    { id: "idle", description: "No vault config has been loaded yet." },
                    { id: "loading", description: "Backend config is being loaded or persisted." },
                    { id: "ready", description: "Normalized config snapshot is available for the active vault." },
                    { id: "error", description: "Last load or save attempt failed and error is retained in state." },
                ],
                transitions: [
                    {
                        event: "hydrate-active-vault",
                        from: ["idle", "ready", "error"],
                        to: "loading",
                        description: "Starting a config fetch or a write-through refresh enters loading.",
                        sideEffects: ["invoke backend config API"],
                    },
                    {
                        event: "hydrate-success",
                        from: ["loading"],
                        to: "ready",
                        description: "Successful hydration produces a normalized ready snapshot.",
                    },
                    {
                        event: "hydrate-failure",
                        from: ["loading"],
                        to: "error",
                        description: "Hydration or persistence failure records an error snapshot.",
                    },
                    {
                        event: "reset-context",
                        from: ["ready", "error"],
                        to: "idle",
                        description: "Vault switch or teardown resets the config context.",
                    },
                ],
                failureModes: [
                    "backend read/write failure leaves normalized defaults plus error message",
                    "vault switches can invalidate in-flight config results and require reset before next hydrate",
                ],
            },
        },
        getSnapshot: () => getConfigSnapshot(),
        subscribe: (listener) => subscribeConfigState(listener),
    });
}