/**
 * @module settings/registerBuiltinSettings
 * @description 内置设置注册入口：集中触发各系统设置选栏注册。
 * @dependencies
 *  - ./registrars/generalSettingsRegistrar
 *  - ./registrars/editorSettingsRegistrar
 *  - ./registrars/shortcutSettingsRegistrar
 *  - ./registrars/graphSettingsRegistrar
 *  - ./registrars/themeSettingsRegistrar
 */

import { registerEditorSettingsSection } from "./registrars/editorSettingsRegistrar.tsx";
import { registerGeneralSettingsSection } from "./registrars/generalSettingsRegistrar.tsx";
import { registerGraphSettingsSection } from "./registrars/graphSettingsRegistrar.tsx";
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
    registerThemeSettingsSection();
    registerEditorSettingsSection();
    registerShortcutSettingsSection();
    registerGraphSettingsSection();
    registered = true;
}
