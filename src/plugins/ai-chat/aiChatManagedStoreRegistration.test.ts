/**
 * @module plugins/ai-chat/aiChatManagedStoreRegistration.test
 * @description AI chat managed store registration tests.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    __resetManagedStoreRegistryForTests,
    enableManagedStoreSettings,
    getManagedStoresSnapshot,
} from "../../host/store/storeRegistry";
import { registerAiChatRuntimeManagedStore } from "./aiChatRuntimeManagedStoreRegistration";
import { registerAiChatSettingsManagedStore } from "./aiChatSettingsManagedStoreRegistration";

afterEach(() => {
    __resetManagedStoreRegistryForTests();
});

describe("aiChat managed store registrations", () => {
    it("registers settings and runtime stores with lifecycle-scoped metadata", () => {
        const unregisterSettings = registerAiChatSettingsManagedStore({
            registerSettingsSection: () => undefined,
        });
        const unregisterRuntime = registerAiChatRuntimeManagedStore();

        expect(getManagedStoresSnapshot().map((store) => store.id)).toEqual([
            "ai-chat:runtime",
            "ai-chat:settings",
        ]);
        const runtimeStore = getManagedStoresSnapshot().find((store) => store.id === "ai-chat:runtime");
        expect(runtimeStore?.schema.flow.failureModes).toContain(
            "component remount must not unsubscribe the backend stream listener or lose pending stream bindings",
        );

        unregisterRuntime();
        unregisterSettings();
        expect(getManagedStoresSnapshot()).toEqual([]);
    });

    it("activates the settings contribution from the store owner", () => {
        let activateCount = 0;
        enableManagedStoreSettings();

        const unregister = registerAiChatSettingsManagedStore({
            registerSettingsSection: () => {
                activateCount += 1;
                return () => undefined;
            },
        });

        expect(activateCount).toBe(1);
        unregister();
    });
});
