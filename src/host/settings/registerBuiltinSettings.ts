/**
 * @module host/settings/registerBuiltinSettings
 * @description 内置设置注册入口：集中触发各系统设置选栏注册。
 * @dependencies
 *  - ../../settings/registrars/generalSettingsRegistrar
 *  - ../../settings/registrars/editorSettingsRegistrar
 *  - ../../settings/registrars/shortcutSettingsRegistrar
 *  - ../../settings/registrars/themeSettingsRegistrar
 */

import { registerEditorSettingsSection } from "../../settings/registrars/editorSettingsRegistrar.tsx";
import { registerGeneralSettingsSection } from "../../settings/registrars/generalSettingsRegistrar.tsx";
import { registerLanguageSettingsSection } from "../../settings/registrars/languageSettingsRegistrar.tsx";
import { registerShortcutSettingsSection } from "../../settings/registrars/shortcutSettingsRegistrar.tsx";
import { registerThemeSettingsSection } from "../../settings/registrars/themeSettingsRegistrar.tsx";

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
    registerEditorSettingsSection();
    registerShortcutSettingsSection();
    registered = true;
}
