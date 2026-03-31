/**
 * @module host/store/registerBuiltinManagedStores
 * @description 内置 managed store 注册入口：集中注册 host 内建 store 的治理元数据与 settings 贡献。
 */

import { registerConfigManagedStore } from "./registrations/configManagedStoreRegistration";
import { registerShortcutManagedStore } from "./registrations/shortcutManagedStoreRegistration";
import { registerThemeManagedStore } from "./registrations/themeManagedStoreRegistration";
import { registerVaultManagedStore } from "./registrations/vaultManagedStoreRegistration";

let registered = false;

/**
 * @function ensureBuiltinManagedStoresRegistered
 * @description 确保内置 managed store 仅注册一次。
 */
export function ensureBuiltinManagedStoresRegistered(): void {
    if (registered) {
        return;
    }

    registerConfigManagedStore();
    registerThemeManagedStore();
    registerShortcutManagedStore();
    registerVaultManagedStore();
    registered = true;
}

/**
 * @function __resetBuiltinManagedStoresRegistrationForTests
 * @description 仅供测试使用：重置内建 managed store 注册幂等标记。
 */
export function __resetBuiltinManagedStoresRegistrationForTests(): void {
    registered = false;
}