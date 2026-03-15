/**
 * @module host/settings/registrars/themeSettingsRegistrar
 * @description 风格设置注册：提供全局主题切换。
 * @dependencies
 *  - react
 *  - ../../store/themeStore
 *  - ../settingsRegistry
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { updateThemeMode, useThemeState, type ThemeMode } from "../../store/themeStore";
import { registerSettingsSection } from "../settingsRegistry";

const THEME_MODE_OPTIONS: Array<{ value: ThemeMode; labelKey: string; descKey: string }> = [
    {
        value: "dark",
        labelKey: "settings.themeDark",
        descKey: "settings.themeDarkDesc",
    },
    {
        value: "light",
        labelKey: "settings.themeLight",
        descKey: "settings.themeLightDesc",
    },
    {
        value: "kraft",
        labelKey: "settings.themeKraft",
        descKey: "settings.themeKraftDesc",
    },
];

function ThemeSettingsSection(): ReactNode {
    const { t } = useTranslation();
    const themeState = useThemeState();

    return (
        <div className="settings-item-group">
            <div className="settings-compact-row-column">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.themeTitle")}</span>
                    <span className="settings-compact-desc">{t("settings.themeDesc")}</span>
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
                                <span className="settings-theme-mode-button-title">{t(option.labelKey)}</span>
                                <span className="settings-theme-mode-button-desc">{t(option.descKey)}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export function registerThemeSettingsSection(): void {
    registerSettingsSection({
        id: "theme-style",
        title: "settings.themeSection",
        order: 20,
        render: () => <ThemeSettingsSection />,
    });
}