/**
 * @module registry/panelRegistry
 * @description 侧边栏面板注册中心：以注册方式管理侧边栏中可显示的面板组件。
 *   面板通过 activityId 关联到活动图标，由活动图标决定何时显示。
 *   支持动态注册/注销，可用于插件系统扩展侧边栏面板。
 *
 * @dependencies
 *   - react (useSyncExternalStore)
 *
 * @example
 *   import { registerPanel } from './panelRegistry';
 *   const unregister = registerPanel({
 *     id: 'files',
 *     title: () => t('app.explorer'),
 *     activityId: 'files',
 *     defaultPosition: 'left',
 *     defaultOrder: 1,
 *     render: (ctx) => <VaultPanel ... />,
 *   });
 *   // 卸载时调用 unregister()
 *
 * @exports
 *   - PanelDescriptor         面板注册描述
 *   - registerPanel            注册面板
 *   - unregisterPanel          按 ID 注销面板
 *   - getPanelsSnapshot        获取面板快照
 *   - subscribePanels          订阅面板变化
 *   - usePanels                React Hook
 */

import { useSyncExternalStore, type ReactNode } from "react";
import type { PanelRenderContext, PanelPosition } from "../layout/DockviewLayout";

/**
 * @interface PanelDescriptor
 * @description 侧边栏面板的注册描述，包含面板的渲染和定位信息。
 * @field id             - 面板唯一标识
 * @field title          - 面板标题（字符串或返回字符串的函数，支持 i18n 动态更新）
 * @field activityId     - 关联的活动图标 ID，决定在哪个 activity 分组下显示
 * @field defaultPosition - 默认侧栏位置：left / right
 * @field defaultOrder   - 默认排序值（数值越小越靠前）
 * @field render         - 面板渲染函数，接收 PanelRenderContext
 */
export interface PanelDescriptor {
    /** 面板唯一标识 */
    id: string;
    /** 面板标题（字符串或函数，函数支持 i18n 动态更新） */
    title: string | (() => string);
    /** 关联的活动图标 ID */
    activityId: string;
    /** 默认侧栏位置 */
    defaultPosition: PanelPosition;
    /** 默认排序值 */
    defaultOrder: number;
    /** 面板渲染函数 */
    render: (context: PanelRenderContext) => ReactNode;
}

/* ────────────────── 内部状态 ────────────────── */

/** 面板注册表：id → 描述 */
const panelsMap = new Map<string, PanelDescriptor>();
/** 变更监听器集合 */
const listeners = new Set<() => void>();
/** 缓存的有序快照，避免每次订阅都重新排序 */
let cachedSnapshot: PanelDescriptor[] = [];

/**
 * 广播注册表变化，更新缓存快照并通知所有监听器。
 */
function emit(): void {
    cachedSnapshot = Array.from(panelsMap.values()).sort((a, b) => {
        if (a.defaultOrder !== b.defaultOrder) {
            return a.defaultOrder - b.defaultOrder;
        }
        return a.id.localeCompare(b.id);
    });
    listeners.forEach((listener) => listener());
}

/* ────────────────── 公共 API ────────────────── */

/**
 * @function registerPanel
 * @description 注册一个侧边栏面板。若 id 已存在则覆盖。
 * @param descriptor 面板描述。
 * @returns 取消注册函数。
 */
export function registerPanel(descriptor: PanelDescriptor): () => void {
    panelsMap.set(descriptor.id, descriptor);
    console.info("[panelRegistry] registered panel", { id: descriptor.id });
    emit();

    return () => {
        unregisterPanel(descriptor.id);
    };
}

/**
 * @function unregisterPanel
 * @description 按 ID 注销面板。
 * @param id 面板 ID。
 */
export function unregisterPanel(id: string): void {
    if (!panelsMap.has(id)) {
        return;
    }
    panelsMap.delete(id);
    console.info("[panelRegistry] unregistered panel", { id });
    emit();
}

/**
 * @function getPanelsSnapshot
 * @description 获取当前已注册面板的有序快照。
 * @returns 面板描述数组（按 defaultOrder 排序）。
 */
export function getPanelsSnapshot(): PanelDescriptor[] {
    return cachedSnapshot;
}

/**
 * @function subscribePanels
 * @description 订阅面板注册表变化。
 * @param listener 变更回调。
 * @returns 取消订阅函数。
 */
export function subscribePanels(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * @function usePanels
 * @description React Hook：订阅并返回当前已注册的面板列表。
 * @returns 面板快照数组。
 */
export function usePanels(): PanelDescriptor[] {
    return useSyncExternalStore(
        (listener) => subscribePanels(listener),
        () => getPanelsSnapshot(),
        () => getPanelsSnapshot(),
    );
}

/**
 * @function resolveTitle
 * @description 解析面板标题：将函数形式转换为字符串。
 * @param title 字符串或返回字符串的函数。
 * @returns 解析后的字符串标题。
 */
export function resolveTitle(title: string | (() => string)): string {
    return typeof title === "function" ? title() : title;
}
