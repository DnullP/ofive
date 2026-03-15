/**
 * @module host/registry/registerBuiltinComponents
 * @description 内置组件注册入口：将应用自带的活动图标、侧边栏面板、Tab 组件
 *   注册到全局注册中心。与 settings/registerBuiltinSettings 类似，
 *   确保在应用启动时只执行一次。
 *
 *   注册的内置组件包括：
 *   - 活动图标：search
 *   - 侧边栏面板：search
 *   - Tab 组件：home, settings
 *
 * @dependencies
 *   - ./panelRegistry
 *   - ./tabComponentRegistry
 *   - ./activityRegistry
 *   - react (i18n via useTranslation 的 t 函数通过参数传入)
 *   - lucide-react (图标)
 *   - 各布局组件
 *
 * @exports
 *   - ensureBuiltinComponentsRegistered   确保内置组件注册（幂等）
 *   - registerBuiltinActivities           注册内置活动图标（需要 i18n t 函数）
 *   - registerBuiltinPanels               注册内置侧边栏面板
 *   - registerBuiltinTabComponents        注册内置 Tab 组件
 */

import React, { type ReactNode } from "react";
import { registerActivity } from "./activityRegistry";
import { registerPanel } from "./panelRegistry";
import { registerTabComponent } from "./tabComponentRegistry";
import i18n from "../../i18n";

/* ────────────────── 延迟导入的组件引用 ────────────────── */

/**
 * @interface BuiltinComponentRefs
 * @description 内置组件的引用集合，由外层传入以避免循环依赖。
 * @field HomeTab           - 首页 Tab 组件
 * @field SettingsTab       - 设置 Tab 组件
 * @field icons             - 图标组件集合
 */
export interface BuiltinComponentRefs {
    /** 首页 Tab */
    HomeTab: () => ReactNode;
    /** 设置 Tab */
    SettingsTab: React.ComponentType<any>;
    /** 图标集合 */
    icons: {
        search: ReactNode;
    };
}

/** 模块级标记：是否已注册 */
let registered = false;
/** 保存清理函数列表，注销时使用 */
const cleanupFns: (() => void)[] = [];

/**
 * 辅助函数：获取翻译文本。
 */
function t(key: string): string {
    return i18n.t(key);
}

/**
 * @function registerBuiltinActivities
 * @description 注册所有内置活动图标。
 * @param refs 内置组件引用（需要图标）。
 * @returns 清理函数数组。
 */
function registerBuiltinActivities(refs: BuiltinComponentRefs): (() => void)[] {
    const fns: (() => void)[] = [];

    /* 搜索 - 面板容器型（可通过 featureFlag 后续控制） */
    fns.push(registerActivity({
        type: "panel-container",
        id: "search",
        title: () => t("app.searchPanel"),
        icon: refs.icons.search,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 2,
    }));

    return fns;
}

/**
 * @function registerBuiltinPanels
 * @description 注册所有内置侧边栏面板。
 * @returns 清理函数数组。
 */
function registerBuiltinPanels(): (() => void)[] {
    const fns: (() => void)[] = [];

    /* 搜索面板（占位） */
    fns.push(registerPanel({
        id: "search",
        title: () => t("app.searchPanel"),
        activityId: "search",
        defaultPosition: "left",
        defaultOrder: 2,
        render: () =>
            React.createElement("div", { className: "panel-placeholder" },
                React.createElement("h3", null, t("app.searchPanelTitle")),
                React.createElement("p", null, t("app.searchPanelHint")),
            ),
    }));

    return fns;
}

/**
 * @function registerBuiltinTabComponents
 * @description 注册所有内置 Tab 组件类型。
 * @param refs 内置组件引用。
 * @returns 清理函数数组。
 */
function registerBuiltinTabComponents(refs: BuiltinComponentRefs): (() => void)[] {
    const fns: (() => void)[] = [];

    fns.push(registerTabComponent({
        id: "home",
        component: refs.HomeTab as any,
    }));

    fns.push(registerTabComponent({
        id: "settings",
        component: refs.SettingsTab as any,
    }));

    return fns;
}

/**
 * @function ensureBuiltinComponentsRegistered
 * @description 确保内置组件只注册一次。幂等操作。
 * @param refs 内置组件引用集合。
 */
export function ensureBuiltinComponentsRegistered(refs: BuiltinComponentRefs): void {
    if (registered) {
        return;
    }

    cleanupFns.push(...registerBuiltinActivities(refs));
    cleanupFns.push(...registerBuiltinPanels());
    cleanupFns.push(...registerBuiltinTabComponents(refs));

    registered = true;
    console.info("[registerBuiltinComponents] all builtin components registered");
}

/**
 * @function unregisterAllBuiltinComponents
 * @description 注销所有内置组件（通常用于测试清理）。
 */
export function unregisterAllBuiltinComponents(): void {
    cleanupFns.forEach((fn) => fn());
    cleanupFns.length = 0;
    registered = false;
    console.info("[registerBuiltinComponents] all builtin components unregistered");
}
