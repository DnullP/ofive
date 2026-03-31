/**
 * @module host/settings/registrars/autoSaveSettingsRegistrar
 * @description 自动保存设置注册：注册“保存”分类及其标准化设置项。
 * @dependencies
 *  - ../../config/configStore
 *  - ../settingsRegistry
 */

import { updateFeatureSetting, useConfigState } from "../../config/configStore";
import { registerSettingsItems, registerSettingsSection } from "../settingsRegistry";

/**
 * @function clampNumber
 * @description 将数值限制在 [min, max] 范围内。
 * @param raw 原始输入。
 * @param min 最小值。
 * @param max 最大值。
 * @param fallback 解析失败时的回退值。
 * @returns 限定范围后的数值。
 */
function clampNumber(raw: string, min: number, max: number, fallback: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, Math.min(max, Math.round(parsed)));
}

/**
 * @function registerAutoSaveSettingsSection
 * @description 注册自动保存设置选栏。
 * @returns 取消注册函数。
 */
export function registerAutoSaveSettingsSection(): () => void {
    const unregisterSection = registerSettingsSection({
        id: "editor-auto-save",
        title: "settings.saveSection",
        order: 25,
        description: "settings.saveSectionDesc",
        searchTerms: ["save", "auto save", "delay", "保存", "自动保存", "延迟"],
    });

    const unregisterItems = registerSettingsItems([
        {
            id: "auto-save-enabled",
            sectionId: "editor-auto-save",
            order: 10,
            kind: "toggle",
            title: "settings.autoSave",
            description: "settings.autoSaveDesc",
            searchTerms: ["save", "auto save", "自动保存"],
            useValue: () => useConfigState().featureSettings.autoSaveEnabled,
            updateValue: (nextValue) => updateFeatureSetting("autoSaveEnabled", nextValue),
        },
        {
            id: "auto-save-delay-ms",
            sectionId: "editor-auto-save",
            order: 20,
            kind: "number",
            title: "settings.autoSaveDelay",
            description: "settings.autoSaveDelayDesc",
            searchTerms: ["save delay", "debounce", "延迟"],
            min: 500,
            max: 10000,
            step: 100,
            useValue: () => useConfigState().featureSettings.autoSaveDelayMs,
            useIsVisible: () => useConfigState().featureSettings.autoSaveEnabled,
            normalizeValue: (raw, currentValue) => clampNumber(raw, 500, 10000, currentValue),
            updateValue: (nextValue) => updateFeatureSetting("autoSaveDelayMs", nextValue),
        },
        {
            id: "config-error",
            sectionId: "editor-auto-save",
            order: 999,
            kind: "custom",
            title: "settings.saveSection",
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