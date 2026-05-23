/**
 * @module host/lifecycle/appLifecycle
 * @description 应用前端生命周期编排：集中处理受控 reload 前的数据写回、React 卸载与插件清理。
 * @dependencies
 *  - react-dom/client
 *  - ../editor/autoSaveService
 *  - ../pluginRuntime
 *  - ../../api/windowApi
 */

import type { Root } from "react-dom/client";
import { flushAutoSave, stopAutoSaveServiceAsync } from "../editor/autoSaveService";
import type { PluginRuntime } from "../pluginRuntime";
import { reloadCurrentWindow } from "../../api/windowApi";

/**
 * @interface AppRuntimeHandle
 * @description 当前前端应用实例的生命周期句柄。
 */
export interface AppRuntimeHandle {
    /** React 根节点。 */
    root: Root;
    /** 插件运行时实例。 */
    pluginRuntime: PluginRuntime;
}

interface AppLifecycleHooks {
    flushAutoSave: () => Promise<void>;
    stopAutoSaveService: () => Promise<void>;
    reloadCurrentWindow: () => Promise<void>;
}

const defaultLifecycleHooks: AppLifecycleHooks = {
    flushAutoSave,
    stopAutoSaveService: stopAutoSaveServiceAsync,
    reloadCurrentWindow,
};

let runtimeHandle: AppRuntimeHandle | null = null;
let reloadInFlight: Promise<void> | null = null;
let lifecycleHooks: AppLifecycleHooks = defaultLifecycleHooks;

/**
 * @function registerAppRuntimeHandle
 * @description 注册当前应用实例句柄，供 reload/quit 等宿主级生命周期流程统一释放。
 */
export function registerAppRuntimeHandle(handle: AppRuntimeHandle): void {
    runtimeHandle = handle;
}

/**
 * @function cleanupFrontendRuntimeForReload
 * @description reload 前清理前端资源并等待待保存内容写回。
 */
async function cleanupFrontendRuntimeForReload(): Promise<void> {
    const handle = runtimeHandle;

    await lifecycleHooks.flushAutoSave();
    await lifecycleHooks.stopAutoSaveService();

    if (handle) {
        handle.root.unmount();
        await handle.pluginRuntime.dispose();
    }
}

/**
 * @function requestApplicationReload
 * @description 执行受控 reload：先写回/卸载前端资源，再请求宿主清理后端运行时并 reload 当前 WebView。
 */
export function requestApplicationReload(): Promise<void> {
    if (reloadInFlight) {
        return reloadInFlight;
    }

    reloadInFlight = (async () => {
        console.info("[app-lifecycle] reload requested");
        await cleanupFrontendRuntimeForReload();
        try {
            await lifecycleHooks.reloadCurrentWindow();
        } catch (error) {
            console.error("[app-lifecycle] host reload failed, falling back to browser reload", {
                message: error instanceof Error ? error.message : String(error),
            });
            window.location.reload();
        }
    })();

    return reloadInFlight.finally(() => {
        reloadInFlight = null;
    });
}

/**
 * @function __setAppLifecycleHooksForTests
 * @description 替换生命周期副作用，仅用于单测隔离。
 */
export function __setAppLifecycleHooksForTests(
    nextHooks: Partial<AppLifecycleHooks>,
): () => void {
    lifecycleHooks = {
        ...defaultLifecycleHooks,
        ...nextHooks,
    };

    return () => {
        lifecycleHooks = defaultLifecycleHooks;
    };
}
