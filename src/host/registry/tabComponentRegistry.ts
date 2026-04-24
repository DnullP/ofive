/**
 * @module host/registry/tabComponentRegistry
 * @description Tab 组件注册中心：管理主区域可用的 Tab 组件类型。
 *   每种 Tab 类型（如 codemirror、imageviewer、settings）注册一次，
 *   之后可通过 component key 打开任意数量的实例。
 *   支持动态注册/注销，可用于插件系统扩展 Tab 类型。
 *
 * @dependencies
 *   - react (useSyncExternalStore)
 *
 * @example
 *   import { registerTabComponent } from './tabComponentRegistry';
 *   const unregister = registerTabComponent({
 *     id: 'codemirror',
 *     component: CodeMirrorEditorTab,
 *   });
 *   // 卸载时调用 unregister()
 *
 * @exports
 *   - TabComponentDescriptor     Tab 组件注册描述
 *   - registerTabComponent       注册 Tab 组件
 *   - unregisterTabComponent     按 ID 注销 Tab 组件
 *   - getTabComponentsSnapshot   获取快照
 *   - subscribeTabComponents     订阅变化
 *   - useTabComponents           React Hook
 */

import { useSyncExternalStore, type ReactNode } from "react";
import type { WorkbenchTabProps } from "../layout/workbenchContracts";

/**
 * @type TabLifecycleScope
 * @description Tab 组件的生命周期作用域。
 *   - global: 仓库切换后继续保留
 *   - vault: 仓库切换后应被销毁并等待重新打开
 */
export type TabLifecycleScope = "global" | "vault";

/**
 * @interface TabComponentDescriptor
 * @description Tab 组件的注册描述，将组件 key 映射到一个 React 组件。
 * @field id        - 组件唯一标识（即 component key，如 "codemirror"）
 * @field component - React 组件，接收宿主 workbench 的 Tab props
 * @field lifecycleScope - 仓库切换时的生命周期作用域
 */
export interface TabComponentDescriptor {
    /** 组件唯一标识（component key） */
    id: string;
    /** Tab 渲染组件 */
    component: (props: WorkbenchTabProps<Record<string, unknown>>) => ReactNode;
    /** 仓库切换时的生命周期作用域，未声明时默认视为 global */
    lifecycleScope?: TabLifecycleScope;
}

/* ────────────────── 内部状态 ────────────────── */

/** Tab 组件注册表：id → 描述 */
const componentsMap = new Map<string, TabComponentDescriptor>();
/** 变更监听器集合 */
const listeners = new Set<() => void>();
/** 缓存快照 */
let cachedSnapshot: TabComponentDescriptor[] = [];

/**
 * 广播注册表变化。
 */
function emit(): void {
    cachedSnapshot = Array.from(componentsMap.values());
    listeners.forEach((listener) => listener());
}

/* ────────────────── 公共 API ────────────────── */

/**
 * @function registerTabComponent
 * @description 注册一个 Tab 组件类型。若 id 已存在则覆盖。
 * @param descriptor Tab 组件描述。
 * @returns 取消注册函数。
 */
export function registerTabComponent(descriptor: TabComponentDescriptor): () => void {
    componentsMap.set(descriptor.id, descriptor);
    console.info("[tabComponentRegistry] registered tab component", { id: descriptor.id });
    emit();

    return () => {
        unregisterTabComponent(descriptor.id);
    };
}

/**
 * @function unregisterTabComponent
 * @description 按 ID 注销 Tab 组件类型。
 * @param id 组件 ID。
 */
export function unregisterTabComponent(id: string): void {
    if (!componentsMap.has(id)) {
        return;
    }
    componentsMap.delete(id);
    console.info("[tabComponentRegistry] unregistered tab component", { id });
    emit();
}

/**
 * @function getTabComponentsSnapshot
 * @description 获取当前已注册的 Tab 组件快照。
 * @returns Tab 组件描述数组。
 */
export function getTabComponentsSnapshot(): TabComponentDescriptor[] {
    return cachedSnapshot;
}

/**
 * @function subscribeTabComponents
 * @description 订阅 Tab 组件注册表变化。
 * @param listener 变更回调。
 * @returns 取消订阅函数。
 */
export function subscribeTabComponents(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * @function useTabComponents
 * @description React Hook：订阅并返回当前已注册的 Tab 组件列表。
 * @returns Tab 组件快照数组。
 */
export function useTabComponents(): TabComponentDescriptor[] {
    return useSyncExternalStore(
        (listener) => subscribeTabComponents(listener),
        () => getTabComponentsSnapshot(),
        () => getTabComponentsSnapshot(),
    );
}

/**
 * @function getTabComponentById
 * @description 按 ID 查找已注册的 Tab 组件。
 * @param id 组件 ID。
 * @returns 组件描述，未找到返回 undefined。
 */
export function getTabComponentById(id: string): TabComponentDescriptor | undefined {
    return componentsMap.get(id);
}
