/**
 * @module host/settings/registrars/languageSettingsRegistrar
 * @description 语言设置注册：注册“语言”分类与界面语言设置项。
 * @dependencies
 *  - react-i18next
 *  - ../../../i18n
 *  - ../settingsRegistry
 */

import {
    changeLanguage,
    getCurrentLanguage,
    SUPPORTED_LANGUAGES,
    type SupportedLanguage,
} from "../../../i18n";
import { registerSettingsItem, registerSettingsSection } from "../settingsRegistry";

export function registerLanguageSettingsSection(): () => void {
    const unregisterSection = registerSettingsSection({
        id: "language-i18n",
        title: "settings.languageSection",
        order: 15,
        description: "settings.languageSectionDesc",
        searchTerms: ["language", "locale", "translation", "语言", "本地化", "翻译"],
    });

    const unregisterItem = registerSettingsItem({
        id: "interface-language",
        sectionId: "language-i18n",
        order: 10,
        kind: "select",
        title: "settings.languageTitle",
        description: "settings.languageDesc",
        searchTerms: ["language", "locale", "translation", "中文", "english"],
        presentation: "buttons",
        useValue: () => getCurrentLanguage(),
        updateValue: (nextValue) => changeLanguage(nextValue as SupportedLanguage),
        options: SUPPORTED_LANGUAGES.map((lang) => ({
            value: lang.code,
            label: lang.nativeLabel,
        })),
    });

    return () => {
        unregisterItem();
        unregisterSection();
    };
}