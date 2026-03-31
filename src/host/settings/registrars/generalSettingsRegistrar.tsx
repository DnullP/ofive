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