/**
 * @module registry/activityRegistry
 * @description 活动图标注册中心：管理活动栏 / 侧边图标栏中的图标项。
 *   活动图标分为两种类型：
 *   1. **面板容器型**（panel-container）：点击后切换关联的侧边栏面板分组显隐。
 *      面板通过 panelRegistry 注册并通过 activityId 关联。
 *   2. **回调型**（callback）：点击后执行自定义回调（如打开标签页）。
 *      不关联侧边栏面板，点击即触发回调。
 *
 *   支持动态注册/注销，可用于插件系统扩展活动栏图标。
 *
 * @dependencies
 *   - react (useSyncExternalStore, ReactNode)
 *
 * @example
 *   // 注册面板容器型活动图标
 *   registerActivity({
 *     type: 'panel-container',
 *     id: 'files',
 *     title: () => t('app.explorer'),
 *     icon: <FolderOpen size={18} />,
 *     defaultSection: 'top',
 *     defaultBar: 'left',
 *     defaultOrder: 1,
 *   });
 *
 *   // 注册回调型活动图标
 *   registerActivity({
 *     type: 'callback',
 *     id: 'knowledge-graph',
 *     title: () => t('app.knowledgeGraph'),
 *     icon: <Orbit size={18} />,
 *     defaultSection: 'top',
 *     defaultBar: 'left',
 *     defaultOrder: 3,
 *     onActivate: (ctx) => ctx.openTab({ ... }),
 *   });
 *
 * @exports
 *   - ActivityBaseDescriptor       活动图标基础描述
 *   - PanelContainerActivity       面板容器型活动描述
 *   - CallbackActivity             回调型活动描述
 *   - ActivityDescriptor           联合活动描述类型
 *   - registerActivity             注册活动图标
 *   - unregisterActivity           按 ID 注销活动图标
 *   - getActivitiesSnapshot        获取快照
 *   - subscribeActivities          订阅变化
 *   - useActivities                React Hook
 *   - getActivityById              按 ID 查找活动
 */

import { useSyncExternalStore, type ReactNode } from "react";
import type { PanelRenderContext } from "../layout/DockviewLayout";

/**
 * @interface ActivityBaseDescriptor
 * @description 活动图标的公共基础字段。
 * @field id             - 活动唯一标识
 * @field title          - 显示标题（字符串或函数，支持 i18n）
 * @field icon           - 显示图标（ReactNode）
 * @field defaultSection - 默认区域（top / bottom）
 * @field defaultBar     - 默认所属图标栏（left / right）
 * @field defaultOrder   - 默认排序值
 */
interface ActivityBaseDescriptor {
    /** 活动唯一标识 */
    id: string;
    /** 显示标题（字符串或函数） */
    title: string | (() => string);
    /** 显示图标 */
    icon: ReactNode;
    /** 默认区域 */
    defaultSection: "top" | "bottom";
    /** 默认所属图标栏 */
    defaultBar: "left" | "right";
    /** 默认排序值 */
    defaultOrder: number;
}

/**
 * @interface PanelContainerActivity
 * @description 面板容器型活动图标：点击后切换关联的侧边栏面板分组显隐。
 *   面板通过 panelRegistry 注册并以相同的 activityId 关联。
 * @field type - 固定为 "panel-container"
 */
export interface PanelContainerActivity extends ActivityBaseDescriptor {
    /** 类型标识 */
    type: "panel-container";
}

/**
 * @interface CallbackActivity
 * @description 回调型活动图标：点击后执行自定义回调。
 *   不关联侧边栏面板，常用于打开独立 Tab 页。
 * @field type       - 固定为 "callback"
 * @field onActivate - 点击时执行的回调函数
 */
export interface CallbackActivity extends ActivityBaseDescriptor {
    /** 类型标识 */
    type: "callback";
    /** 点击回调：接收 PanelRenderContext 以便操作 Tab 等 */
    onActivate: (context: PanelRenderContext) => void;
}

/**
 * @type ActivityDescriptor
 * @description 活动图标描述的联合类型。
 */
export type ActivityDescriptor = PanelContainerActivity | CallbackActivity;

/* ────────────────── 内部状态 ────────────────── */

/** 活动注册表：id → 描述 */
const activitiesMap = new Map<string, ActivityDescriptor>();
/** 变更监听器集合 */
const listeners = new Set<() => void>();
/** 缓存的有序快照 */
let cachedSnapshot: ActivityDescriptor[] = [];

/**
 * 广播注册表变化，更新缓存快照并通知所有监听器。
 */
function emit(): void {
    cachedSnapshot = Array.from(activitiesMap.values()).sort((a, b) => {
        if (a.defaultOrder !== b.defaultOrder) {
            return a.defaultOrder - b.defaultOrder;
        }
        return a.id.localeCompare(b.id);
    });
    listeners.forEach((listener) => listener());
}

/* ────────────────── 公共 API ────────────────── */

/**
 * @function registerActivity
 * @description 注册一个活动图标。若 id 已存在则覆盖。
 * @param descriptor 活动描述。
 * @returns 取消注册函数。
 */
export function registerActivity(descriptor: ActivityDescriptor): () => void {
    activitiesMap.set(descriptor.id, descriptor);
    console.info("[activityRegistry] registered activity", {
        id: descriptor.id,
        type: descriptor.type,
    });
    emit();

    return () => {
        unregisterActivity(descriptor.id);
    };
}

/**
 * @function unregisterActivity
 * @description 按 ID 注销活动图标。
 * @param id 活动 ID。
 */
export function unregisterActivity(id: string): void {
    if (!activitiesMap.has(id)) {
        return;
    }
    activitiesMap.delete(id);
    console.info("[activityRegistry] unregistered activity", { id });
    emit();
}

/**
 * @function getActivitiesSnapshot
 * @description 获取当前已注册活动的有序快照。
 * @returns 活动描述数组（按 defaultOrder 排序）。
 */
export function getActivitiesSnapshot(): ActivityDescriptor[] {
    return cachedSnapshot;
}

/**
 * @function subscribeActivities
 * @description 订阅活动注册表变化。
 * @param listener 变更回调。
 * @returns 取消订阅函数。
 */
export function subscribeActivities(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * @function useActivities
 * @description React Hook：订阅并返回当前已注册的活动列表。
 * @returns 活动快照数组。
 */
export function useActivities(): ActivityDescriptor[] {
    return useSyncExternalStore(
        (listener) => subscribeActivities(listener),
        () => getActivitiesSnapshot(),
        () => getActivitiesSnapshot(),
    );
}

/**
 * @function getActivityById
 * @description 按 ID 查找已注册的活动。
 * @param id 活动 ID。
 * @returns 活动描述，未找到返回 undefined。
 */
export function getActivityById(id: string): ActivityDescriptor | undefined {
    return activitiesMap.get(id);
}

/**
 * @function resolveActivityTitle
 * @description 解析活动标题：将函数形式转换为字符串。
 * @param title 字符串或返回字符串的函数。
 * @returns 解析后的字符串标题。
 */
export function resolveActivityTitle(title: string | (() => string)): string {
    return typeof title === "function" ? title() : title;
}
