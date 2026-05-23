/**
 * @module host/lifecycle/appLifecycle.test
 * @description 应用受控 reload 生命周期回归测试。
 * @dependencies
 *  - bun:test
 *  - ./appLifecycle
 *
 * @example
 *   bun test src/host/lifecycle/appLifecycle.test.ts
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Root } from "react-dom/client";
import type { PluginRuntime } from "../pluginRuntime";

const calls: string[] = [];

const {
    __setAppLifecycleHooksForTests,
    registerAppRuntimeHandle,
    requestApplicationReload,
} = await import("./appLifecycle");

let resetLifecycleHooks: (() => void) | null = null;

function createRuntimeHandle(): { root: Root; pluginRuntime: PluginRuntime } {
    return {
        root: {
            unmount: () => {
                calls.push("unmount");
            },
        } as unknown as Root,
        pluginRuntime: {
            start: async () => undefined,
            reloadModules: async () => undefined,
            registerModules: () => undefined,
            dispose: async () => {
                calls.push("dispose-plugins");
            },
        },
    };
}

describe("appLifecycle reload", () => {
    afterEach(() => {
        resetLifecycleHooks?.();
        resetLifecycleHooks = null;
    });

    beforeEach(() => {
        calls.length = 0;
        resetLifecycleHooks = __setAppLifecycleHooksForTests({
            flushAutoSave: async () => {
                calls.push("flush");
            },
            stopAutoSaveService: async () => {
                calls.push("stop-auto-save");
            },
            reloadCurrentWindow: async () => {
                calls.push("host-reload");
            },
        });
        registerAppRuntimeHandle(createRuntimeHandle());
    });

    it("should flush, stop services, unmount React, dispose plugins, then reload host", async () => {
        await requestApplicationReload();

        expect(calls).toEqual([
            "flush",
            "stop-auto-save",
            "unmount",
            "dispose-plugins",
            "host-reload",
        ]);
    });

    it("should coalesce concurrent reload requests", async () => {
        await Promise.all([
            requestApplicationReload(),
            requestApplicationReload(),
        ]);

        expect(calls).toEqual([
            "flush",
            "stop-auto-save",
            "unmount",
            "dispose-plugins",
            "host-reload",
        ]);
    });
});
