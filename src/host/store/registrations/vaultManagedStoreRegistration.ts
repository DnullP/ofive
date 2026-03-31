/**
 * @module host/store/registrations/vaultManagedStoreRegistration
 * @description Vault store 的治理注册：将 vaultStore 作为 host-owned managed store 接入状态中枢。
 */

import { getVaultStateSnapshot, subscribeVaultState } from "../../vault/vaultStore";
import { registerManagedStore } from "../storeRegistry";

/**
 * @function registerVaultManagedStore
 * @description 注册 vault store 的元数据与快照接口。
 * @returns 取消注册函数。
 */
export function registerVaultManagedStore(): () => void {
    return registerManagedStore({
        id: "vault",
        title: "Vault Store",
        description: "Current vault path, tree state, and backend readiness.",
        ownerType: "host",
        scope: "vault-config",
        tags: ["vault", "file-tree", "workspace"],
        schema: {
            summary: "Govern the active vault path, file tree snapshot, and backend readiness handshake.",
            state: {
                fields: [
                    {
                        name: "currentVaultPath",
                        description: "The currently selected vault root path.",
                        valueType: "string",
                        initialValue: "persisted vault path or empty string",
                        persisted: true,
                    },
                    {
                        name: "files",
                        description: "Flattened file tree snapshot for the active vault.",
                        valueType: "array",
                        initialValue: "[]",
                    },
                    {
                        name: "isLoadingTree",
                        description: "File tree hydration is in progress.",
                        valueType: "boolean",
                        initialValue: "false",
                        allowedValues: ["true", "false"],
                    },
                    {
                        name: "backendReady",
                        description: "Whether the backend has accepted and prepared the current vault context.",
                        valueType: "boolean",
                        initialValue: "false",
                        allowedValues: ["true", "false"],
                    },
                    {
                        name: "error",
                        description: "Latest vault sync or tree loading error message.",
                        valueType: "string",
                        initialValue: "null",
                    },
                ],
                invariants: [
                    "backendReady=true implies currentVaultPath is non-empty",
                    "files describes the last successful tree snapshot for currentVaultPath",
                    "isLoadingTree=false after every resolved or rejected tree refresh",
                ],
                actions: [
                    {
                        id: "set-current-vault",
                        description: "Switch the active vault and kick off backend synchronization.",
                        updates: ["currentVaultPath", "backendReady", "isLoadingTree", "error"],
                        sideEffects: ["persist current vault path", "invoke backend set_current_vault"],
                    },
                    {
                        id: "load-tree",
                        description: "Fetch the current vault file tree from backend.",
                        updates: ["files", "isLoadingTree", "backendReady", "error"],
                        sideEffects: ["invoke backend get_current_vault_tree"],
                    },
                    {
                        id: "apply-fs-event",
                        description: "Apply file-system event updates to the in-memory tree snapshot.",
                        updates: ["files", "error"],
                        sideEffects: ["listen to vault fs events"],
                    },
                    {
                        id: "reset-vault-state",
                        description: "Clear transient state when vault sync fails or is cleared.",
                        updates: ["files", "isLoadingTree", "backendReady", "error"],
                    },
                ],
            },
            flow: {
                kind: "state-machine",
                description: "Vault store moves through selection, backend handshake, tree loading, ready, and failure states.",
                initialState: "idle",
                states: [
                    { id: "idle", description: "No vault is active yet." },
                    { id: "syncing", description: "A vault path has been selected and backend handshake is running." },
                    { id: "loading-tree", description: "Backend is ready and the file tree is being loaded." },
                    { id: "ready", description: "Vault path and tree snapshot are ready for consumers." },
                    { id: "error", description: "Handshake or tree loading failed and error is retained." },
                ],
                transitions: [
                    {
                        event: "select-vault",
                        from: ["idle", "ready", "error"],
                        to: "syncing",
                        description: "Selecting a vault starts the backend handshake.",
                        sideEffects: ["persist vault path", "invoke backend current vault setup"],
                    },
                    {
                        event: "backend-ready",
                        from: ["syncing"],
                        to: "loading-tree",
                        description: "After backend setup succeeds, the store loads the file tree.",
                        sideEffects: ["invoke backend tree fetch"],
                    },
                    {
                        event: "tree-load-success",
                        from: ["loading-tree"],
                        to: "ready",
                        description: "Successful tree load produces a ready snapshot.",
                    },
                    {
                        event: "sync-or-load-failure",
                        from: ["syncing", "loading-tree"],
                        to: "error",
                        description: "Handshake or tree loading failure records an error snapshot.",
                    },
                    {
                        event: "clear-vault",
                        from: ["ready", "error"],
                        to: "idle",
                        description: "Clearing vault context returns the store to idle.",
                    },
                ],
                failureModes: [
                    "backend handshake failure keeps backendReady=false and surfaces error",
                    "tree load failure leaves the previous file snapshot stale until the next successful refresh",
                ],
            },
        },
        getSnapshot: () => getVaultStateSnapshot(),
        subscribe: (listener) => subscribeVaultState(listener),
    });
}