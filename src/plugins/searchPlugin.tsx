/**
 * @module plugins/searchPlugin
 * @description 搜索插件入口：负责根据配置状态注册/注销搜索 activity 与 panel。
 *   该插件将搜索功能的宿主协调逻辑从 App 与内置注册表中移出，降低中心文件冲突。
 *
 * @dependencies
 *   - ../host/store/configStore
 *   - ../host/registry/activityRegistry
 *   - ../host/registry/panelRegistry
 *   - ../i18n
 *   - lucide-react
 *
 * @example
 *   import { activatePlugin } from "./searchPlugin";
 *   const dispose = activatePlugin();
 *
 * @exports
 *   - SearchPluginConfigState
 *   - SearchPluginDependencies
 *   - activateSearchPluginRuntime
 *   - activatePlugin
 */

import { Search } from "lucide-react";
import i18n from "../i18n";
import {
    getConfigSnapshot,
    subscribeConfigChanges,
} from "../host/store/configStore";
import {
    registerActivity,
    unregisterActivity,
    type ActivityDescriptor,
} from "../host/registry/activityRegistry";
import {
    registerPanel,
    unregisterPanel,
    type PanelDescriptor,
} from "../host/registry/panelRegistry";

const SEARCH_SURFACE_ID = "search";

/**
 * @interface SearchPluginConfigState
 * @description 搜索插件依赖的最小配置状态契约。
 * @field featureSettings.searchEnabled 是否启用搜索面板。
 */
export interface SearchPluginConfigState {
    featureSettings: {
        searchEnabled: boolean;
    };
}

/**
 * @interface SearchPluginDependencies
 * @description 搜索插件运行所需依赖，便于测试时注入替身实现。
 * @field getConfigSnapshot 同步读取配置快照。
 * @field subscribeConfigChanges 订阅配置变化。
 * @field registerActivity 注册搜索 activity。
 * @field unregisterActivity 注销搜索 activity。
 * @field registerPanel 注册搜索 panel。
 * @field unregisterPanel 注销搜索 panel。
 */
export interface SearchPluginDependencies {
    getConfigSnapshot: () => SearchPluginConfigState;
    subscribeConfigChanges: (
        listener: (state: SearchPluginConfigState) => void,
    ) => () => void;
    registerActivity: (descriptor: ActivityDescriptor) => () => void;
    unregisterActivity: (id: string) => void;
    registerPanel: (descriptor: PanelDescriptor) => () => void;
    unregisterPanel: (id: string) => void;
}

const defaultDependencies: SearchPluginDependencies = {
    getConfigSnapshot,
    subscribeConfigChanges,
    registerActivity,
    unregisterActivity,
    registerPanel,
    unregisterPanel,
};

/**
 * @function buildSearchActivityDescriptor
 * @description 构造搜索 activity 的注册描述。
 * @returns 搜索 activity 描述对象。
 */
function buildSearchActivityDescriptor(): ActivityDescriptor {
    return {
        type: "panel-container",
        id: SEARCH_SURFACE_ID,
        title: () => i18n.t("app.searchPanel"),
        icon: <Search size={18} strokeWidth={1.8} />,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 2,
    };
}

/**
 * @function buildSearchPanelDescriptor
 * @description 构造搜索 panel 的注册描述。
 * @returns 搜索 panel 描述对象。
 */
function buildSearchPanelDescriptor(): PanelDescriptor {
    return {
        id: SEARCH_SURFACE_ID,
        title: () => i18n.t("app.searchPanel"),
        activityId: SEARCH_SURFACE_ID,
        defaultPosition: "left",
        defaultOrder: 2,
        render: () => (
            <div className="panel-placeholder">
                <h3>{i18n.t("app.searchPanelTitle")}</h3>
                <p>{i18n.t("app.searchPanelHint")}</p>
            </div>
        ),
    };
}

/**
 * @function registerSearchSurfaces
 * @description 注册搜索 activity 与 panel，并返回统一清理函数。
 * @param dependencies 搜索插件依赖。
 * @returns 清理函数。
 */
function registerSearchSurfaces(
    dependencies: SearchPluginDependencies,
): () => void {
    const disposeActivity = dependencies.registerActivity(
        buildSearchActivityDescriptor(),
    );
    const disposePanel = dependencies.registerPanel(buildSearchPanelDescriptor());

    console.info("[searchPlugin] registered search surfaces");

    return () => {
        disposePanel();
        disposeActivity();
        dependencies.unregisterPanel(SEARCH_SURFACE_ID);
        dependencies.unregisterActivity(SEARCH_SURFACE_ID);
        console.info("[searchPlugin] unregistered search surfaces");
    };
}

/**
 * @function activateSearchPluginRuntime
 * @description 激活搜索插件运行时，根据配置状态同步搜索 UI 面。
 * @param dependencies 可选依赖注入，用于测试或替换实现。
 * @returns 插件清理函数。
 */
export function activateSearchPluginRuntime(
    dependencies: SearchPluginDependencies = defaultDependencies,
): () => void {
    let disposeSearchSurfaces: (() => void) | null = null;

    const syncSearchVisibility = (state: SearchPluginConfigState): void => {
        if (state.featureSettings.searchEnabled) {
            if (!disposeSearchSurfaces) {
                disposeSearchSurfaces = registerSearchSurfaces(dependencies);
            }
            return;
        }

        if (disposeSearchSurfaces) {
            const cleanup = disposeSearchSurfaces;
            disposeSearchSurfaces = null;
            cleanup();
        }
    };

    syncSearchVisibility(dependencies.getConfigSnapshot());
    const unsubscribe = dependencies.subscribeConfigChanges(syncSearchVisibility);

    return () => {
        unsubscribe();
        if (disposeSearchSurfaces) {
            const cleanup = disposeSearchSurfaces;
            disposeSearchSurfaces = null;
            cleanup();
        }
    };
}

/**
 * @function activatePlugin
 * @description 搜索插件入口，供插件运行时自动发现并激活。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    return activateSearchPluginRuntime();
}