/**
 * @module host/registry/sidebarHeaderActionRegistry
 * @description 侧栏标题区按钮注册中心：允许插件向特定 activity 的 sidebar-header 右侧注册可点击图标按钮。
 *   典型场景：资源管理器标题栏上的“新建文件 / 新建文件夹”。
 *
 * @dependencies
 *   - react (useSyncExternalStore, ReactNode)
 *   - ../layout/DockviewLayout (types only)
 *   - ../commands/commandSystem (types only)
 *   - ../layout/sidebar/types (types only)
 *
 * @exports
 *   - SidebarHeaderActionContext
 *   - SidebarHeaderActionDescriptor
 *   - registerSidebarHeaderAction
 *   - unregisterSidebarHeaderAction
 *   - getSidebarHeaderActionsSnapshot
 *   - subscribeSidebarHeaderActions
 *   - useSidebarHeaderActions
 *   - resolveSidebarHeaderActionTitle
 */

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { CommandId } from "../commands/commandSystem";
import type { PanelRenderContext } from "../layout/DockviewLayout";
import type { SidebarSide } from "../layout/sidebar/types";

/**
 * @interface SidebarHeaderActionContext
 * @description 侧栏标题按钮点击时可访问的宿主能力。
 */
export interface SidebarHeaderActionContext extends PanelRenderContext {
    /** 当前 activity id */
    activityId: string;
    /** 当前面板 id */
    panelId: string | null;
    /** 当前侧栏方向 */
    side: SidebarSide;
    /** 执行一条命令 */
    executeCommand: (commandId: CommandId) => void;
}

/**
 * @interface SidebarHeaderActionDescriptor
 * @description 侧栏标题按钮注册描述。
 */
export interface SidebarHeaderActionDescriptor {
    /** 按钮唯一标识 */
    id: string;
    /** 绑定到的 activity id */
    activityId: string;
    /** 按钮标题，可作为 tooltip */
    title: string | (() => string);
    /** 按钮图标 */
    icon: ReactNode;
    /** 排序值，越小越靠前 */
    order?: number;
    /** 点击回调 */
    onClick: (context: SidebarHeaderActionContext) => void;
}

const actionsMap = new Map<string, SidebarHeaderActionDescriptor>();
const listeners = new Set<() => void>();
let cachedSnapshot: SidebarHeaderActionDescriptor[] = [];

/**
 * @function emit
 * @description 重建缓存快照并通知监听器。
 */
function emit(): void {
    cachedSnapshot = Array.from(actionsMap.values()).sort((left, right) => {
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
 * @function registerSidebarHeaderAction
 * @description 注册一个侧栏标题按钮。
 * @param descriptor 按钮描述。
 * @returns 取消注册函数。
 */
export function registerSidebarHeaderAction(descriptor: SidebarHeaderActionDescriptor): () => void {
    actionsMap.set(descriptor.id, descriptor);
    console.info("[sidebarHeaderActionRegistry] registered action", {
        id: descriptor.id,
        activityId: descriptor.activityId,
    });
    emit();

    return () => {
        unregisterSidebarHeaderAction(descriptor.id);
    };
}

/**
 * @function unregisterSidebarHeaderAction
 * @description 按 id 注销侧栏标题按钮。
 * @param id 按钮 id。
 */
export function unregisterSidebarHeaderAction(id: string): void {
    if (!actionsMap.has(id)) {
        return;
    }

    actionsMap.delete(id);
    console.info("[sidebarHeaderActionRegistry] unregistered action", { id });
    emit();
}

/**
 * @function getSidebarHeaderActionsSnapshot
 * @description 获取当前所有侧栏标题按钮快照。
 * @returns 已排序按钮列表。
 */
export function getSidebarHeaderActionsSnapshot(): SidebarHeaderActionDescriptor[] {
    return cachedSnapshot;
}

/**
 * @function subscribeSidebarHeaderActions
 * @description 订阅侧栏标题按钮注册表变化。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeSidebarHeaderActions(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * @function useSidebarHeaderActions
 * @description React Hook：返回指定 activity 的侧栏标题按钮列表。
 * @param activityId 目标 activity id；为空时返回空数组。
 * @returns 匹配的按钮列表。
 */
export function useSidebarHeaderActions(activityId: string | null): SidebarHeaderActionDescriptor[] {
    const snapshot = useSyncExternalStore(
        (listener) => subscribeSidebarHeaderActions(listener),
        () => getSidebarHeaderActionsSnapshot(),
        () => getSidebarHeaderActionsSnapshot(),
    );

    return useMemo(() => {
        if (!activityId) {
            return [];
        }

        return snapshot.filter((action) => action.activityId === activityId);
    }, [activityId, snapshot]);
}

/**
 * @function resolveSidebarHeaderActionTitle
 * @description 解析按钮标题：将函数形式转换为字符串。
 * @param title 字符串或返回字符串的函数。
 * @returns 解析后的标题。
 */
export function resolveSidebarHeaderActionTitle(title: string | (() => string)): string {
    return typeof title === "function" ? title() : title;
}