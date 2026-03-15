/**
 * @module host/registry/overlayRegistry
 * @description Overlay 注册中心：管理由宿主统一渲染的浮层组件。
 *   Overlay 与 panel/tab 的区别在于：
 *   - 不占据 dockview 面板位
 *   - 由宿主根布局统一挂载
 *   - 可由插件按需注册，用于 Quick Switcher、Command Palette 等全局浮层
 *
 * @dependencies
 *   - react (useSyncExternalStore, ReactNode)
 *   - ../commands/commandSystem (types only)
 *
 * @exports
 *   - OverlayRenderContext
 *   - OverlayDescriptor
 *   - registerOverlay
 *   - unregisterOverlay
 *   - getOverlaysSnapshot
 *   - subscribeOverlays
 *   - useOverlays
 */

import { useSyncExternalStore, type ReactNode } from "react";
import type { DockviewApi } from "dockview";
import type { CommandDefinition, CommandId } from "../commands/commandSystem";

/**
 * @interface OverlayRenderContext
 * @description Overlay 渲染时可访问的宿主能力。
 */
export interface OverlayRenderContext {
    /** 当前激活的 tab id */
    activeTabId: string | null;
    /** 当前 dockview api */
    dockviewApi: DockviewApi | null;
    /** 打开任意已注册 tab */
    openTab: (tab: {
        id: string;
        title: string;
        component: string;
        params?: Record<string, unknown>;
    }) => void;
    /** 使用 file opener 打开文件 */
    openFile: (options: {
        relativePath: string;
        contentOverride?: string;
        preferredOpenerId?: string;
    }) => Promise<void>;
    /** 关闭指定 tab */
    closeTab: (tabId: string) => void;
    /** 激活指定 tab */
    setActiveTab: (tabId: string) => void;
    /** 请求打开“移动到目录”浮层 */
    requestMoveFileToDirectory: (relativePath: string) => void;
    /** 执行命令系统中的一条命令 */
    executeCommand: (commandId: CommandId) => void;
    /** 获取当前全部命令定义 */
    getCommandDefinitions: () => CommandDefinition[];
}

/**
 * @interface OverlayDescriptor
 * @description Overlay 注册描述。
 */
export interface OverlayDescriptor {
    /** Overlay 唯一标识 */
    id: string;
    /** 排序值，越小越靠前渲染 */
    order?: number;
    /** Overlay 渲染函数 */
    render: (context: OverlayRenderContext) => ReactNode;
}

const overlaysMap = new Map<string, OverlayDescriptor>();
const listeners = new Set<() => void>();
let cachedSnapshot: OverlayDescriptor[] = [];

/**
 * @function emit
 * @description 重建缓存快照并广播变化。
 */
function emit(): void {
    cachedSnapshot = Array.from(overlaysMap.values()).sort((left, right) => {
        const leftOrder = left.order ?? 0;
        const rightOrder = right.order ?? 0;
        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return left.id.localeCompare(right.id);
    });
    listeners.forEach((listener) => listener());
}

/**
 * @function registerOverlay
 * @description 注册 Overlay；若 id 已存在则覆盖。
 * @param descriptor Overlay 描述。
 * @returns 取消注册函数。
 */
export function registerOverlay(descriptor: OverlayDescriptor): () => void {
    overlaysMap.set(descriptor.id, descriptor);
    console.info("[overlayRegistry] registered overlay", {
        id: descriptor.id,
        order: descriptor.order ?? 0,
    });
    emit();

    return () => {
        unregisterOverlay(descriptor.id);
    };
}

/**
 * @function unregisterOverlay
 * @description 按 id 注销 Overlay。
 * @param id Overlay id。
 */
export function unregisterOverlay(id: string): void {
    if (!overlaysMap.has(id)) {
        return;
    }

    overlaysMap.delete(id);
    console.info("[overlayRegistry] unregistered overlay", { id });
    emit();
}

/**
 * @function getOverlaysSnapshot
 * @description 获取当前 Overlay 快照。
 * @returns 已排序的 Overlay 列表。
 */
export function getOverlaysSnapshot(): OverlayDescriptor[] {
    return cachedSnapshot;
}

/**
 * @function subscribeOverlays
 * @description 订阅 Overlay 注册表变化。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeOverlays(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * @function useOverlays
 * @description React Hook：订阅并返回 Overlay 快照。
 * @returns Overlay 列表。
 */
export function useOverlays(): OverlayDescriptor[] {
    return useSyncExternalStore(
        (listener) => subscribeOverlays(listener),
        () => getOverlaysSnapshot(),
        () => getOverlaysSnapshot(),
    );
}