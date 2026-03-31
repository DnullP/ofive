/**
 * @module plugins/knowledgeGraphPlugin
 * @description 知识图谱插件：自注册知识图谱活动入口、Tab 组件与设置选栏。
 *
 *   该模块作为知识图谱功能的唯一前端入口，负责：
 *   - 注册活动栏图标，点击后打开知识图谱 Tab
 *   - 注册知识图谱 Tab 组件类型
 *   - 注册知识图谱设置选栏
 *
 *   放置于 `src/plugins/` 后会被 `main.tsx` 自动发现并执行。
 *
 * @dependencies
 *   - react
 *   - lucide-react
 *   - ../../host/registry/activityRegistry
 *   - ../../host/registry/tabComponentRegistry
 *   - ./settings/graphSettingsRegistrar
 *   - ./tab/KnowledgeGraphTab
 *   - ../../i18n
 *
 * @example
 *   插件无需手工导入；应用启动时由插件运行时自动激活。
 *
 * @exports
 *   - activatePlugin 注册并返回清理函数
 */

import React from "react";
import { Orbit } from "lucide-react";
import { KnowledgeGraphTab } from "./tab/KnowledgeGraphTab";
import { registerCommand } from "../../host/commands/commandSystem";
import i18n from "../../i18n";
import { registerActivity } from "../../host/registry/activityRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";
import { getConfigSnapshot, subscribeConfigChanges } from "../../host/config/configStore";
import { registerPluginOwnedStore } from "../../host/store/storeRegistry";
import { registerGraphSettingsSection } from "./settings/graphSettingsRegistrar";
import {
    getGraphSettingsStateSnapshot,
    subscribeGraphSettingsState,
} from "./store/graphSettingsStore";

const KNOWLEDGE_GRAPH_TAB_COMPONENT_ID = "knowledgegraph";
const KNOWLEDGE_GRAPH_ACTIVITY_ID = "knowledge-graph";
const KNOWLEDGE_GRAPH_COMMAND_ID = "knowledgeGraph.open";

/**
 * @function t
 * @description 图谱插件翻译辅助函数。
 * @param key i18n 键。
 * @returns 翻译结果。
 */
function t(key: string): string {
    return i18n.t(key);
}

/**
 * @function registerKnowledgeGraphPlugin
 * @description 注册知识图谱插件的全部前端扩展点。
 * @returns 取消注册函数。
 */
function registerKnowledgeGraphPlugin(): () => void {
    const unregisterTabComponent = registerTabComponent({
        id: KNOWLEDGE_GRAPH_TAB_COMPONENT_ID,
        component: KnowledgeGraphTab,
        lifecycleScope: "vault",
    });

    const unregisterActivity = registerActivity({
        type: "callback",
        id: KNOWLEDGE_GRAPH_ACTIVITY_ID,
        title: () => t("app.knowledgeGraph"),
        icon: React.createElement(Orbit, { size: 18, strokeWidth: 1.8 }),
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 3,
        onActivate: (context) => {
            context.openTab({
                id: KNOWLEDGE_GRAPH_ACTIVITY_ID,
                title: t("app.knowledgeGraph"),
                component: KNOWLEDGE_GRAPH_TAB_COMPONENT_ID,
            });
        },
    });

    const unregisterCommand = registerCommand({
        id: KNOWLEDGE_GRAPH_COMMAND_ID,
        title: "knowledgeGraphPlugin.openCommand",
        execute: (context) => {
            if (!context.openTab) {
                console.warn("[knowledgeGraphPlugin] open command skipped: openTab missing");
                return;
            }

            context.openTab({
                id: KNOWLEDGE_GRAPH_ACTIVITY_ID,
                title: t("app.knowledgeGraph"),
                component: KNOWLEDGE_GRAPH_TAB_COMPONENT_ID,
            });
        },
    });

    const unregisterGraphSettingsStore = registerPluginOwnedStore("knowledge-graph", {
        storeId: "settings",
        title: "Knowledge Graph Settings Store",
        description: "Vault-scoped knowledge graph settings and persistence state.",
        scope: "plugin-private",
        tags: ["knowledge-graph", "settings", "graph"],
        schema: {
            summary: "Govern knowledge graph settings hydration, normalization, persistence, and reset behavior.",
            state: {
                fields: [
                    {
                        name: "settings",
                        description: "Normalized knowledge graph settings for the active vault.",
                        valueType: "object",
                        initialValue: "DEFAULT_KNOWLEDGE_GRAPH_SETTINGS",
                        persisted: true,
                    },
                    {
                        name: "loadedVaultPath",
                        description: "The vault path whose graph settings are currently loaded.",
                        valueType: "string",
                        initialValue: "null",
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
                        description: "Latest graph settings load or save error message.",
                        valueType: "string",
                        initialValue: "null",
                    },
                ],
                invariants: [
                    "settings is always normalized against DEFAULT_KNOWLEDGE_GRAPH_SETTINGS",
                    "loadedVaultPath identifies the vault context for the current settings snapshot",
                    "isLoading=false after every resolved or rejected load/save attempt",
                ],
                actions: [
                    {
                        id: "load-settings",
                        description: "Load and normalize graph settings for the active vault.",
                        updates: ["settings", "loadedVaultPath", "isLoading", "error"],
                        sideEffects: ["read graph settings from vault config", "rewrite config when deprecated fields are detected"],
                    },
                    {
                        id: "save-settings",
                        description: "Persist updated graph settings for the active vault.",
                        updates: ["settings", "loadedVaultPath", "isLoading", "error"],
                        sideEffects: ["write graph settings to vault config"],
                    },
                    {
                        id: "reset-settings",
                        description: "Reset graph settings to defaults when vault context changes.",
                        updates: ["settings", "loadedVaultPath", "isLoading", "error"],
                    },
                ],
            },
            flow: {
                kind: "state-machine",
                description: "Knowledge graph settings move through idle, loading, ready, and error snapshots around normalization and persistence.",
                initialState: "idle",
                states: [
                    { id: "idle", description: "No vault-specific graph settings are loaded yet." },
                    { id: "loading", description: "Graph settings are being read, normalized, or saved." },
                    { id: "ready", description: "Graph settings snapshot is available for the active vault." },
                    { id: "error", description: "Last load/save request failed and error is retained." },
                ],
                transitions: [
                    {
                        event: "load-or-save-request",
                        from: ["idle", "ready", "error"],
                        to: "loading",
                        description: "A graph settings load or save request enters the async phase.",
                        sideEffects: ["invoke graph settings config APIs"],
                    },
                    {
                        event: "request-success",
                        from: ["loading"],
                        to: "ready",
                        description: "Successful load or save produces a normalized ready snapshot.",
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
                        description: "Vault switch or reset clears graph settings context.",
                    },
                ],
                failureModes: [
                    "invalid persisted graph settings are normalized before consumers see them",
                    "save failure preserves the current in-memory snapshot plus error",
                ],
            },
        },
        getSnapshot: () => getGraphSettingsStateSnapshot(),
        subscribe: (listener) => subscribeGraphSettingsState(listener),
        contributions: [{
            kind: "settings",
            activate: () => registerGraphSettingsSection(),
        }],
    });

    console.info("[knowledgeGraphPlugin] registered knowledge graph plugin");

    return () => {
        unregisterGraphSettingsStore();
        unregisterCommand();
        unregisterActivity();
        unregisterTabComponent();
        console.info("[knowledgeGraphPlugin] unregistered knowledge graph plugin");
    };
}

/**
 * @function syncKnowledgeGraphPluginRegistration
 * @description 根据 feature flag 同步知识图谱插件的注册状态。
 * @param enabled 当前是否启用知识图谱。
 */
function syncKnowledgeGraphPluginRegistration(
    enabled: boolean,
    currentDispose: (() => void) | null,
    setDispose: (dispose: (() => void) | null) => void,
): void {
    if (enabled) {
        if (!currentDispose) {
            setDispose(registerKnowledgeGraphPlugin());
        }
        return;
    }

    currentDispose?.();
    setDispose(null);
}

/**
 * @function activatePlugin
 * @description 注册知识图谱插件，并在 feature flag 切换时同步其注册状态。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    let disposeKnowledgeGraphRegistration: (() => void) | null = null;

    const setDispose = (dispose: (() => void) | null): void => {
        disposeKnowledgeGraphRegistration = dispose;
    };

    syncKnowledgeGraphPluginRegistration(
        getConfigSnapshot().featureSettings.knowledgeGraphEnabled,
        disposeKnowledgeGraphRegistration,
        setDispose,
    );

    const unsubscribeConfigChanges = subscribeConfigChanges((state) => {
        syncKnowledgeGraphPluginRegistration(
            state.featureSettings.knowledgeGraphEnabled,
            disposeKnowledgeGraphRegistration,
            setDispose,
        );
    });

    console.info("[knowledgeGraphPlugin] activated plugin runtime binding");

    return () => {
        unsubscribeConfigChanges();
        disposeKnowledgeGraphRegistration?.();
        disposeKnowledgeGraphRegistration = null;
        console.info("[knowledgeGraphPlugin] deactivated plugin runtime binding");
    };
}