/**
 * @module settings/registrars/languageSettingsRegistrar
 * @description 语言设置注册：提供界面语言切换功能。
 *
 * @dependencies
 *  - react
 *  - react-i18next
 *  - ../../i18n （i18n 配置及语言工具）
 *  - ../../host/settings/settingsRegistry
 *
 * @exports
 *  - registerLanguageSettingsSection: 注册语言设置选栏
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
    changeLanguage,
    getCurrentLanguage,
    SUPPORTED_LANGUAGES,
    type SupportedLanguage,
} from "../../i18n";
import { registerSettingsSection } from "../../host/settings/settingsRegistry";

/**
 * @function LanguageSettingsSection
 * @description 语言设置选栏内容，允许用户切换界面语言。
 * @returns React 节点。
 */
function LanguageSettingsSection(): ReactNode {
    const { t } = useTranslation();
    const currentLang = getCurrentLanguage();

    return (
        <div className="settings-item-group">
            {/* --- 界面语言 --- */}
            {/* styles: .settings-compact-row-column 紧凑纵向行，内含语言选择按钮 */}
            <div className="settings-compact-row-column">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.languageTitle")}</span>
                    <span className="settings-compact-desc">{t("settings.languageDesc")}</span>
                </div>

                <div className="settings-theme-mode-row">
                    {SUPPORTED_LANGUAGES.map((lang) => {
                        const isActive = currentLang === lang.code;

                        return (
                            <button
                                key={lang.code}
                                type="button"
                                className={`settings-theme-mode-button ${isActive ? "active" : ""}`}
                                onClick={() => {
                                    void changeLanguage(lang.code as SupportedLanguage);
                                }}
                            >
                                <span className="settings-theme-mode-button-title">{lang.nativeLabel}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/**
 * @function registerLanguageSettingsSection
 * @description 注册语言设置选栏。
 */
export function registerLanguageSettingsSection(): void {
    registerSettingsSection({
        id: "language-i18n",
        title: "settings.languageSection",
        order: 15,
        render: () => <LanguageSettingsSection />,
    });
}
