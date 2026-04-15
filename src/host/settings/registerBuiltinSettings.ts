/**
 * @module host/settings/registerBuiltinSettings
 * @description 内置设置注册入口：集中触发各系统设置选栏注册。
 * @dependencies
 *  - ./registrars/generalSettingsRegistrar
 *  - ./registrars/autoSaveSettingsRegistrar
 *  - ../store/registerBuiltinManagedStores
 */

import { ensureBuiltinManagedStoresRegistered } from "../store/registerBuiltinManagedStores";
import { enableManagedStoreSettings } from "../store/storeRegistry";
import { registerAutoSaveSettingsSection } from "./registrars/autoSaveSettingsRegistrar.tsx";
import { registerFrontmatterSettingsSection } from "./registrars/frontmatterSettingsRegistrar.tsx";
import { registerGeneralSettingsSection } from "./registrars/generalSettingsRegistrar.tsx";
import { registerLanguageSettingsSection } from "./registrars/languageSettingsRegistrar.tsx";

let registered = false;

/**
 * @function ensureBuiltinSettingsRegistered
 * @description 确保内置设置只注册一次。
 */
export function ensureBuiltinSettingsRegistered(): void {
    if (registered) {
        return;
    }

    ensureBuiltinManagedStoresRegistered();
    registerGeneralSettingsSection();
    registerFrontmatterSettingsSection();
    registerLanguageSettingsSection();
    registerAutoSaveSettingsSection();
    enableManagedStoreSettings();
    registered = true;
}

/**
 * @function __resetBuiltinSettingsRegistrationForTests
 * @description 仅供测试使用：重置内建 settings 注册幂等标记。
 */
export function __resetBuiltinSettingsRegistrationForTests(): void {
    registered = false;
}
