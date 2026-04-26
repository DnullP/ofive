/**
 * @module host/layout/contextMenuCenter.test
 * @description 右键菜单中心测试：覆盖注册、未注册拦截与动作分发。
 */

import { afterEach, describe, expect, it, mock } from "bun:test";

let selectedNativeActionId: string | null = null;
let nativeMenuItemIds: string[] = [];

mock.module("./nativeContextMenu", () => ({
    showNativeContextMenu: async (items: Array<{ id: string }>) => {
        nativeMenuItemIds = items.map((item) => item.id);
        return selectedNativeActionId;
    },
}));

const {
    clearContextMenuProvidersForTest,
    getRegisteredContextMenuProviderIds,
    registerContextMenuProvider,
    showRegisteredContextMenu,
} = await import("./contextMenuCenter");

function createTrigger(): {
    clientX: number;
    clientY: number;
    preventDefault: () => void;
    stopPropagation: () => void;
    prevented: boolean;
    stopped: boolean;
} {
    return {
        clientX: 10,
        clientY: 20,
        prevented: false,
        stopped: false,
        preventDefault() {
            this.prevented = true;
        },
        stopPropagation() {
            this.stopped = true;
        },
    };
}

afterEach(() => {
    selectedNativeActionId = null;
    nativeMenuItemIds = [];
    clearContextMenuProvidersForTest();
    mock.restore();
});

describe("contextMenuCenter", () => {
    it("未注册 provider 时会消费事件但不弹菜单", async () => {
        const trigger = createTrigger();

        const selectedId = await showRegisteredContextMenu("missing", trigger, {});

        expect(selectedId).toBeNull();
        expect(trigger.prevented).toBe(true);
        expect(trigger.stopped).toBe(true);
        expect(nativeMenuItemIds).toEqual([]);
    });

    it("已注册 provider 会构建菜单并分发动作", async () => {
        selectedNativeActionId = "rename";
        const handled: string[] = [];
        registerContextMenuProvider<{ path: string }>({
            id: "file-tree.item",
            buildMenu: (payload) => [
                { id: "rename", text: `Rename ${payload.path}` },
            ],
            handleAction: (actionId, payload) => {
                handled.push(`${actionId}:${payload.path}`);
            },
        });

        const selectedId = await showRegisteredContextMenu("file-tree.item", createTrigger(), {
            path: "notes/a.md",
        });

        expect(selectedId).toBe("rename");
        expect(nativeMenuItemIds).toEqual(["rename"]);
        expect(handled).toEqual(["rename:notes/a.md"]);
    });

    it("取消注册时只移除对应 provider", () => {
        const unregister = registerContextMenuProvider({
            id: "calendar.day",
            buildMenu: () => [],
        });

        expect(getRegisteredContextMenuProviderIds()).toEqual(["calendar.day"]);
        unregister();
        expect(getRegisteredContextMenuProviderIds()).toEqual([]);
    });
});
