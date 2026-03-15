/**
 * @module plugins/pluginRuntime.test
 * @description 插件运行时单元测试：覆盖首次激活、热重载替换、整体清理与失败隔离。
 * @dependencies
 *   - bun:test
 *   - ./pluginRuntime
 *
 * @example
 *   bun test src/plugins/pluginRuntime.test.ts
 */

import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { createPluginRuntime, type PluginModuleRecord } from "./pluginRuntime";

describe("pluginRuntime", () => {
    const infoSpy = mock(() => undefined);
    const warnSpy = mock(() => undefined);
    const errorSpy = mock(() => undefined);
    const debugSpy = mock(() => undefined);

    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalDebug = console.debug;

    console.info = infoSpy;
    console.warn = warnSpy;
    console.error = errorSpy;
    console.debug = debugSpy;

    afterEach(() => {
        infoSpy.mockClear();
        warnSpy.mockClear();
        errorSpy.mockClear();
        debugSpy.mockClear();
    });

    afterAll(() => {
        console.info = originalInfo;
        console.warn = originalWarn;
        console.error = originalError;
        console.debug = originalDebug;
    });

    it("应按稳定顺序激活全部可激活插件", async () => {
        const calls: string[] = [];
        const runtime = createPluginRuntime({
            "./bPlugin.ts": {
                activatePlugin: () => {
                    calls.push("b:activate");
                    return () => {
                        calls.push("b:dispose");
                    };
                },
            },
            "./aPlugin.ts": {
                activatePlugin: () => {
                    calls.push("a:activate");
                    return () => {
                        calls.push("a:dispose");
                    };
                },
            },
        });

        await runtime.start();

        expect(calls).toEqual(["a:activate", "b:activate"]);
    });

    it("重复 start 不应重复激活已运行插件", async () => {
        const calls: string[] = [];
        const runtime = createPluginRuntime({
            "./demoPlugin.ts": {
                activatePlugin: () => {
                    calls.push("activate");
                    return () => {
                        calls.push("dispose");
                    };
                },
            },
        });

        await runtime.start();
        await runtime.start();

        expect(calls).toEqual(["activate"]);
    });

    it("热重载时应先清理旧实例，再激活新实例", async () => {
        const calls: string[] = [];
        const runtime = createPluginRuntime({
            "./demoPlugin.ts": {
                activatePlugin: () => {
                    calls.push("v1:activate");
                    return () => {
                        calls.push("v1:dispose");
                    };
                },
            },
        });

        await runtime.start();
        await runtime.reloadModules({
            "./demoPlugin.ts": {
                activatePlugin: () => {
                    calls.push("v2:activate");
                    return () => {
                        calls.push("v2:dispose");
                    };
                },
            },
        });

        expect(calls).toEqual(["v1:activate", "v1:dispose", "v2:activate"]);
    });

    it("dispose 应逆序清理全部已激活插件", async () => {
        const calls: string[] = [];
        const modules: PluginModuleRecord = {
            "./aPlugin.ts": {
                activatePlugin: () => () => {
                    calls.push("a:dispose");
                },
            },
            "./bPlugin.ts": {
                activatePlugin: () => () => {
                    calls.push("b:dispose");
                },
            },
        };
        const runtime = createPluginRuntime(modules);

        await runtime.start();
        await runtime.dispose();

        expect(calls).toEqual(["b:dispose", "a:dispose"]);
    });

    it("插件激活失败时不应阻断其他插件", async () => {
        const calls: string[] = [];
        const runtime = createPluginRuntime({
            "./brokenPlugin.ts": {
                activatePlugin: () => {
                    throw new Error("boom");
                },
            },
            "./healthyPlugin.ts": {
                activatePlugin: () => {
                    calls.push("healthy:activate");
                },
            },
        });

        await runtime.start();

        expect(calls).toEqual(["healthy:activate"]);
        expect(errorSpy).toHaveBeenCalled();
    });
});