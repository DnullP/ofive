/**
 * @module host/pluginRuntime
 * @description 插件运行时：统一负责插件入口的激活、卸载与热更新重载。
 *
 *   设计目标：
 *   - 应用启动时按稳定顺序激活所有插件入口
 *   - Vite HMR 命中插件入口时，先执行旧实例 dispose，再激活新模块
 *   - 插件失败时与其他插件隔离，避免单个插件阻塞整个应用启动
 *
 *   插件入口约定：
 *   - 文件路径匹配 src/plugins 下以 Plugin 结尾的 ts/tsx 入口文件
 *   - 排除 editor/editPlugins 这类内部子插件注册器，避免误判为宿主插件入口
 *   - 入口模块导出 `activatePlugin()`
 *   - `activatePlugin()` 可返回 `void` 或清理函数；清理函数允许返回 Promise
 *
 * @dependencies
 *   - vite import.meta.glob / import.meta.hot
 *
 * @example
 *   const runtime = await startDiscoveredPlugins();
 *
 * @exports
 *   - PluginDisposeFn
 *   - PluginActivateFn
 *   - RuntimePluginModule
 *   - PluginModuleRecord
 *   - PluginRuntime
 *   - createPluginRuntime
 *   - startDiscoveredPlugins
 */

/** 插件清理函数。 */
export type PluginDisposeFn = () => void | Promise<void>;

/** 插件激活函数。 */
export type PluginActivateFn = () => void | PluginDisposeFn | Promise<void | PluginDisposeFn>;

/**
 * @interface RuntimePluginModule
 * @description 插件入口模块的最小契约。
 * @field activatePlugin 插件激活函数。
 */
export interface RuntimePluginModule {
    /** 插件激活函数。 */
    activatePlugin?: PluginActivateFn;
}

/** 插件模块记录表：key 为模块路径。 */
export type PluginModuleRecord = Record<string, RuntimePluginModule>;

/**
 * @interface PluginRuntime
 * @description 插件运行时实例。
 * @field start 激活当前已发现的全部插件。
 * @field reloadModules 用新模块替换并重载指定插件。
 * @field dispose 卸载当前全部已激活插件。
 */
export interface PluginRuntime {
    /** 激活当前已发现的全部插件。 */
    start: () => Promise<void>;
    /** 用新模块替换并重载指定插件。 */
    reloadModules: (updatedModules: PluginModuleRecord) => Promise<void>;
    /** 合并最新发现的插件模块，但不主动触发重载。 */
    registerModules: (nextModules: PluginModuleRecord) => void;
    /** 卸载当前全部已激活插件。 */
    dispose: () => Promise<void>;
}

/** pluginRuntime HMR 在模块替换间传递的状态。 */
interface PluginRuntimeHotData {
    /** 已启动的插件运行时实例。 */
    runtime?: PluginRuntime;
}

/**
 * @function toErrorMessage
 * @description 将未知错误规范化为日志可读文本。
 * @param error 任意异常值。
 * @returns 错误文本。
 */
function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @function invokeDispose
 * @description 安全执行插件清理函数。
 * @param dispose 插件清理函数。
 * @param modulePath 插件模块路径，用于日志。
 */
async function invokeDispose(dispose: PluginDisposeFn, modulePath: string): Promise<void> {
    try {
        await dispose();
        console.info("[pluginRuntime] disposed plugin", { modulePath });
    } catch (error) {
        console.error("[pluginRuntime] dispose plugin failed", {
            modulePath,
            error: toErrorMessage(error),
        });
    }
}

/**
 * @function activateModule
 * @description 激活单个插件模块并返回其清理函数。
 * @param modulePath 插件模块路径。
 * @param pluginModule 插件入口模块。
 * @returns 插件清理函数；若模块未导出 activatePlugin 则返回 null。
 */
async function activateModule(
    modulePath: string,
    pluginModule: RuntimePluginModule,
): Promise<PluginDisposeFn | null> {
    if (typeof pluginModule.activatePlugin !== "function") {
        console.debug("[pluginRuntime] skipped non-activatable plugin module", {
            modulePath,
        });
        return null;
    }

    try {
        const dispose = await pluginModule.activatePlugin();
        console.info("[pluginRuntime] activated plugin", { modulePath });
        return typeof dispose === "function" ? dispose : null;
    } catch (error) {
        console.error("[pluginRuntime] activate plugin failed", {
            modulePath,
            error: toErrorMessage(error),
        });
        return null;
    }
}

/**
 * @function createPluginRuntime
 * @description 创建插件运行时实例。
 * @param initialModules 启动时已发现的插件模块记录。
 * @returns 具备启动、热重载和清理能力的运行时对象。
 */
export function createPluginRuntime(initialModules: PluginModuleRecord): PluginRuntime {
    const modules = new Map<string, RuntimePluginModule>(Object.entries(initialModules));
    const activeDisposers = new Map<string, PluginDisposeFn>();
    const activatedModulePaths = new Set<string>();
    let queue: Promise<void> = Promise.resolve();

    const enqueue = (task: () => Promise<void>): Promise<void> => {
        const next = queue.then(task, task);
        queue = next.catch(() => undefined);
        return next;
    };

    const deactivateModule = async (modulePath: string): Promise<void> => {
        if (!activatedModulePaths.has(modulePath)) {
            return;
        }

        activatedModulePaths.delete(modulePath);
        const dispose = activeDisposers.get(modulePath);
        if (!dispose) {
            return;
        }

        activeDisposers.delete(modulePath);
        await invokeDispose(dispose, modulePath);
    };

    const activateKnownModule = async (modulePath: string): Promise<void> => {
        if (activatedModulePaths.has(modulePath)) {
            return;
        }

        const pluginModule = modules.get(modulePath);
        if (!pluginModule) {
            console.warn("[pluginRuntime] activate skipped: module missing", { modulePath });
            return;
        }

        const dispose = await activateModule(modulePath, pluginModule);
        activatedModulePaths.add(modulePath);
        if (dispose) {
            activeDisposers.set(modulePath, dispose);
        }
    };

    return {
        start: () => enqueue(async () => {
            for (const modulePath of Array.from(modules.keys()).sort()) {
                await activateKnownModule(modulePath);
            }
        }),

        reloadModules: (updatedModules) => enqueue(async () => {
            const updatedPaths = Object.keys(updatedModules).sort();

            for (const modulePath of updatedPaths) {
                modules.set(modulePath, updatedModules[modulePath]);
            }

            for (const modulePath of updatedPaths) {
                await deactivateModule(modulePath);
                await activateKnownModule(modulePath);
            }
        }),

        registerModules: (nextModules) => {
            Object.entries(nextModules).forEach(([modulePath, pluginModule]) => {
                modules.set(modulePath, pluginModule);
            });
        },

        dispose: () => enqueue(async () => {
            const activePaths = Array.from(activatedModulePaths).sort().reverse();
            for (const modulePath of activePaths) {
                await deactivateModule(modulePath);
            }
        }),
    };
}

/**
 * @function startDiscoveredPlugins
 * @description 启动通过约定路径自动发现的全部插件，并接入 Vite HMR。
 * @returns 已启动的插件运行时实例。
 */
export async function startDiscoveredPlugins(): Promise<PluginRuntime> {
    const discoveredModules = import.meta.glob<RuntimePluginModule>([
        "../plugins/**/*Plugin.{ts,tsx}",
        "!../plugins/**/editPlugins/*",
    ], {
        eager: true,
    });
    const hotData = import.meta.hot?.data as PluginRuntimeHotData | undefined;
    const runtime = hotData?.runtime ?? createPluginRuntime(discoveredModules);

    runtime.registerModules(discoveredModules);
    await runtime.start();

    if (import.meta.hot) {
        const pluginPaths = Object.keys(discoveredModules).sort();

        import.meta.hot.accept(pluginPaths, async (nextModules) => {
            const updatedModules: PluginModuleRecord = {};

            nextModules.forEach((pluginModule, index) => {
                if (!pluginModule) {
                    return;
                }
                updatedModules[pluginPaths[index]] = pluginModule as RuntimePluginModule;
            });

            if (Object.keys(updatedModules).length === 0) {
                return;
            }

            console.info("[pluginRuntime] hot reloading plugins", {
                modulePaths: Object.keys(updatedModules),
            });
            await runtime.reloadModules(updatedModules);
        });

        import.meta.hot.dispose((data) => {
            (data as PluginRuntimeHotData).runtime = runtime;
        });
    }

    return runtime;
}