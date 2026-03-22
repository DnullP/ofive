/**
 * @module utils/windowDragGesture
 * @description 窗口拖拽手势兜底：在 Tauri 环境下为 drag region 主动调用 startDragging，提升 macOS 三指/触控板拖拽兼容性。
 * @dependencies
 *  - react (useEffect)
 *  - @tauri-apps/api/window (lazy import)
 */

import { useEffect } from "react";

type StartDragging = () => Promise<void>;

let cachedStartDragging: StartDragging | null = null;
const WINDOW_DRAGGING_CLASS = "app-window--dragging";
const WINDOW_DRAG_IDLE_MS = 180;
const WINDOW_DRAG_POLL_MS = 80;

/**
 * @function isTauriRuntime
 * @description 判断当前是否运行在 Tauri 宿主环境。
 * @returns Tauri 环境返回 true。
 */
function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };

    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

/**
 * @function getStartDragging
 * @description 获取并缓存 Tauri 窗口拖拽函数。
 * @returns 拖拽函数。
 */
async function getStartDragging(): Promise<StartDragging> {
    if (cachedStartDragging) {
        return cachedStartDragging;
    }

    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    cachedStartDragging = () => getCurrentWindow().startDragging();
    return cachedStartDragging;
}

/**
 * @function setWindowDraggingClass
 * @description 切换根节点窗口拖动状态 class。
 * @param active 是否处于拖动中。
 */
function setWindowDraggingClass(active: boolean): void {
    if (typeof document === "undefined") {
        return;
    }

    document.documentElement.classList.toggle(WINDOW_DRAGGING_CLASS, active);
}

/**
 * @function shouldIgnoreDragByTarget
 * @description 判断当前命中节点是否应跳过拖拽（交互节点）。
 * @param target 事件目标元素。
 * @returns 若应跳过返回 true。
 */
function shouldIgnoreDragByTarget(target: HTMLElement): boolean {
    return Boolean(
        target.closest(
            [
                ".window-no-drag",
                "button",
                "input",
                "textarea",
                "select",
                "a",
                "[role=button]",
                ".cm-editor",
                ".cm-content",
                ".dv-tab",
                ".dv-action",
                ".dv-tab-close",
            ].join(","),
        ),
    );
}

/**
 * @function useWindowDragGestureSupport
 * @description 启用窗口拖拽手势兜底：在 drag region 背景按下时主动启动窗口拖拽。
 */
export function useWindowDragGestureSupport(): void {
    useEffect(() => {
        if (!isTauriRuntime()) {
            return;
        }

        let draggingIntervalId: number | null = null;

        const stopDragTracking = (): void => {
            if (draggingIntervalId !== null) {
                window.clearInterval(draggingIntervalId);
                draggingIntervalId = null;
            }

            setWindowDraggingClass(false);
        };

        const startDragTracking = (): void => {
            stopDragTracking();
            setWindowDraggingClass(true);

            let lastScreenX = window.screenX;
            let lastScreenY = window.screenY;
            let lastMovedAt = Date.now();

            draggingIntervalId = window.setInterval(() => {
                const moved = window.screenX !== lastScreenX || window.screenY !== lastScreenY;
                if (moved) {
                    lastScreenX = window.screenX;
                    lastScreenY = window.screenY;
                    lastMovedAt = Date.now();
                    return;
                }

                if (Date.now() - lastMovedAt >= WINDOW_DRAG_IDLE_MS) {
                    stopDragTracking();
                }
            }, WINDOW_DRAG_POLL_MS);
        };

        const handleMouseDown = (event: MouseEvent): void => {
            if (event.button !== 0) {
                return;
            }

            const target = event.target as HTMLElement | null;
            if (!target) {
                return;
            }

            const dragRegion = target.closest(
                "[data-tauri-drag-region], .window-drag-region, .activity-bar-drag-region, .tab-strip-drag-region",
            );
            if (!dragRegion) {
                return;
            }

            if (shouldIgnoreDragByTarget(target)) {
                return;
            }

            event.preventDefault();
            startDragTracking();
            void getStartDragging()
                .then((startDragging) => startDragging())
                .catch((error) => {
                    stopDragTracking();
                    console.warn("[window-drag] startDragging failed", error);
                });
        };

        window.addEventListener("mousedown", handleMouseDown, { capture: true });
        window.addEventListener("mouseup", stopDragTracking, { capture: true });
        window.addEventListener("blur", stopDragTracking);
        return () => {
            window.removeEventListener("mousedown", handleMouseDown, { capture: true });
            window.removeEventListener("mouseup", stopDragTracking, { capture: true });
            window.removeEventListener("blur", stopDragTracking);
            stopDragTracking();
        };
    }, []);
}
