/**
 * @module host/settings/registrars/generalSettingsRegistrar
 * @description 全局设置注册：注册“通用”分类及其标准化设置项。
 * @dependencies
 *  - ../../config/configStore
 *  - ../settingsRegistry
 */

import {
    updateRememberLastVault,
    updateSearchEnabled,
    updateFeatureSetting,
    useConfigState,
} from "../../config/configStore";
import { registerSettingsItems, registerSettingsSection } from "../settingsRegistry";

export function registerGeneralSettingsSection(): () => void {
    const unregisterSection = registerSettingsSection({
        id: "general-global",
        title: "settings.generalSection",
        order: 10,
        description: "settings.generalSectionDesc",
        searchTerms: ["general", "vault", "search", "knowledge graph", "通用", "仓库", "搜索", "知识图谱"],
    });

    const unregisterItems = registerSettingsItems([
        {
            id: "remember-last-vault",
            sectionId: "general-global",
            order: 10,
            kind: "toggle",
            title: "settings.rememberLastVault",
            description: "settings.rememberLastVaultDesc",
            searchTerms: ["recent vault", "remember vault", "记住仓库"],
            useValue: () => useConfigState().frontendSettings.rememberLastVault,
            updateValue: (nextValue) => {
                updateRememberLastVault(nextValue);
            },
        },
        {
            id: "search-enabled",
            sectionId: "general-global",
            order: 20,
            kind: "toggle",
            title: "settings.enableSearch",
            description: "settings.enableSearchDesc",
            searchTerms: ["search", "全文搜索", "搜索"],
            useValue: () => useConfigState().featureSettings.searchEnabled,
            updateValue: (nextValue) => updateSearchEnabled(nextValue),
        },
        {
            id: "knowledge-graph-enabled",
            sectionId: "general-global",
            order: 30,
            kind: "toggle",
            title: "settings.enableKnowledgeGraph",
            description: "settings.enableKnowledgeGraphDesc",
            searchTerms: ["graph", "knowledge graph", "知识图谱"],
            useValue: () => useConfigState().featureSettings.knowledgeGraphEnabled,
            updateValue: (nextValue) => updateFeatureSetting("knowledgeGraphEnabled", nextValue),
        },
        {
            id: "notifications-enabled",
            sectionId: "general-global",
            order: 40,
            kind: "toggle",
            title: "settings.enableNotifications",
            description: "settings.enableNotificationsDesc",
            searchTerms: ["notification", "toast", "通知", "消息"],
            useValue: () => useConfigState().featureSettings.notificationsEnabled,
            updateValue: (nextValue) => updateFeatureSetting("notificationsEnabled", nextValue),
        },
        {
            id: "notifications-max-visible",
            sectionId: "general-global",
            order: 50,
            kind: "number",
            title: "settings.notificationsMaxVisible",
            description: "settings.notificationsMaxVisibleDesc",
            searchTerms: ["notification", "max", "通知", "数量"],
            useValue: () => useConfigState().featureSettings.notificationsMaxVisible,
            updateValue: (nextValue) => updateFeatureSetting("notificationsMaxVisible", nextValue),
            min: 1,
            max: 10,
            step: 1,
            suffix: "settings.notificationsMaxVisibleSuffix",
            useIsVisible: () => useConfigState().featureSettings.notificationsEnabled,
        },
        {
            id: "restore-workspace-layout",
            sectionId: "general-global",
            order: 60,
            kind: "toggle",
            title: "settings.restoreWorkspaceLayout",
            description: "settings.restoreWorkspaceLayoutDesc",
            searchTerms: ["restore", "workspace", "layout", "tab", "恢复", "工作区", "布局", "标签"],
            useValue: () => useConfigState().featureSettings.restoreWorkspaceLayout,
            updateValue: (nextValue) => updateFeatureSetting("restoreWorkspaceLayout", nextValue),
        },
        {
            id: "config-error",
            sectionId: "general-global",
            order: 999,
            kind: "custom",
            title: "settings.generalSection",
            render: () => {
                const configState = useConfigState();
                return configState.error ? <div className="settings-tab-error">{configState.error}</div> : null;
            },
        },
    ]);

    return () => {
        unregisterItems();
        unregisterSection();
    };
}