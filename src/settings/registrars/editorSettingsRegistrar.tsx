/**
 * @module settings/registrars/editorSettingsRegistrar
 * @description 编辑器设置注册：Vim 模式、字体大小、Tab 宽度、自动换行、行号、自动保存等编辑体验选项。
 * @dependencies
 *  - react
 *  - ../../host/store/configStore
 *  - ../../host/settings/settingsRegistry
 */

import type { ChangeEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { updateFeatureSetting, updateVimModeEnabled, useConfigState, DEFAULT_EDITOR_FONT_FAMILY, FONT_FAMILY_PRESETS } from "../../host/store/configStore";
import { registerSettingsSection } from "../../host/settings/settingsRegistry";

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
 * @function EditorSettingsSection
 * @description 编辑器设置选栏内容，包含 Vim 模式、字体族、字体大小、Tab 宽度、自动换行、行号、自动保存等配置。
 * @returns React 节点。
 */
function EditorSettingsSection(): ReactNode {
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

    const onAutoSaveDelayChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const next = clampNumber(event.target.value, 500, 10000, featureSettings.autoSaveDelayMs);
        void updateFeatureSetting("autoSaveDelayMs", next);
    };

    /** 编辑器字体族变更处理：从预设下拉框选择 */
    const onFontFamilyChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        const next = event.target.value;
        void updateFeatureSetting("editorFontFamily", next.length > 0 ? next : DEFAULT_EDITOR_FONT_FAMILY);
    };

    return (
        <div className="settings-item-group">
            {/* --- Vim 编辑模式 --- */}
            {/* styles: .settings-compact-row 紧凑行布局 */}
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

            {/* --- 自动换行 --- */}
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

            {/* --- 行号模式 --- */}
            {/* styles: .settings-compact-row 紧凑行布局, .settings-compact-select 下拉选择框 */}
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

            {/* --- 编辑器字体 --- */}
            {/* styles: .settings-compact-row 紧凑行布局, .settings-compact-select 下拉选择框 */}
            <div className="settings-compact-row">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.fontFamily")}</span>
                    <span className="settings-compact-desc">{t("settings.fontFamilyDesc")}</span>
                </div>
                <select
                    className="settings-compact-select"
                    value={
                        FONT_FAMILY_PRESETS.some((p) => p.value === featureSettings.editorFontFamily)
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

            {/* --- 字体大小 --- */}
            {/* styles: .settings-compact-row 紧凑行布局 */}
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

            {/* --- Tab 缩进宽度 --- */}
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

            {/* --- 自动保存 --- */}
            {/* styles: .settings-compact-row 紧凑行布局 */}
            <label className="settings-compact-row" htmlFor="auto-save-switch">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">自动保存</span>
                    <span className="settings-compact-desc">编辑后自动保存文件，无需手动 Cmd+S</span>
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

            {/* --- 自动保存延迟 --- */}
            {/* styles: .settings-compact-row 紧凑行布局 */}
            {featureSettings.autoSaveEnabled ? (
                <div className="settings-compact-row">
                    <div className="settings-compact-info">
                        <span className="settings-compact-title">自动保存延迟</span>
                        <span className="settings-compact-desc">停止输入后多久自动保存（500–10000 ms）</span>
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
 * @function registerEditorSettingsSection
 * @description 注册编辑器设置选栏。
 */
export function registerEditorSettingsSection(): void {
    registerSettingsSection({
        id: "editor-vim",
        title: "settings.editorSection",
        order: 20,
        render: () => <EditorSettingsSection />,
    });
}
