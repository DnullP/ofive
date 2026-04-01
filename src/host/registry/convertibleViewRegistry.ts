/**
 * @module host/registry/convertibleViewRegistry
 * @description panel/tab 可转化视图注册中心：声明某个 Tab 组件与某个侧边栏 Panel
 *   属于同一个逻辑视图，并支持在容器切换时携带共享状态键与来源参数。
 *
 *   该抽象只负责“谁能转、转到哪、转回 Tab 时如何构造实例”的基础设施，
 *   组件内部是否真正复用状态，由组件自己基于 `stateKey` 决定。
 *
 * @dependencies
 *   - react (useSyncExternalStore)
 *
 * @example
 *   registerConvertibleView({
 *     id: "calendar",
 *     tabComponentId: "calendar-tab",
 *     panelId: "calendar-panel",
 *     defaultMode: "tab",
 *     buildTabInstance: ({ stateKey }) => ({
 *       id: "calendar",
 *       title: i18n.t("app.calendar"),
 *       component: "calendar-tab",
 *       params: buildConvertibleViewTabParams({ descriptorId: "calendar", stateKey }),
 *     }),
 *   });
 *
 * @exports
 *   - CONVERTIBLE_VIEW_TAB_PARAM_KEY
 *   - ConvertibleViewDescriptor
 *   - ConvertibleViewMode
 *   - ConvertibleViewTabState
 *   - registerConvertibleView
 *   - unregisterConvertibleView
 *   - useConvertibleViews
 *   - getConvertibleViewByPanelId
 *   - getConvertibleViewByTabComponentId
 *   - buildConvertibleViewTabParams
 *   - readConvertibleViewTabState
 */

import { useSyncExternalStore } from "react";

/** Tab 参数中的保留字段名：承载可转化视图元数据。 */
export const CONVERTIBLE_VIEW_TAB_PARAM_KEY = "__convertibleView";

/** 可转化视图当前所在容器模式。 */
export type ConvertibleViewMode = "tab" | "panel";

/**
 * @interface ConvertibleViewTabState
 * @description 挂载在 Tab params 上的可转化视图状态。
 */
export interface ConvertibleViewTabState {
    /** 对应的可转化视图描述符 ID。 */
    descriptorId: string;
    /** 用于组件内部选择性共享状态的键。 */
    stateKey: string;
    /** 关闭该 tab 时是否应恢复回对应 panel。 */
    restorePanelOnClose?: boolean;
}

/**
 * @interface ConvertibleTabInstanceDefinition
 * @description 转换为 Tab 时需要构造的实例定义。
 */
export interface ConvertibleTabInstanceDefinition {
    /** Tab 实例 ID。 */
    id: string;
    /** Tab 标题。 */
    title: string;
    /** Tab 组件类型 ID。 */
    component: string;
    /** 可选参数。 */
    params?: Record<string, unknown>;
}

/**
 * @interface BuildConvertibleTabInstanceOptions
 * @description panel 转回 tab 时传入的构造参数。
 */
export interface BuildConvertibleTabInstanceOptions {
    /** 状态共享键。 */
    stateKey: string;
    /** 来源面板 ID。 */
    panelId: string;
    /** 上一次从 Tab 转入 Panel 时携带的源参数。 */
    params?: Record<string, unknown>;
}

/**
 * @interface ConvertibleViewDescriptor
 * @description 可转化视图注册描述。
 */
export interface ConvertibleViewDescriptor {
    /** 描述符唯一 ID。 */
    id: string;
    /** 对应 Tab 组件类型 ID。 */
    tabComponentId: string;
    /** 对应 Panel ID。 */
    panelId: string;
    /** 默认展示模式。 */
    defaultMode: ConvertibleViewMode;
    /** 默认状态键；未提供时回退到 id。 */
    getInitialStateKey?: () => string;
    /** 从 Panel 转回 Tab 时如何构造 Tab 实例。 */
    buildTabInstance: (options: BuildConvertibleTabInstanceOptions) => ConvertibleTabInstanceDefinition;
}

const descriptorsById = new Map<string, ConvertibleViewDescriptor>();
const listeners = new Set<() => void>();
let cachedSnapshot: ConvertibleViewDescriptor[] = [];

function emit(): void {
    cachedSnapshot = Array.from(descriptorsById.values()).sort((left, right) => left.id.localeCompare(right.id));
    listeners.forEach((listener) => listener());
}

/**
 * @function buildConvertibleViewTabParams
 * @description 为 Tab params 注入可转化视图元数据。
 * @param state 元数据。
 * @param existingParams 原始 params。
 * @returns 合并后的 params。
 */
export function buildConvertibleViewTabParams(
    state: ConvertibleViewTabState,
    existingParams?: Record<string, unknown>,
): Record<string, unknown> {
    return {
        ...(existingParams ?? {}),
        [CONVERTIBLE_VIEW_TAB_PARAM_KEY]: state,
    };
}

/**
 * @function readConvertibleViewTabState
 * @description 从任意 Tab params 中解析可转化视图元数据。
 * @param params Tab params。
 * @returns 元数据；不存在或非法时返回 null。
 */
export function readConvertibleViewTabState(
    params: Record<string, unknown> | undefined,
): ConvertibleViewTabState | null {
    const rawValue = params?.[CONVERTIBLE_VIEW_TAB_PARAM_KEY];
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
        return null;
    }

    const descriptorId = (rawValue as Record<string, unknown>).descriptorId;
    const stateKey = (rawValue as Record<string, unknown>).stateKey;
    if (typeof descriptorId !== "string" || typeof stateKey !== "string") {
        return null;
    }

    const restorePanelOnClose = (rawValue as Record<string, unknown>).restorePanelOnClose;
    if (restorePanelOnClose !== undefined && typeof restorePanelOnClose !== "boolean") {
        return null;
    }

    return {
        descriptorId,
        stateKey,
        restorePanelOnClose,
    };
}

/**
 * @function registerConvertibleView
 * @description 注册一个可转化视图描述符。
 * @param descriptor 描述符。
 * @returns 取消注册函数。
 */
export function registerConvertibleView(descriptor: ConvertibleViewDescriptor): () => void {
    descriptorsById.set(descriptor.id, descriptor);
    console.info("[convertibleViewRegistry] registered convertible view", {
        id: descriptor.id,
        tabComponentId: descriptor.tabComponentId,
        panelId: descriptor.panelId,
    });
    emit();

    return () => {
        unregisterConvertibleView(descriptor.id);
    };
}

/**
 * @function unregisterConvertibleView
 * @description 按 ID 注销可转化视图描述符。
 * @param id 描述符 ID。
 */
export function unregisterConvertibleView(id: string): void {
    if (!descriptorsById.has(id)) {
        return;
    }

    descriptorsById.delete(id);
    console.info("[convertibleViewRegistry] unregistered convertible view", { id });
    emit();
}

/** 获取当前可转化视图快照。 */
export function getConvertibleViewsSnapshot(): ConvertibleViewDescriptor[] {
    return cachedSnapshot;
}

/** 订阅可转化视图描述变化。 */
export function subscribeConvertibleViews(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** React Hook：返回当前可转化视图描述列表。 */
export function useConvertibleViews(): ConvertibleViewDescriptor[] {
    return useSyncExternalStore(
        (listener) => subscribeConvertibleViews(listener),
        () => getConvertibleViewsSnapshot(),
        () => getConvertibleViewsSnapshot(),
    );
}

/** 按 panelId 查找可转化视图描述。 */
export function getConvertibleViewByPanelId(panelId: string): ConvertibleViewDescriptor | undefined {
    return cachedSnapshot.find((descriptor) => descriptor.panelId === panelId);
}

/** 按 tab 组件类型 ID 查找可转化视图描述。 */
export function getConvertibleViewByTabComponentId(componentId: string): ConvertibleViewDescriptor | undefined {
    return cachedSnapshot.find((descriptor) => descriptor.tabComponentId === componentId);
}
