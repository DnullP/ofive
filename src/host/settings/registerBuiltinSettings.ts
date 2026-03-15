/**
 * @module host/settings/registerBuiltinSettings
 * @description 内置设置注册入口：集中触发各系统设置选栏注册。
 * @dependencies
 *  - ./registrars/generalSettingsRegistrar
 *  - ./registrars/autoSaveSettingsRegistrar
 *  - ./registrars/shortcutSettingsRegistrar
 *  - ./registrars/themeSettingsRegistrar
 */

import { registerAutoSaveSettingsSection } from "./registrars/autoSaveSettingsRegistrar.tsx";
import { registerGeneralSettingsSection } from "./registrars/generalSettingsRegistrar.tsx";
import { registerLanguageSettingsSection } from "./registrars/languageSettingsRegistrar.tsx";
import { registerShortcutSettingsSection } from "./registrars/shortcutSettingsRegistrar.tsx";
import { registerThemeSettingsSection } from "./registrars/themeSettingsRegistrar.tsx";

let registered = false;

/**
 * @function ensureBuiltinSettingsRegistered
 * @description 确保内置设置只注册一次。
 */
export function ensureBuiltinSettingsRegistered(): void {
    if (registered) {
        return;
    }

    registerGeneralSettingsSection();
    registerLanguageSettingsSection();
    registerThemeSettingsSection();
    registerAutoSaveSettingsSection();
    registerShortcutSettingsSection();
    registered = true;
}
