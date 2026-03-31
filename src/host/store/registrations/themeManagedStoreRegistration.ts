/**
 * @module host/store/registrations/themeManagedStoreRegistration
 * @description 主题 store 的治理注册：将 themeStore 作为 managed store 接入 host 层统一治理。
 */

import { registerThemeSettingsSection } from "../../settings/registrars/themeSettingsRegistrar";
import { getThemeStateSnapshot, subscribeThemeState } from "../../theme/themeStore";
import { registerManagedStore } from "../storeRegistry";

/**
 * @function registerThemeManagedStore
 * @description 注册主题 store 的元数据、快照接口与 settings 贡献。
 * @returns 取消注册函数。
 */
export function registerThemeManagedStore(): () => void {
    return registerManagedStore({
        id: "theme",
        title: "Theme Store",
        description: "Global theme mode and appearance settings.",
        ownerType: "host",
        scope: "frontend-local",
        tags: ["theme", "appearance", "settings"],
        schema: {
            summary: "Govern the globally active frontend theme mode persisted in local storage.",
            state: {
                fields: [{
                    name: "themeMode",
                    description: "The currently applied application theme mode.",
                    valueType: "union",
                    initialValue: "dark",
                    persisted: true,
                    allowedValues: ["dark", "light", "kraft"],
                }],
                invariants: [
                    "themeMode must always be one of dark, light, or kraft",
                    "local storage and in-memory themeMode converge after every update",
                ],
                actions: [
                    {
                        id: "update-theme-mode",
                        description: "Apply a supported theme mode and persist it to local storage.",
                        updates: ["themeMode"],
                        sideEffects: ["write theme mode to local storage", "notify subscribers"],
                    },
                    {
                        id: "hydrate-theme-mode",
                        description: "Load persisted theme mode during startup and normalize invalid values.",
                        updates: ["themeMode"],
                        sideEffects: ["read theme mode from local storage"],
                    },
                ],
            },
            flow: {
                kind: "value-space",
                description: "Theme store is a single-field value-space store with immediate local persistence.",
                stateSpace: ["themeMode in {dark, light, kraft}"],
                updateTriggers: ["application bootstrap", "user changes appearance settings"],
                failureModes: ["invalid persisted value falls back to dark before notifying subscribers"],
            },
        },
        getSnapshot: () => getThemeStateSnapshot(),
        subscribe: (listener) => subscribeThemeState(listener),
        contributions: [{
            kind: "settings",
            activate: () => registerThemeSettingsSection(),
        }],
    });
}