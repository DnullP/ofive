/**
 * @module plugins/markdown-codemirror/settings/codeMirrorSettingsRegistrar
 * @description CodeMirror 设置注册：通过中心化 settings item registry 注册编辑器设置。
 * @dependencies
 *  - react
 *  - ../../../host/config/configStore
 *  - ../../../host/settings/settingsRegistry
 */

import type { ReactNode } from "react";
import {
    DEFAULT_EDITOR_FONT_FAMILY,
    FONT_FAMILY_PRESETS,
    updateFeatureSetting,
    updateVimModeEnabled,
    useConfigState,
} from "../../../host/config/configStore";
import { registerSettingsItems, registerSettingsSection } from "../../../host/settings/settingsRegistry";

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
 * @function CodeMirrorSettingsErrorItem
 * @description 渲染编辑器设置区块中的错误提示。
 * @returns React 节点。
 */
function CodeMirrorSettingsErrorItem(): ReactNode {
    const configState = useConfigState();
    return configState.error ? <div className="settings-tab-error">{configState.error}</div> : null;
}

/**
 * @function registerCodeMirrorSettingsSection
 * @description 注册 CodeMirror 设置选栏。
 * @returns 取消注册函数。
 */
export function registerCodeMirrorSettingsSection(): () => void {
    const unregisterSection = registerSettingsSection({
        id: "codemirror-editor",
        title: "settings.editorSection",
        order: 20,
        description: "settings.editorSectionDesc",
        searchTerms: ["editor", "vim", "font", "line numbers", "wrap", "tab", "编辑器", "vim", "字体", "行号", "换行", "缩进"],
    });

    const unregisterItems = registerSettingsItems([
        {
            id: "vim-mode",
            sectionId: "codemirror-editor",
            order: 10,
            kind: "toggle",
            title: "settings.vimMode",
            description: "settings.vimModeDesc",
            searchTerms: ["vim", "modal editing"],
            useValue: () => useConfigState().featureSettings.vimModeEnabled,
            updateValue: (nextValue) => updateVimModeEnabled(nextValue),
        },
        {
            id: "line-wrapping",
            sectionId: "codemirror-editor",
            order: 20,
            kind: "toggle",
            title: "settings.lineWrapping",
            description: "settings.lineWrappingDesc",
            searchTerms: ["wrap", "line wrapping", "自动换行"],
            useValue: () => useConfigState().featureSettings.editorLineWrapping,
            updateValue: (nextValue) => updateFeatureSetting("editorLineWrapping", nextValue),
        },
        {
            id: "tab-restore-mode",
            sectionId: "codemirror-editor",
            order: 25,
            kind: "select",
            title: "settings.tabRestoreMode",
            description: "settings.tabRestoreModeDesc",
            searchTerms: ["tab restore", "cursor", "viewport", "切换标签页", "光标", "视图位置"],
            useValue: () => useConfigState().featureSettings.editorTabRestoreMode,
            updateValue: (nextValue) => updateFeatureSetting(
                "editorTabRestoreMode",
                nextValue as "viewport" | "cursor",
            ),
            options: [
                { value: "viewport", label: "settings.tabRestoreModeViewport" },
                { value: "cursor", label: "settings.tabRestoreModeCursor" },
            ],
        },
        {
            id: "tab-out",
            sectionId: "codemirror-editor",
            order: 27,
            kind: "toggle",
            title: "settings.tabOut",
            description: "settings.tabOutDesc",
            searchTerms: ["tab out", "bracket", "括号", "跳出括号"],
            useValue: () => useConfigState().featureSettings.editorTabOutEnabled,
            updateValue: (nextValue) => updateFeatureSetting("editorTabOutEnabled", nextValue),
        },
        {
            id: "line-numbers",
            sectionId: "codemirror-editor",
            order: 30,
            kind: "select",
            title: "settings.lineNumbers",
            description: "settings.lineNumbersDesc",
            searchTerms: ["line numbers", "relative", "absolute", "行号"],
            useValue: () => useConfigState().featureSettings.editorLineNumbers,
            updateValue: (nextValue) => updateFeatureSetting(
                "editorLineNumbers",
                nextValue as "off" | "absolute" | "relative",
            ),
            options: [
                { value: "off", label: "settings.lineNumbersOff" },
                { value: "absolute", label: "settings.lineNumbersAbsolute" },
                { value: "relative", label: "settings.lineNumbersRelative" },
            ],
        },
        {
            id: "font-family",
            sectionId: "codemirror-editor",
            order: 40,
            kind: "select",
            title: "settings.fontFamily",
            description: "settings.fontFamilyDesc",
            searchTerms: ["font", "family", "字体"],
            useValue: () => {
                const featureSettings = useConfigState().featureSettings;
                return FONT_FAMILY_PRESETS.some((preset) => preset.value === featureSettings.editorFontFamily)
                    ? featureSettings.editorFontFamily
                    : DEFAULT_EDITOR_FONT_FAMILY;
            },
            updateValue: (nextValue) => updateFeatureSetting(
                "editorFontFamily",
                String(nextValue).length > 0 ? String(nextValue) : DEFAULT_EDITOR_FONT_FAMILY,
            ),
            options: FONT_FAMILY_PRESETS.map((preset) => ({
                value: preset.value,
                label: preset.label,
            })),
        },
        {
            id: "font-size",
            sectionId: "codemirror-editor",
            order: 50,
            kind: "number",
            title: "settings.fontSize",
            description: "settings.fontSizeDesc",
            searchTerms: ["font size", "字号", "字体大小"],
            min: 10,
            max: 32,
            step: 1,
            useValue: () => useConfigState().featureSettings.editorFontSize,
            normalizeValue: (raw, currentValue) => clampNumber(raw, 10, 32, currentValue),
            updateValue: (nextValue) => updateFeatureSetting("editorFontSize", nextValue),
        },
        {
            id: "tab-size",
            sectionId: "codemirror-editor",
            order: 60,
            kind: "number",
            title: "settings.tabSize",
            description: "settings.tabSizeDesc",
            searchTerms: ["tab size", "indent", "缩进", "tab"],
            min: 1,
            max: 8,
            step: 1,
            useValue: () => useConfigState().featureSettings.editorTabSize,
            normalizeValue: (raw, currentValue) => clampNumber(raw, 1, 8, currentValue),
            updateValue: (nextValue) => updateFeatureSetting("editorTabSize", nextValue),
        },
        {
            id: "config-error",
            sectionId: "codemirror-editor",
            order: 999,
            kind: "custom",
            title: "settings.editorSection",
            render: () => <CodeMirrorSettingsErrorItem />,
        },
    ]);

    return () => {
        unregisterItems();
        unregisterSection();
    };
}
