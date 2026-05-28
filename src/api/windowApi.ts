/**
 * @module api/windowApi
 * @description 桌面窗口接口封装：负责把前端窗口材质配置下发到 Tauri 原生宿主。
 * @dependencies
 *  - @tauri-apps/api/core
 */

import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { WorkbenchTabDragPayload, WorkbenchTabDragPointer } from "layout-v2";

export type WindowThemeMode = "dark" | "light" | "kraft";
export type OfiveWindowKind = "main" | "detached";

export const OFIVE_TAB_WINDOW_DRAG_MOVE_EVENT = "ofive://tab-window-drag-move";
export const OFIVE_TAB_WINDOW_DRAG_DROP_EVENT = "ofive://tab-window-drag-drop";
export const OFIVE_TAB_WINDOW_DRAG_CANCEL_EVENT = "ofive://tab-window-drag-cancel";
export const OFIVE_TAB_WINDOW_DRAG_ACCEPTED_EVENT = "ofive://tab-window-drag-accepted";
export const OFIVE_DETACHED_TAB_WINDOW_READY_EVENT = "ofive://detached-tab-window-ready";

export interface DetachedTabWindowTab {
    id: string;
    title: string;
    component: string;
    params?: Record<string, unknown>;
}

export interface CreateDetachedTabWindowRequest {
    tab: DetachedTabWindowTab;
    screenX?: number;
    screenY?: number;
}

export interface TabWindowDragEventPayload {
    dragId: string;
    sourceWorkbenchId?: string | null;
    sourceWindowLabel?: string | null;
    detachedWindowLabel?: string | null;
    tab: WorkbenchTabDragPayload;
    pointer: WorkbenchTabDragPointer;
}

export interface TabWindowDragAcceptedPayload {
    dragId: string;
    tabId: string;
    targetWindowLabel?: string | null;
}

export interface DetachedTabWindowReadyPayload {
    windowLabel: string;
}

export interface OfiveWindowBootstrap {
    kind: OfiveWindowKind;
    initialTab: DetachedTabWindowTab | null;
}

/**
 * @interface WindowsAcrylicColorConfig
 * @description 单组 Windows Acrylic RGBA 参数。
 */
export interface WindowsAcrylicColorConfig {
    red: number;
    green: number;
    blue: number;
    alpha: number;
}

/**
 * @interface WindowsAcrylicEffectConfig
 * @description Windows Acrylic 原生效果参数快照。
 */
export interface WindowsAcrylicEffectConfig {
    enabled: boolean;
    appThemeMode: WindowThemeMode;
    disableSystemBackdrop: boolean;
    focusedColor: WindowsAcrylicColorConfig;
    focusedAccentFlags: number;
    focusedAnimationId: number;
    inactiveColor: WindowsAcrylicColorConfig;
    inactiveAccentFlags: number;
    inactiveAnimationId: number;
}

export function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };

    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

function normalizeDetachedTabWindowTab(value: unknown): DetachedTabWindowTab | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const candidate = value as {
        id?: unknown;
        title?: unknown;
        component?: unknown;
        params?: unknown;
    };
    if (
        typeof candidate.id !== "string" ||
        typeof candidate.title !== "string" ||
        typeof candidate.component !== "string"
    ) {
        return null;
    }

    return {
        id: candidate.id,
        title: candidate.title,
        component: candidate.component,
        params: candidate.params && typeof candidate.params === "object"
            ? candidate.params as Record<string, unknown>
            : undefined,
    };
}

function decodeUrlSafeBase64Json(encoded: string): unknown {
    const normalized = encoded
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = globalThis.atob(normalized);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as unknown;
}

export function readOfiveWindowBootstrap(href?: string): OfiveWindowBootstrap {
    const sourceHref = href ?? (typeof window !== "undefined" ? window.location.href : "http://localhost/");
    const url = new URL(sourceHref);
    const kind: OfiveWindowKind = url.searchParams.get("ofiveWindow") === "detached"
        ? "detached"
        : "main";
    const encodedInitialTab = url.searchParams.get("ofiveInitialTab");
    if (!encodedInitialTab) {
        return { kind, initialTab: null };
    }

    try {
        return {
            kind,
            initialTab: normalizeDetachedTabWindowTab(decodeUrlSafeBase64Json(encodedInitialTab)),
        };
    } catch (error) {
        console.warn("[window-api] failed to read detached tab bootstrap", {
            message: error instanceof Error ? error.message : String(error),
        });
        return { kind, initialTab: null };
    }
}

/**
 * @function updateMainWindowAcrylicEffect
 * @description 将当前窗口材质参数和应用主题模式下发给 Tauri 主窗口。
 * @param config 当前 Acrylic 参数快照。
 * @returns Promise<void>
 */
export async function updateMainWindowAcrylicEffect(
    config: WindowsAcrylicEffectConfig,
): Promise<void> {
    if (!isTauriRuntime()) {
        return;
    }

    await invoke("update_main_window_acrylic_effect", { config });
}

/**
 * @function reloadCurrentWindow
 * @description 请求 Tauri 宿主清理后端运行时资源并 reload 当前 WebView。
 * @returns Promise<void>
 */
export async function reloadCurrentWindow(): Promise<void> {
    if (!isTauriRuntime()) {
        window.location.reload();
        return;
    }

    await invoke("reload_current_window");
}

export async function createDetachedTabWindow(
    request: CreateDetachedTabWindowRequest,
): Promise<string> {
    if (!isTauriRuntime()) {
        return "";
    }

    return await invoke<string>("create_detached_tab_window", { request });
}

export async function getCurrentOfiveWindowLabel(): Promise<string | null> {
    if (!isTauriRuntime()) {
        return "browser-main";
    }

    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow().label;
}

export async function destroyCurrentOfiveWindow(): Promise<void> {
    if (!isTauriRuntime()) {
        return;
    }

    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().destroy();
}

export async function destroyOfiveWindowByLabel(label: string | null | undefined): Promise<void> {
    if (!label || !isTauriRuntime()) {
        return;
    }

    const { Window } = await import("@tauri-apps/api/window");
    const targetWindow = await Window.getByLabel(label);
    await targetWindow?.destroy();
}

export async function moveOfiveWindowByLabel(
    label: string | null | undefined,
    position: { x: number; y: number },
): Promise<void> {
    if (!label || !isTauriRuntime()) {
        return;
    }

    const { LogicalPosition, Window } = await import("@tauri-apps/api/window");
    const targetWindow = await Window.getByLabel(label);
    await targetWindow?.setPosition(new LogicalPosition(position.x, position.y));
}

export async function showAndFocusOfiveWindowByLabel(label: string | null | undefined): Promise<void> {
    if (!label || !isTauriRuntime()) {
        return;
    }

    const { Window } = await import("@tauri-apps/api/window");
    const targetWindow = await Window.getByLabel(label);
    if (!targetWindow) {
        return;
    }

    await targetWindow.setFocusable(true);
    await targetWindow.show();
    await targetWindow.setFocus();
}

async function emitRuntimeEvent<T>(eventName: string, payload: T): Promise<void> {
    if (!isTauriRuntime()) {
        window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
        return;
    }

    const { emit } = await import("@tauri-apps/api/event");
    await emit(eventName, payload);
}

async function listenRuntimeEvent<T>(
    eventName: string,
    handler: (payload: T) => void,
): Promise<UnlistenFn> {
    if (!isTauriRuntime()) {
        const listener = (event: Event): void => {
            handler((event as CustomEvent<T>).detail);
        };
        window.addEventListener(eventName, listener);
        return () => window.removeEventListener(eventName, listener);
    }

    const { listen } = await import("@tauri-apps/api/event");
    return await listen<T>(eventName, (event) => handler(event.payload));
}

export async function emitTabWindowDragMove(payload: TabWindowDragEventPayload): Promise<void> {
    await emitRuntimeEvent(OFIVE_TAB_WINDOW_DRAG_MOVE_EVENT, payload);
}

export async function emitTabWindowDragDrop(payload: TabWindowDragEventPayload): Promise<void> {
    await emitRuntimeEvent(OFIVE_TAB_WINDOW_DRAG_DROP_EVENT, payload);
}

export async function emitTabWindowDragCancel(payload: TabWindowDragEventPayload): Promise<void> {
    await emitRuntimeEvent(OFIVE_TAB_WINDOW_DRAG_CANCEL_EVENT, payload);
}

export async function emitTabWindowDragAccepted(payload: TabWindowDragAcceptedPayload): Promise<void> {
    await emitRuntimeEvent(OFIVE_TAB_WINDOW_DRAG_ACCEPTED_EVENT, payload);
}

export async function emitDetachedTabWindowReady(payload: DetachedTabWindowReadyPayload): Promise<void> {
    await emitRuntimeEvent(OFIVE_DETACHED_TAB_WINDOW_READY_EVENT, payload);
}

export async function listenTabWindowDragMove(
    handler: (payload: TabWindowDragEventPayload) => void,
): Promise<UnlistenFn> {
    return await listenRuntimeEvent(OFIVE_TAB_WINDOW_DRAG_MOVE_EVENT, handler);
}

export async function listenTabWindowDragDrop(
    handler: (payload: TabWindowDragEventPayload) => void,
): Promise<UnlistenFn> {
    return await listenRuntimeEvent(OFIVE_TAB_WINDOW_DRAG_DROP_EVENT, handler);
}

export async function listenTabWindowDragCancel(
    handler: (payload: TabWindowDragEventPayload) => void,
): Promise<UnlistenFn> {
    return await listenRuntimeEvent(OFIVE_TAB_WINDOW_DRAG_CANCEL_EVENT, handler);
}

export async function listenTabWindowDragAccepted(
    handler: (payload: TabWindowDragAcceptedPayload) => void,
): Promise<UnlistenFn> {
    return await listenRuntimeEvent(OFIVE_TAB_WINDOW_DRAG_ACCEPTED_EVENT, handler);
}

export async function listenDetachedTabWindowReady(
    handler: (payload: DetachedTabWindowReadyPayload) => void,
): Promise<UnlistenFn> {
    return await listenRuntimeEvent(OFIVE_DETACHED_TAB_WINDOW_READY_EVENT, handler);
}
