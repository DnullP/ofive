/**
 * @module host/registry/registerBuiltinComponents
 * @description 内置组件注册入口：将应用自带的 Tab 组件注册到全局注册中心。
 *   与 settings/registerBuiltinSettings 类似，
 *   确保在应用启动时只执行一次。
 *
 *   注册的内置组件包括：
 *   - Tab 组件：home, settings
 *
 * @dependencies
 *   - ./tabComponentRegistry
 *   - react
 *   - 各布局组件
 *
 * @exports
 *   - ensureBuiltinComponentsRegistered   确保内置组件注册（幂等）
 *   - registerBuiltinTabComponents        注册内置 Tab 组件
 */

import type { ComponentType, ReactNode } from "react";
import { registerTabComponent } from "./tabComponentRegistry";

/* ────────────────── 延迟导入的组件引用 ────────────────── */

/**
 * @interface BuiltinComponentRefs
 * @description 内置组件的引用集合，由外层传入以避免循环依赖。
 * @field HomeTab           - 首页 Tab 组件
 * @field SettingsTab       - 设置 Tab 组件
 */
export interface BuiltinComponentRefs {
    /** 首页 Tab */
    HomeTab: () => ReactNode;
    /** 设置 Tab */
    SettingsTab: ComponentType<any>;
}

/** 模块级标记：是否已注册 */
let registered = false;
/** 保存清理函数列表，注销时使用 */
const cleanupFns: (() => void)[] = [];

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
