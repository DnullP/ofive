/**
 * @module host/layout/rightSidebarVisibilityBridge
 * @description 右侧边栏可见性桥接：为标题栏等布局外组件提供状态订阅与切换请求能力。
 * @dependencies
 *   - react
 *
 * @example
 *   const visible = useRightSidebarVisibility();
 *   requestToggleRightSidebarVisibility();
 */

import { useSyncExternalStore } from "react";

let isRightSidebarVisibleSnapshot = true;
const visibilityListeners = new Set<() => void>();
const toggleRequestListeners = new Set<() => void>();

function emitVisibility(): void {
    visibilityListeners.forEach((listener) => listener());
}

/**
 * @function setRightSidebarVisibilitySnapshot
 * @description 同步当前右侧边栏可见性到桥接快照。
 * @param isVisible 当前是否可见。
 */
export function setRightSidebarVisibilitySnapshot(isVisible: boolean): void {
    if (isRightSidebarVisibleSnapshot === isVisible) {
        return;
    }

    isRightSidebarVisibleSnapshot = isVisible;
    emitVisibility();
}

/**
 * @function subscribeRightSidebarVisibility
 * @description 订阅右侧边栏可见性变化。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeRightSidebarVisibility(listener: () => void): () => void {
    visibilityListeners.add(listener);
    return () => {
        visibilityListeners.delete(listener);
    };
}

/**
 * @function useRightSidebarVisibility
 * @description 订阅并返回当前右侧边栏可见性。
 * @returns 当前可见性快照。
 */
export function useRightSidebarVisibility(): boolean {
    return useSyncExternalStore(
        subscribeRightSidebarVisibility,
        () => isRightSidebarVisibleSnapshot,
        () => isRightSidebarVisibleSnapshot,
    );
}

/**
 * @function requestToggleRightSidebarVisibility
 * @description 请求切换右侧边栏显示状态。
 */
export function requestToggleRightSidebarVisibility(): void {
    toggleRequestListeners.forEach((listener) => listener());
}

/**
 * @function subscribeRightSidebarToggleRequest
 * @description 订阅“切换右侧边栏”请求。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeRightSidebarToggleRequest(listener: () => void): () => void {
    toggleRequestListeners.add(listener);
    return () => {
        toggleRequestListeners.delete(listener);
    };
}