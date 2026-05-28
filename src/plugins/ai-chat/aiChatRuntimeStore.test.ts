/**
 * @module plugins/ai-chat/aiChatRuntimeStore.test
 * @description AI chat runtime store regression tests for component-independent session state.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    getAiChatRuntimeSnapshot,
    resetAiChatRuntimeSnapshot,
    subscribeAiChatRuntimeSnapshot,
    updateAiChatRuntimeSnapshot,
} from "./aiChatRuntimeStore";

describe("aiChatRuntimeStore", () => {
    afterEach(() => {
        resetAiChatRuntimeSnapshot();
    });

    it("persists runtime patches outside component lifecycle", () => {
        updateAiChatRuntimeSnapshot({
            vaultPath: "/vault-a",
            activeTab: "history",
            draft: "next prompt",
        });

        expect(getAiChatRuntimeSnapshot()).toMatchObject({
            vaultPath: "/vault-a",
            activeTab: "history",
            draft: "next prompt",
        });
    });

    it("notifies subscribers when runtime changes and resets", () => {
        const snapshots: string[] = [];
        const unsubscribe = subscribeAiChatRuntimeSnapshot(() => {
            snapshots.push(getAiChatRuntimeSnapshot().draft);
        });

        updateAiChatRuntimeSnapshot({ draft: "streaming prompt" });
        resetAiChatRuntimeSnapshot("/vault-b");
        unsubscribe();

        expect(snapshots).toEqual(["streaming prompt", ""]);
        expect(getAiChatRuntimeSnapshot()).toMatchObject({
            vaultPath: "/vault-b",
            draft: "",
            activeTab: "chat",
        });
    });
});
