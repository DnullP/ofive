/**
 * @module host/window/mainWindowFullscreenController.test
 * @description 主窗口全屏控制器测试：覆盖 macOS simple fullscreen 与连续 Escape 保护。
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    getMainWindowFullscreenIntent,
    handleMacFullscreenEscapeKeydown,
    resetMainWindowFullscreenControllerForTest,
    setMainWindowFullscreen,
    toggleMainWindowFullscreen,
    type MainWindowHandle,
} from "./mainWindowFullscreenController";
import type { WindowRuntimeInfo } from "./windowRuntimeInfo";

const MAC_TAURI: WindowRuntimeInfo = {
    isTauriRuntime: true,
    isWindows: false,
    isMacOS: true,
};

const WINDOWS_TAURI: WindowRuntimeInfo = {
    isTauriRuntime: true,
    isWindows: true,
    isMacOS: false,
};

function createWindowHandle(initialFullscreen = false): MainWindowHandle & {
    calls: string[];
    nativeFullscreen: boolean;
    simpleFullscreen: boolean;
} {
    const handle = {
        calls: [] as string[],
        nativeFullscreen: initialFullscreen,
        simpleFullscreen: false,
        async isFullscreen() {
            handle.calls.push("isFullscreen");
            return handle.nativeFullscreen;
        },
        async setFullscreen(fullscreen: boolean) {
            handle.calls.push(`setFullscreen:${fullscreen}`);
            handle.nativeFullscreen = fullscreen;
        },
        async setSimpleFullscreen(fullscreen: boolean) {
            handle.calls.push(`setSimpleFullscreen:${fullscreen}`);
            handle.simpleFullscreen = fullscreen;
        },
    };
    return handle;
}

function createEscapeEvent(): Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat" | "preventDefault"
> & { prevented: boolean } {
    return {
        key: "Escape",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
        prevented: false,
        preventDefault() {
            this.prevented = true;
        },
    };
}

afterEach(() => {
    resetMainWindowFullscreenControllerForTest();
});

describe("mainWindowFullscreenController", () => {
    it("macOS Tauri 进入全屏时优先使用 simple fullscreen", async () => {
        const windowHandle = createWindowHandle();

        const intent = await setMainWindowFullscreen(true, {
            runtimeInfo: MAC_TAURI,
            getCurrentWindow: () => windowHandle,
        });

        expect(intent).toBe("simple");
        expect(getMainWindowFullscreenIntent()).toBe("simple");
        expect(windowHandle.calls).toEqual(["setSimpleFullscreen:true"]);
    });

    it("非 macOS 进入全屏时使用 native fullscreen", async () => {
        const windowHandle = createWindowHandle();

        const intent = await setMainWindowFullscreen(true, {
            runtimeInfo: WINDOWS_TAURI,
            getCurrentWindow: () => windowHandle,
        });

        expect(intent).toBe("native");
        expect(windowHandle.calls).toEqual(["setFullscreen:true"]);
    });

    it("toggle 会基于已记录的 simple fullscreen 意图退出全屏", async () => {
        const windowHandle = createWindowHandle();
        await setMainWindowFullscreen(true, {
            runtimeInfo: MAC_TAURI,
            getCurrentWindow: () => windowHandle,
        });
        windowHandle.calls.length = 0;

        const intent = await toggleMainWindowFullscreen({
            runtimeInfo: MAC_TAURI,
            getCurrentWindow: () => windowHandle,
        });

        expect(intent).toBe("none");
        expect(windowHandle.calls).toEqual(["isFullscreen", "setSimpleFullscreen:false"]);
    });

    it("macOS 全屏下连续第二次 Escape 会阻止默认行为并重新应用全屏意图", async () => {
        const windowHandle = createWindowHandle();
        await setMainWindowFullscreen(true, {
            runtimeInfo: MAC_TAURI,
            getCurrentWindow: () => windowHandle,
        });
        windowHandle.calls.length = 0;

        const scheduledCallbacks: Array<() => void> = [];
        const firstEscape = createEscapeEvent();
        const firstHandled = handleMacFullscreenEscapeKeydown(firstEscape, {
            runtimeInfo: MAC_TAURI,
            now: () => 1_000,
            getCurrentWindow: () => windowHandle,
            setTimeout: (callback) => {
                scheduledCallbacks.push(callback);
            },
        });

        const secondEscape = createEscapeEvent();
        const secondHandled = handleMacFullscreenEscapeKeydown(secondEscape, {
            runtimeInfo: MAC_TAURI,
            now: () => 1_300,
            getCurrentWindow: () => windowHandle,
            setTimeout: (callback) => {
                scheduledCallbacks.push(callback);
            },
        });

        expect(firstHandled).toBe(false);
        expect(firstEscape.prevented).toBe(false);
        expect(secondHandled).toBe(true);
        expect(secondEscape.prevented).toBe(true);
        expect(scheduledCallbacks).toHaveLength(1);

        await scheduledCallbacks[0]?.();
        expect(windowHandle.calls).toEqual(["setSimpleFullscreen:true"]);
    });
});
