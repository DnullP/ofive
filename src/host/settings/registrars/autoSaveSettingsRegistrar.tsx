/**
 * @module host/settings/registrars/autoSaveSettingsRegistrar
 * @description 自动保存设置注册：提供自动保存开关与延迟配置。
 * @dependencies
 *  - react
 *  - ../../store/configStore
 *  - ../settingsRegistry
 */

import type { ChangeEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { updateFeatureSetting, useConfigState } from "../../store/configStore";
import { registerSettingsSection } from "../settingsRegistry";

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
 * @function AutoSaveSettingsSection
 * @description 自动保存设置选栏内容。
 * @returns React 节点。
 */
function AutoSaveSettingsSection(): ReactNode {
    const { t } = useTranslation();
    const configState = useConfigState();
    const { featureSettings } = configState;

    const onAutoSaveDelayChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const next = clampNumber(event.target.value, 500, 10000, featureSettings.autoSaveDelayMs);
        void updateFeatureSetting("autoSaveDelayMs", next);
    };

    return (
        <div className="settings-item-group">
            <label className="settings-compact-row" htmlFor="auto-save-switch">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.autoSave")}</span>
                    <span className="settings-compact-desc">{t("settings.autoSaveDesc")}</span>
                </div>
                <input
                    id="auto-save-switch"
                    type="checkbox"
                    checked={featureSettings.autoSaveEnabled}
                    onChange={(event) => {
                        void updateFeatureSetting("autoSaveEnabled", event.target.checked);
                    }}
                />
            </label>

            {featureSettings.autoSaveEnabled ? (
                <div className="settings-compact-row">
                    <div className="settings-compact-info">
                        <span className="settings-compact-title">{t("settings.autoSaveDelay")}</span>
                        <span className="settings-compact-desc">{t("settings.autoSaveDelayDesc")}</span>
                    </div>
                    <input
                        className="settings-compact-number-input"
                        type="number"
                        min={500}
                        max={10000}
                        step={100}
                        value={featureSettings.autoSaveDelayMs}
                        onChange={onAutoSaveDelayChange}
                    />
                </div>
            ) : null}

            {configState.error ? <div className="settings-tab-error">{configState.error}</div> : null}
        </div>
    );
}

/**
 * @function registerAutoSaveSettingsSection
 * @description 注册自动保存设置选栏。
 * @returns 取消注册函数。
 */
export function registerAutoSaveSettingsSection(): () => void {
    return registerSettingsSection({
        id: "editor-auto-save",
        title: "settings.saveSection",
        order: 25,
        description: "settings.saveSectionDesc",
        searchTerms: ["save", "auto save", "delay", "保存", "自动保存", "延迟"],
        render: () => <AutoSaveSettingsSection />,
    });
}