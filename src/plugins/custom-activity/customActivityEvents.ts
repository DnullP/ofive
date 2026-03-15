/**
 * @module plugins/custom-activity/customActivityEvents
 * @description 自定义 activity 创建 modal 的前端事件总线。
 *
 * @dependencies
 *   - react
 *
 * @exports
 *   - requestCustomActivityModalOpen
 *   - closeCustomActivityModal
 *   - useCustomActivityModalState
 */

import { useSyncExternalStore } from "react";

/** modal 状态快照。 */
interface CustomActivityModalState {
    isOpen: boolean;
}

const listeners = new Set<() => void>();
let state: CustomActivityModalState = { isOpen: false };

/** 广播状态变更。 */
function emit(): void {
    listeners.forEach((listener) => listener());
}

/** 请求打开创建 modal。 */
export function requestCustomActivityModalOpen(): void {
    state = { isOpen: true };
    console.info("[custom-activity] modal open requested");
    emit();
}

/** 关闭创建 modal。 */
export function closeCustomActivityModal(): void {
    state = { isOpen: false };
    console.info("[custom-activity] modal close requested");
    emit();
}

/** 订阅状态变化。 */
function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** React Hook：获取 modal 状态。 */
export function useCustomActivityModalState(): CustomActivityModalState {
    return useSyncExternalStore(subscribe, () => state, () => state);
}