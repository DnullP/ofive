/**
 * @module settings/registrars/themeSettingsRegistrar
 * @description 风格设置注册：提供日间/夜间主题切换。
 * @dependencies
 *  - react
 *  - ../../store/themeStore
 *  - ../settingsRegistry
 */

import type { ReactNode } from "react";
import { updateThemeMode, useThemeState, type ThemeMode } from "../../store/themeStore";
import { registerSettingsSection } from "../settingsRegistry";

/**
 * @constant THEME_MODE_OPTIONS
 * @description 风格模式选项。
 */
const THEME_MODE_OPTIONS: Array<{ value: ThemeMode; label: string; description: string }> = [
    {
        value: "dark",
        label: "夜间",
        description: "适合弱光环境，降低屏幕眩光。",
    },
    {
        value: "light",
        label: "日间",
        description: "适合明亮环境，提升文本对比度。",
    },
];

/**
 * @function ThemeSettingsSection
 * @description 风格设置选栏内容。
 * @returns React 节点。
 */
function ThemeSettingsSection(): ReactNode {
    const themeState = useThemeState();

    return (
        <div className="settings-item-group">
            <div className="settings-item settings-item-column">
                <div>
                    <div className="settings-item-title">界面风格</div>
                    <div className="settings-item-desc">所有组件颜色通过中心化主题变量控制。</div>
                </div>

                <div className="settings-theme-mode-row">
                    {THEME_MODE_OPTIONS.map((option) => {
                        const isActive = themeState.themeMode === option.value;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                className={`settings-theme-mode-button ${isActive ? "active" : ""}`}
                                onClick={() => {
                                    updateThemeMode(option.value);
                                }}
                            >
                                <span className="settings-theme-mode-button-title">{option.label}</span>
                                <span className="settings-theme-mode-button-desc">{option.description}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/**
 * @function registerThemeSettingsSection
 * @description 注册风格设置选栏。
 */
export function registerThemeSettingsSection(): void {
    registerSettingsSection({
        id: "theme-style",
        title: "风格",
        order: 20,
        render: () => <ThemeSettingsSection />,
    });
}
