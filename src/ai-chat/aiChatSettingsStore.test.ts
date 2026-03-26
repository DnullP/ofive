/**
 * @module ai-chat/aiChatSettingsStore.test
 * @description AI 聊天设置 store 单元测试：覆盖按 vault 缓存加载、保存广播与重置行为。
 * @dependencies
 *   - bun:test
 *   - ./aiChatSettingsStore
 */

import { describe, expect, it } from "bun:test";
import type { AiChatSettings } from "../api/aiApi";
import { createAiChatSettingsStore } from "./aiChatSettingsStore";

function createSettings(model: string): AiChatSettings {
    return {
        vendorId: "vendor-a",
        model,
        fieldValues: {
            token: "secret",
        },
    };
}

describe("aiChatSettingsStore", () => {
    it("应按 vault 路径缓存已加载设置", async () => {
        let loadCount = 0;
        const store = createAiChatSettingsStore({
            getAiChatSettings: async () => {
                loadCount += 1;
                return createSettings(`model-${loadCount}`);
            },
            saveAiChatSettings: async (settings) => settings,
        });

        const first = await store.ensureLoaded("/vault-a");
        const second = await store.ensureLoaded("/vault-a");

        expect(first.model).toBe("model-1");
        expect(second.model).toBe("model-1");
        expect(loadCount).toBe(1);
    });

    it("应在保存后广播最新设置", async () => {
        let listenerCount = 0;
        const store = createAiChatSettingsStore({
            getAiChatSettings: async () => createSettings("model-1"),
            saveAiChatSettings: async (settings) => ({
                ...settings,
                model: `${settings.model}-saved`,
            }),
        });
        const unsubscribe = store.subscribe(() => {
            listenerCount += 1;
        });

        await store.ensureLoaded("/vault-a");
        const saved = await store.save("/vault-a", createSettings("model-2"));

        expect(saved.model).toBe("model-2-saved");
        expect(store.getSnapshot().settings?.model).toBe("model-2-saved");
        expect(listenerCount).toBeGreaterThanOrEqual(3);

        unsubscribe();
    });

    it("应在 reset 后清空当前快照", async () => {
        const store = createAiChatSettingsStore({
            getAiChatSettings: async () => createSettings("model-1"),
            saveAiChatSettings: async (settings) => settings,
        });

        await store.ensureLoaded("/vault-a");
        store.reset("/vault-a");

        expect(store.getSnapshot()).toEqual({
            vaultPath: "/vault-a",
            settings: null,
            isLoading: false,
            error: null,
        });
    });
});