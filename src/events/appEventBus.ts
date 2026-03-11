/**
 * @module events/appEventBus
 * @description 统一应用事件总线：负责桥接后端事件（fs/config）与前端事件（editor），并向业务模块提供单点订阅接口。
 * @dependencies
 *  - react (useEffect)
 *  - ../api/vaultApi
 *
 * @example
 *   useBackendEventBridge();
 *   const unlisten = subscribeVaultFsBusEvent((payload) => {
 *     console.info(payload.eventId, payload.eventType);
 *   });
 *
 * @exports
 *  - useBackendEventBridge: 在应用生命周期内挂载后端事件桥接
 *  - subscribeVaultFsBusEvent: 订阅统一总线中的 vault fs 事件
 *  - subscribeVaultConfigBusEvent: 订阅统一总线中的 vault config 事件
 *  - emitEditorContentChangedEvent: 发布前端编辑内容变化事件
 *  - emitEditorFocusChangedEvent: 发布前端编辑焦点变化事件
 *  - subscribeEditorContentBusEvent: 订阅前端编辑内容变化事件
 *  - subscribeEditorFocusBusEvent: 订阅前端编辑焦点变化事件
 *  - emitEditorRevealRequestedEvent: 发布编辑器定位请求事件
 *  - subscribeEditorRevealRequestedEvent: 订阅编辑器定位请求事件
 *  - emitPersistedContentUpdatedEvent: 发布持久态内容更新事件
 *  - subscribePersistedContentUpdatedEvent: 订阅持久态内容更新事件
 */

import { useEffect } from "react";
import type { VaultConfigEventPayload, VaultFsEventPayload } from "../api/vaultApi";

/**
 * @interface EditorContentChangedBusEvent
 * @description 前端编辑内容变化事件。
 */
export interface EditorContentChangedBusEvent {
    eventId: string;
    sourceTraceId: string | null;
    articleId: string;
    path: string;
    content: string;
    updatedAt: number;
}

/**
 * @interface EditorFocusChangedBusEvent
 * @description 前端编辑焦点变化事件。
 */
export interface EditorFocusChangedBusEvent {
    eventId: string;
    sourceTraceId: string | null;
    articleId: string;
    path: string;
    content: string;
    updatedAt: number;
}

/**
 * @interface EditorRenameRequestedBusEvent
 * @description 请求编辑器 Tab 进入文件名内联编辑模式的事件。
 * @field eventId - 事件唯一标识
 * @field articleId - 要进入重命名模式的文章 Tab ID
 */
export interface EditorRenameRequestedBusEvent {
    eventId: string;
    articleId: string;
}

/**
 * @interface EditorRevealRequestedBusEvent
 * @description 请求当前活跃编辑器定位到指定行的事件。
 * @field eventId - 事件唯一标识
 * @field articleId - 目标文章 ID（通常为当前活跃 tab id）
 * @field path - 目标文件相对路径
 * @field line - 目标行号（1-based）
 */
export interface EditorRevealRequestedBusEvent {
    eventId: string;
    articleId: string;
    path: string;
    line: number;
}

/**
 * @interface PersistedContentUpdatedBusEvent
 * @description 持久态内容更新事件：表示某个文件的持久化内容已变更。
 *   来源可能是：前端保存成功（source = "save"）或外部文件系统修改（source = "external"）。
 * @field eventId - 事件唯一标识
 * @field relativePath - 变更文件的相对路径
 * @field source - 变更来源："save" 表示前端保存成功，"external" 表示外部修改
 */
export interface PersistedContentUpdatedBusEvent {
    eventId: string;
    relativePath: string;
    source: "save" | "external";
}

type AppBusEventMap = {
    "vault.fs": VaultFsEventPayload;
    "vault.config": VaultConfigEventPayload;
    "editor.content.changed": EditorContentChangedBusEvent;
    "editor.focus.changed": EditorFocusChangedBusEvent;
    "editor.rename.requested": EditorRenameRequestedBusEvent;
    "editor.reveal.requested": EditorRevealRequestedBusEvent;
    "persisted.content.updated": PersistedContentUpdatedBusEvent;
};

const appEventTarget = new EventTarget();
let frontendEventSeq = 1;

let backendBridgeMountedCount = 0;
let backendFsUnlisten: (() => void) | null = null;
let backendConfigUnlisten: (() => void) | null = null;
let backendBridgeStartPromise: Promise<void> | null = null;

/**
 * @function nextFrontendEventId
 * @description 生成前端事件ID。
 * @returns 前端事件ID字符串。
 */
function nextFrontendEventId(): string {
    const eventId = `frontend-${frontendEventSeq}`;
    frontendEventSeq += 1;
    return eventId;
}

/**
 * @function dispatchBusEvent
 * @description 发布总线事件到统一 EventTarget。
 * @param eventType 事件类型。
 * @param payload 事件负载。
 */
function dispatchBusEvent<K extends keyof AppBusEventMap>(
    eventType: K,
    payload: AppBusEventMap[K],
): void {
    appEventTarget.dispatchEvent(
        new CustomEvent<AppBusEventMap[K]>(eventType, {
            detail: payload,
        }),
    );
}

/**
 * @function subscribeBusEvent
 * @description 订阅统一总线事件。
 * @param eventType 事件类型。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
function subscribeBusEvent<K extends keyof AppBusEventMap>(
    eventType: K,
    listener: (payload: AppBusEventMap[K]) => void,
): () => void {
    const handler = (event: Event): void => {
        const customEvent = event as CustomEvent<AppBusEventMap[K]>;
        listener(customEvent.detail);
    };

    appEventTarget.addEventListener(eventType, handler);
    return () => {
        appEventTarget.removeEventListener(eventType, handler);
    };
}

/**
 * @function startBackendBridgeIfNeeded
 * @description 启动后端事件桥接（单例）。
 * @returns Promise 完成信号。
 */
async function startBackendBridgeIfNeeded(): Promise<void> {
    if (backendFsUnlisten && backendConfigUnlisten) {
        return;
    }

    if (backendBridgeStartPromise) {
        await backendBridgeStartPromise;
        return;
    }

    backendBridgeStartPromise = (async () => {
        const { subscribeVaultFsEvents, subscribeVaultConfigEvents } = await import("../api/vaultApi");

        backendFsUnlisten = await subscribeVaultFsEvents((payload) => {
            dispatchBusEvent("vault.fs", payload);
        });

        backendConfigUnlisten = await subscribeVaultConfigEvents((payload) => {
            dispatchBusEvent("vault.config", payload);
        });
    })();

    try {
        await backendBridgeStartPromise;
    } finally {
        backendBridgeStartPromise = null;
    }
}

/**
 * @function stopBackendBridgeIfIdle
 * @description 在无订阅者时关闭后端桥接。
 */
function stopBackendBridgeIfIdle(): void {
    if (backendBridgeMountedCount > 0) {
        return;
    }

    if (backendFsUnlisten) {
        backendFsUnlisten();
        backendFsUnlisten = null;
    }

    if (backendConfigUnlisten) {
        backendConfigUnlisten();
        backendConfigUnlisten = null;
    }
}

/**
 * @function useBackendEventBridge
 * @description 在 React 生命周期中挂载后端事件桥接，保证全应用单点订阅。
 */
export function useBackendEventBridge(): void {
    useEffect(() => {
        let disposed = false;
        backendBridgeMountedCount += 1;

        void startBackendBridgeIfNeeded().catch((error) => {
            if (!disposed) {
                console.error("[app-event-bus] backend bridge start failed", {
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        });

        return () => {
            disposed = true;
            backendBridgeMountedCount = Math.max(0, backendBridgeMountedCount - 1);
            stopBackendBridgeIfIdle();
        };
    }, []);
}

/**
 * @function subscribeVaultFsBusEvent
 * @description 订阅统一总线中的后端文件系统事件。
 * @param listener 监听器。
 * @returns 取消订阅函数。
 */
export function subscribeVaultFsBusEvent(
    listener: (payload: VaultFsEventPayload) => void,
): () => void {
    return subscribeBusEvent("vault.fs", listener);
}

/**
 * @function subscribeVaultConfigBusEvent
 * @description 订阅统一总线中的后端配置文件事件。
 * @param listener 监听器。
 * @returns 取消订阅函数。
 */
export function subscribeVaultConfigBusEvent(
    listener: (payload: VaultConfigEventPayload) => void,
): () => void {
    return subscribeBusEvent("vault.config", listener);
}

/**
 * @function emitEditorContentChangedEvent
 * @description 发布前端编辑内容变化事件。
 * @param payload 事件负载（不含 eventId/sourceTraceId）。
 */
export function emitEditorContentChangedEvent(payload: {
    articleId: string;
    path: string;
    content: string;
    updatedAt: number;
}): void {
    dispatchBusEvent("editor.content.changed", {
        eventId: nextFrontendEventId(),
        sourceTraceId: null,
        ...payload,
    });
}

/**
 * @function emitEditorFocusChangedEvent
 * @description 发布前端编辑焦点变化事件。
 * @param payload 事件负载（不含 eventId/sourceTraceId）。
 */
export function emitEditorFocusChangedEvent(payload: {
    articleId: string;
    path: string;
    content: string;
    updatedAt: number;
}): void {
    dispatchBusEvent("editor.focus.changed", {
        eventId: nextFrontendEventId(),
        sourceTraceId: null,
        ...payload,
    });
}

/**
 * @function subscribeEditorContentBusEvent
 * @description 订阅前端编辑内容变化事件。
 * @param listener 监听器。
 * @returns 取消订阅函数。
 */
export function subscribeEditorContentBusEvent(
    listener: (payload: EditorContentChangedBusEvent) => void,
): () => void {
    return subscribeBusEvent("editor.content.changed", listener);
}

/**
 * @function subscribeEditorFocusBusEvent
 * @description 订阅前端编辑焦点变化事件。
 * @param listener 监听器。
 * @returns 取消订阅函数。
 */
export function subscribeEditorFocusBusEvent(
    listener: (payload: EditorFocusChangedBusEvent) => void,
): () => void {
    return subscribeBusEvent("editor.focus.changed", listener);
}

/**
 * @function emitEditorRenameRequestedEvent
 * @description 发布编辑器 Tab 进入文件名内联编辑模式的请求事件。
 * @param payload 事件负载，含目标 articleId。
 */
export function emitEditorRenameRequestedEvent(payload: {
    articleId: string;
}): void {
    dispatchBusEvent("editor.rename.requested", {
        eventId: nextFrontendEventId(),
        ...payload,
    });
}

/**
 * @function subscribeEditorRenameRequestedEvent
 * @description 订阅编辑器 Tab 重命名请求事件。
 * @param listener 监听器。
 * @returns 取消订阅函数。
 */
export function subscribeEditorRenameRequestedEvent(
    listener: (payload: EditorRenameRequestedBusEvent) => void,
): () => void {
    return subscribeBusEvent("editor.rename.requested", listener);
}

/**
 * @function emitEditorRevealRequestedEvent
 * @description 发布编辑器定位请求事件。
 * @param payload 事件负载，包含目标文章、路径和行号。
 */
export function emitEditorRevealRequestedEvent(payload: {
    articleId: string;
    path: string;
    line: number;
}): void {
    dispatchBusEvent("editor.reveal.requested", {
        eventId: nextFrontendEventId(),
        ...payload,
    });
}

/**
 * @function subscribeEditorRevealRequestedEvent
 * @description 订阅编辑器定位请求事件。
 * @param listener 监听器。
 * @returns 取消订阅函数。
 */
export function subscribeEditorRevealRequestedEvent(
    listener: (payload: EditorRevealRequestedBusEvent) => void,
): () => void {
    return subscribeBusEvent("editor.reveal.requested", listener);
}

/**
 * @function emitPersistedContentUpdatedEvent
 * @description 发布持久态内容更新事件。
 *   当前端保存成功或检测到外部文件修改时调用。
 * @param payload 事件负载（不含 eventId）。
 */
export function emitPersistedContentUpdatedEvent(payload: {
    relativePath: string;
    source: "save" | "external";
}): void {
    dispatchBusEvent("persisted.content.updated", {
        eventId: nextFrontendEventId(),
        ...payload,
    });
}

/**
 * @function subscribePersistedContentUpdatedEvent
 * @description 订阅持久态内容更新事件。
 *   读型组件（Outline、Graph、Search 等）应订阅此事件以刷新数据。
 * @param listener 监听器。
 * @returns 取消订阅函数。
 */
export function subscribePersistedContentUpdatedEvent(
    listener: (payload: PersistedContentUpdatedBusEvent) => void,
): () => void {
    return subscribeBusEvent("persisted.content.updated", listener);
}

// ────────── 仅用于测试的辅助函数 ──────────

/**
 * @function dispatchVaultFsBusEventForTest
 * @description 模拟后端 vault.fs 事件分发，仅用于测试。
 * @param payload vault.fs 事件负载。
 */
export function dispatchVaultFsBusEventForTest(
    payload: VaultFsEventPayload,
): void {
    dispatchBusEvent("vault.fs", payload);
}

/**
 * @function dispatchVaultConfigBusEventForTest
 * @description 模拟后端 vault.config 事件分发，仅用于测试。
 * @param payload vault.config 事件负载。
 */
export function dispatchVaultConfigBusEventForTest(
    payload: VaultConfigEventPayload,
): void {
    dispatchBusEvent("vault.config", payload);
}
