/**
 * @module plugins/outline/outlineManagedStoreRegistration
 * @description Managed Store registration for the outline derived-state owner.
 */

import {
    getOutlineSnapshot,
    subscribeOutlineSnapshot,
} from "./outlineStore";
import { registerPluginOwnedStore } from "../../host/store/storeRegistry";

const OUTLINE_PLUGIN_ID = "outline";

/**
 * @function registerOutlineManagedStore
 * @description 注册 outline store，让大纲派生状态、后端 fallback 和 remount 稳定性进入状态治理视图。
 * @returns 取消注册函数。
 */
export function registerOutlineManagedStore(): () => void {
    return registerPluginOwnedStore(OUTLINE_PLUGIN_ID, {
        storeId: "outline",
        title: "Outline Store",
        description: "Active Markdown article outline derived from canonical frontend content with persisted backend fallback.",
        scope: "plugin-private",
        tags: ["outline", "editor", "derived-content"],
        schema: {
            summary: "Maintain one outline snapshot for the active Markdown editor independent from sidebar panel lifecycle.",
            state: {
                fields: [
                    {
                        name: "activeEditor",
                        description: "Active Markdown editor that owns the currently displayed outline.",
                        valueType: "object",
                        initialValue: "null",
                    },
                    {
                        name: "relativePath",
                        description: "Normalized relative path of the current outline source.",
                        valueType: "string",
                        initialValue: "null",
                    },
                    {
                        name: "headings",
                        description: "Derived heading list consumed by the outline panel.",
                        valueType: "array",
                        initialValue: "empty array",
                        derived: true,
                    },
                    {
                        name: "loading",
                        description: "Persisted backend outline request is in flight.",
                        valueType: "boolean",
                        initialValue: "false",
                        allowedValues: ["true", "false"],
                    },
                    {
                        name: "error",
                        description: "Latest persisted outline fallback error.",
                        valueType: "string",
                        initialValue: "null",
                    },
                ],
                invariants: [
                    "headings are derived from canonical frontend Markdown content whenever that snapshot exists",
                    "backend outline fallback is only used when canonical frontend content is unavailable",
                    "stale async fallback responses cannot overwrite a newer active editor outline",
                ],
                actions: [
                    {
                        id: "follow-active-editor",
                        description: "Switch outline source when the active Markdown editor changes.",
                        updates: ["activeEditor", "relativePath", "headings", "loading", "error"],
                    },
                    {
                        id: "refresh-from-canonical-content",
                        description: "Recompute headings from current frontend Markdown content.",
                        updates: ["headings", "loading", "error"],
                    },
                    {
                        id: "load-persisted-fallback",
                        description: "Load persisted backend outline when no canonical content snapshot exists.",
                        updates: ["headings", "loading", "error"],
                        sideEffects: ["invoke vault outline read API"],
                    },
                ],
            },
            flow: {
                kind: "state-machine",
                description: "Outline moves between idle, canonical-ready, loading fallback, and error snapshots as active editor and content events change.",
                initialState: "idle",
                states: [
                    { id: "idle", description: "No active Markdown editor is available." },
                    { id: "canonical-ready", description: "Headings are derived from frontend canonical Markdown content." },
                    { id: "loading-fallback", description: "Persisted outline fallback request is in flight." },
                    { id: "fallback-ready", description: "Headings came from persisted backend fallback." },
                    { id: "error", description: "Fallback request failed and error is retained." },
                ],
                transitions: [
                    {
                        event: "active-editor-changed",
                        from: ["idle", "canonical-ready", "fallback-ready", "error"],
                        to: "canonical-ready",
                        description: "Active editor changed and canonical content is already available.",
                    },
                    {
                        event: "fallback-request",
                        from: ["idle", "canonical-ready", "fallback-ready", "error"],
                        to: "loading-fallback",
                        description: "Active editor has no canonical content, so persisted fallback is requested.",
                        sideEffects: ["invoke vault outline read API"],
                    },
                    {
                        event: "fallback-success",
                        from: ["loading-fallback"],
                        to: "fallback-ready",
                        description: "Persisted fallback resolved for the latest request id.",
                    },
                    {
                        event: "fallback-failure",
                        from: ["loading-fallback"],
                        to: "error",
                        description: "Persisted fallback failed for the latest request id.",
                    },
                    {
                        event: "content-or-persisted-update",
                        from: ["canonical-ready", "fallback-ready", "error"],
                        to: "canonical-ready",
                        description: "Editor or persisted-content event recomputes headings from canonical content.",
                    },
                ],
                failureModes: [
                    "panel unmount or activity switch must not reset the outline snapshot",
                    "newer active editor changes invalidate older persisted fallback responses by request id",
                    "persisted update should not reload backend when canonical frontend content exists",
                ],
            },
        },
        getSnapshot: () => getOutlineSnapshot(),
        subscribe: (listener) => subscribeOutlineSnapshot(listener),
    });
}
