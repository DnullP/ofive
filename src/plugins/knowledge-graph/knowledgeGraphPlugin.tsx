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
 *   插件无需手工导入；应用启动时自动完成注册。
 *
 * @exports 无导出（纯副作用模块）
 */

import React from "react";
import { Orbit } from "lucide-react";
import { KnowledgeGraphTab } from "./tab/KnowledgeGraphTab";
import { registerCommand } from "../../host/commands/commandSystem";
import i18n from "../../i18n";
import { registerActivity } from "../../host/registry/activityRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";
import { getConfigSnapshot, subscribeConfigChanges } from "../../host/store/configStore";
import { registerGraphSettingsSection } from "./settings/graphSettingsRegistrar";

const KNOWLEDGE_GRAPH_TAB_COMPONENT_ID = "knowledgegraph";
const KNOWLEDGE_GRAPH_ACTIVITY_ID = "knowledge-graph";
const KNOWLEDGE_GRAPH_COMMAND_ID = "knowledgeGraph.open";

i18n.addResourceBundle("en", "translation", {
    knowledgeGraphPlugin: {
        openCommand: "Open Knowledge Graph",
    },
}, true, true);

i18n.addResourceBundle("zh", "translation", {
    knowledgeGraphPlugin: {
        openCommand: "打开知识图谱",
    },
}, true, true);

/**
 * @function t
 * @description 图谱插件翻译辅助函数。
 * @param key i18n 键。
 * @returns 翻译结果。
 */
function t(key: string): string {
    return i18n.t(key);
}

let disposeKnowledgeGraphRegistration: (() => void) | null = null;

/**
 * @function registerKnowledgeGraphPlugin
 * @description 注册知识图谱插件的全部前端扩展点。
 * @returns 取消注册函数。
 */
function registerKnowledgeGraphPlugin(): () => void {
    const unregisterTabComponent = registerTabComponent({
        id: KNOWLEDGE_GRAPH_TAB_COMPONENT_ID,
        component: KnowledgeGraphTab,
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

    const unregisterGraphSettings = registerGraphSettingsSection();

    console.info("[knowledgeGraphPlugin] registered knowledge graph plugin");

    return () => {
        unregisterGraphSettings();
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
function syncKnowledgeGraphPluginRegistration(enabled: boolean): void {
    if (enabled) {
        if (!disposeKnowledgeGraphRegistration) {
            disposeKnowledgeGraphRegistration = registerKnowledgeGraphPlugin();
        }
        return;
    }

    disposeKnowledgeGraphRegistration?.();
    disposeKnowledgeGraphRegistration = null;
}

syncKnowledgeGraphPluginRegistration(
    getConfigSnapshot().featureSettings.knowledgeGraphEnabled,
);

subscribeConfigChanges((state) => {
    syncKnowledgeGraphPluginRegistration(state.featureSettings.knowledgeGraphEnabled);
});