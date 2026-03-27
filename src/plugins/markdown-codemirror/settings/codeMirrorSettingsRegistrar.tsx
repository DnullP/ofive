/**
 * @module plugins/markdown-codemirror/settings/codeMirrorSettingsRegistrar
 * @description CodeMirror 设置注册：Vim 模式、字体大小、Tab 宽度、自动换行、行号与字体族。
 * @dependencies
 *  - react
 *  - ../../../host/store/configStore
 *  - ../../../host/settings/settingsRegistry
 */

import type { ChangeEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
    DEFAULT_EDITOR_FONT_FAMILY,
    FONT_FAMILY_PRESETS,
    updateFeatureSetting,
    updateVimModeEnabled,
    useConfigState,
} from "../../../host/store/configStore";
import { registerSettingsSection } from "../../../host/settings/settingsRegistry";

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
 * @function CodeMirrorSettingsSection
 * @description CodeMirror 编辑器设置选栏内容。
 * @returns React 节点。
 */
function CodeMirrorSettingsSection(): ReactNode {
    const { t } = useTranslation();
    const configState = useConfigState();
    const { featureSettings } = configState;

    const onFontSizeChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const next = clampNumber(event.target.value, 10, 32, featureSettings.editorFontSize);
        void updateFeatureSetting("editorFontSize", next);
    };

    const onTabSizeChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const next = clampNumber(event.target.value, 1, 8, featureSettings.editorTabSize);
        void updateFeatureSetting("editorTabSize", next);
    };

    const onFontFamilyChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        const next = event.target.value;
        void updateFeatureSetting(
            "editorFontFamily",
            next.length > 0 ? next : DEFAULT_EDITOR_FONT_FAMILY,
        );
    };

    return (
        <div className="settings-item-group">
            <label className="settings-compact-row" htmlFor="vim-mode-switch">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.vimMode")}</span>
                    <span className="settings-compact-desc">{t("settings.vimModeDesc")}</span>
                </div>
                <input
                    id="vim-mode-switch"
                    type="checkbox"
                    checked={featureSettings.vimModeEnabled}
                    onChange={(event) => {
                        void updateVimModeEnabled(event.target.checked);
                    }}
                />
            </label>

            <label className="settings-compact-row" htmlFor="line-wrapping-switch">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.lineWrapping")}</span>
                    <span className="settings-compact-desc">{t("settings.lineWrappingDesc")}</span>
                </div>
                <input
                    id="line-wrapping-switch"
                    type="checkbox"
                    checked={featureSettings.editorLineWrapping}
                    onChange={(event) => {
                        void updateFeatureSetting("editorLineWrapping", event.target.checked);
                    }}
                />
            </label>

            <div className="settings-compact-row">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.lineNumbers")}</span>
                    <span className="settings-compact-desc">{t("settings.lineNumbersDesc")}</span>
                </div>
                <select
                    className="settings-compact-select"
                    value={featureSettings.editorLineNumbers}
                    onChange={(event) => {
                        void updateFeatureSetting(
                            "editorLineNumbers",
                            event.target.value as "off" | "absolute" | "relative",
                        );
                    }}
                >
                    <option value="off">{t("settings.lineNumbersOff")}</option>
                    <option value="absolute">{t("settings.lineNumbersAbsolute")}</option>
                    <option value="relative">{t("settings.lineNumbersRelative")}</option>
                </select>
            </div>

            <div className="settings-compact-row">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.fontFamily")}</span>
                    <span className="settings-compact-desc">{t("settings.fontFamilyDesc")}</span>
                </div>
                <select
                    className="settings-compact-select"
                    value={
                        FONT_FAMILY_PRESETS.some((preset) => preset.value === featureSettings.editorFontFamily)
                            ? featureSettings.editorFontFamily
                            : DEFAULT_EDITOR_FONT_FAMILY
                    }
                    onChange={onFontFamilyChange}
                >
                    {FONT_FAMILY_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                            {t(preset.label)}
                        </option>
                    ))}
                </select>
            </div>

            <div className="settings-compact-row">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.fontSize")}</span>
                    <span className="settings-compact-desc">{t("settings.fontSizeDesc")}</span>
                </div>
                <input
                    className="settings-compact-number-input"
                    type="number"
                    min={10}
                    max={32}
                    step={1}
                    value={featureSettings.editorFontSize}
                    onChange={onFontSizeChange}
                />
            </div>

            <div className="settings-compact-row">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.tabSize")}</span>
                    <span className="settings-compact-desc">{t("settings.tabSizeDesc")}</span>
                </div>
                <input
                    className="settings-compact-number-input"
                    type="number"
                    min={1}
                    max={8}
                    step={1}
                    value={featureSettings.editorTabSize}
                    onChange={onTabSizeChange}
                />
            </div>

            {configState.error ? <div className="settings-tab-error">{configState.error}</div> : null}
        </div>
    );
}

/**
 * @function registerCodeMirrorSettingsSection
 * @description 注册 CodeMirror 设置选栏。
 * @returns 取消注册函数。
 */
export function registerCodeMirrorSettingsSection(): () => void {
    return registerSettingsSection({
        id: "codemirror-editor",
        title: "settings.editorSection",
        order: 20,
        description: "settings.editorSectionDesc",
        searchTerms: ["editor", "vim", "font", "line numbers", "wrap", "tab", "编辑器", "vim", "字体", "行号", "换行", "缩进"],
        render: () => <CodeMirrorSettingsSection />,
    });
}