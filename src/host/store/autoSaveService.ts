/**
 * @module host/store/autoSaveService
 * @description 自动保存服务：监听编辑器内容变化事件，通过防抖策略自动将修改持久化到后端。
 * @dependencies
 *  - ../events/appEventBus (subscribeEditorContentBusEvent)
 *  - ../../api/vaultApi (saveVaultMarkdownFile)
 *  - ./configStore (subscribeConfigChanges)
 *
 * @example
 *   import { startAutoSaveService, stopAutoSaveService } from "../host/store/autoSaveService";
 *
 *   // 应用启动后挂载
 *   startAutoSaveService();
 *
 *   // 应用卸载时停止
 *   stopAutoSaveService();
 *
 * @exports
 *  - startAutoSaveService: 启动自动保存服务（订阅事件并开始调度）
 *  - stopAutoSaveService: 停止自动保存服务（取消订阅并清理定时器）
 *  - flushAutoSave: 立即保存所有待保存内容（用于编辑器失焦或应用退出前）
 *  - useAutoSaveLifecycle: React Hook，在组件挂载时启动，卸载时停止
 *  - getAutoSaveServiceState: 获取当前服务内部状态快照（仅测试/调试用）
 *
 * @state
 *  - running - 服务是否正在运行 (boolean) [false]
 *  - pendingPaths - 有待保存内容的文件路径集合 (Set<string>)
 *  - lastSavedContentMap - 每个路径最后成功保存的内容 (Map<string, string>)
 *
 * @lifecycle
 *  - 初始化时机：App 组件挂载后调用 startAutoSaveService
 *  - 数据来源：editor.content.changed 事件
 *  - 更新触发：编辑器内容变化时记录待保存状态，防抖到期后执行保存
 *  - 清理时机：App 组件卸载时调用 stopAutoSaveService
 *
 * @sync
 *  - 与后端同步：通过 saveVaultMarkdownFile 写入后端
 *  - 缓存策略：内存中缓存 lastSavedContent 与 pendingContent，不持久化
 *  - 与其他 Store 的关系：读取 configStore 的 autoSaveEnabled / autoSaveDelayMs 配置
 */

import { useEffect } from "react";
import {
    subscribeEditorContentBusEvent,
    emitPersistedContentUpdatedEvent,
    type EditorContentChangedBusEvent,
} from "../events/appEventBus";
import { saveVaultMarkdownFile } from "../../api/vaultApi";
import { subscribeConfigChanges } from "./configStore";

// ────────── 常量 ──────────

/**
 * @constant DEFAULT_AUTO_SAVE_DELAY_MS
 * @description 默认自动保存防抖延迟（毫秒）。
 */
const DEFAULT_AUTO_SAVE_DELAY_MS = 1500;

/**
 * @constant MAX_AUTO_SAVE_INTERVAL_MS
 * @description 最大自动保存间隔（毫秒）：用户持续输入时，不超过此时间必须保存一次。
 */
const MAX_AUTO_SAVE_INTERVAL_MS = 10_000;

// ────────── 内部状态 ──────────

/**
 * @interface PendingEntry
 * @description 待保存条目，记录某路径的最新内容和调度状态。
 * @field path - 文件相对路径
 * @field content - 待保存的最新内容
 * @field debounceTimer - 防抖定时器 ID（null 表示无等待中的定时器）
 * @field firstDirtyAt - 本轮首次变脏时间戳，用于计算最大间隔
 */
interface PendingEntry {
    /** 文件相对路径 */
    path: string;
    /** 待保存的最新内容 */
    content: string;
    /** 防抖定时器 ID */
    debounceTimer: number | null;
    /** 本轮首次变脏时间戳 */
    firstDirtyAt: number;
}

/** 服务运行状态 */
let running = false;

/** 事件取消订阅函数 */
let unsubscribeContentEvent: (() => void) | null = null;

/** 配置变更取消订阅函数 */
let unsubscribeConfigEvent: (() => void) | null = null;

/** 是否启用自动保存 */
let autoSaveEnabled = true;

/** 防抖延迟（毫秒） */
let autoSaveDelayMs = DEFAULT_AUTO_SAVE_DELAY_MS;

/** 按路径索引的待保存条目 */
const pendingMap = new Map<string, PendingEntry>();

/** 按路径索引的最后成功保存内容 */
const lastSavedContentMap = new Map<string, string>();

// ────────── 核心逻辑 ──────────

/**
 * @function isMarkdownPath
 * @description 判断路径是否为 Markdown 文件。
 * @param path 文件相对路径。
 * @returns 是否为 .md / .markdown 文件。
 */
function isMarkdownPath(path: string): boolean {
    return path.endsWith(".md") || path.endsWith(".markdown");
}

/**
 * @function executeSave
 * @description 执行单个路径的保存操作。若内容与上次保存一致则跳过。
 * @param path 文件相对路径。
 * @param content 要保存的内容。
 * @sideEffects 调用后端 saveVaultMarkdownFile，更新 lastSavedContentMap。
 */
async function executeSave(path: string, content: string): Promise<void> {
    const lastSaved = lastSavedContentMap.get(path);
    if (lastSaved === content) {
        console.debug("[auto-save] skip unchanged content", { path });
        return;
    }

    try {
        await saveVaultMarkdownFile(path, content);
        lastSavedContentMap.set(path, content);
        console.info("[auto-save] saved", {
            path,
            bytes: content.length,
        });
        emitPersistedContentUpdatedEvent({ relativePath: path, source: "save" });
    } catch (error) {
        console.error("[auto-save] save failed", {
            path,
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * @function clearPendingTimer
 * @description 清除指定条目的防抖定时器。
 * @param entry 待保存条目。
 */
function clearPendingTimer(entry: PendingEntry): void {
    if (entry.debounceTimer !== null) {
        clearTimeout(entry.debounceTimer);
        entry.debounceTimer = null;
    }
}

/**
 * @function flushEntry
 * @description 立即保存某个路径的待保存内容并清理条目。
 * @param path 文件相对路径。
 * @sideEffects 清除定时器，从 pendingMap 中移除条目，调用 executeSave。
 */
async function flushEntry(path: string): Promise<void> {
    const entry = pendingMap.get(path);
    if (!entry) {
        return;
    }

    clearPendingTimer(entry);
    pendingMap.delete(path);

    await executeSave(entry.path, entry.content);
}

/**
 * @function scheduleSave
 * @description 为指定路径调度一次防抖保存。若距首次变脏已超过最大间隔则立即保存。
 * @param path 文件相对路径。
 * @param content 最新文件内容。
 * @sideEffects 创建/更新 pendingMap 中的条目，设置防抖定时器。
 */
function scheduleSave(path: string, content: string): void {
    const existing = pendingMap.get(path);
    const now = Date.now();

    if (existing) {
        clearPendingTimer(existing);

        // 若距首次变脏超过最大间隔，立即保存
        if (now - existing.firstDirtyAt >= MAX_AUTO_SAVE_INTERVAL_MS) {
            existing.content = content;
            pendingMap.delete(path);
            console.info("[auto-save] max interval reached, flushing", { path });
            void executeSave(path, content).then(() => {
                // 保存完成后重置 firstDirtyAt（如果该路径再次变脏会在下次事件里创建新条目）
            });
            return;
        }

        existing.content = content;
        existing.debounceTimer = setTimeout(() => {
            void flushEntry(path);
        }, autoSaveDelayMs) as unknown as number;
    } else {
        // 首次变脏：检查与上次保存内容是否一致
        const lastSaved = lastSavedContentMap.get(path);
        if (lastSaved === content) {
            console.debug("[auto-save] skip scheduling unchanged content", { path });
            return;
        }

        const entry: PendingEntry = {
            path,
            content,
            firstDirtyAt: now,
            debounceTimer: setTimeout(() => {
                void flushEntry(path);
            }, autoSaveDelayMs) as unknown as number,
        };
        pendingMap.set(path, entry);
    }
}

/**
 * @function handleContentChanged
 * @description 处理编辑器内容变化事件。
 * @param event 内容变化事件负载。
 * @sideEffects 若自动保存已启用且路径为 Markdown 文件，则调度保存。
 */
function handleContentChanged(event: EditorContentChangedBusEvent): void {
    if (!autoSaveEnabled) {
        return;
    }

    if (!isMarkdownPath(event.path)) {
        return;
    }

    scheduleSave(event.path, event.content);
}

/**
 * @function syncConfigState
 * @description 同步来自 configStore 的自动保存配置。
 * @param featureSettings 功能配置快照。
 * @sideEffects 更新模块级 autoSaveEnabled / autoSaveDelayMs 变量。
 */
function syncConfigState(featureSettings: {
    autoSaveEnabled?: boolean;
    autoSaveDelayMs?: number;
}): void {
    const nextEnabled = featureSettings.autoSaveEnabled ?? true;
    const nextDelay = featureSettings.autoSaveDelayMs ?? DEFAULT_AUTO_SAVE_DELAY_MS;

    if (nextEnabled !== autoSaveEnabled) {
        console.info("[auto-save] enabled changed", {
            from: autoSaveEnabled,
            to: nextEnabled,
        });
        autoSaveEnabled = nextEnabled;

        // 若被关闭，清理所有待保存条目
        if (!autoSaveEnabled) {
            clearAllPending();
        }
    }

    if (nextDelay !== autoSaveDelayMs) {
        console.info("[auto-save] delay changed", {
            from: autoSaveDelayMs,
            to: nextDelay,
        });
        autoSaveDelayMs = nextDelay;
    }
}

/**
 * @function clearAllPending
 * @description 清除所有待保存条目的定时器并清空 pendingMap（不保存）。
 */
function clearAllPending(): void {
    pendingMap.forEach((entry) => {
        clearPendingTimer(entry);
    });
    pendingMap.clear();
}

// ────────── 公开接口 ──────────

/**
 * @function startAutoSaveService
 * @description 启动自动保存服务：订阅编辑器内容变化事件和配置变更事件。
 * @sideEffects 设置 running = true，绑定事件订阅。
 * @throws 无。若已在运行则忽略。
 */
export function startAutoSaveService(): void {
    if (running) {
        console.warn("[auto-save] service already running, skip start");
        return;
    }

    running = true;

    unsubscribeContentEvent = subscribeEditorContentBusEvent(handleContentChanged);

    unsubscribeConfigEvent = subscribeConfigChanges((state) => {
        syncConfigState(state.featureSettings);
    });

    console.info("[auto-save] service started", {
        autoSaveEnabled,
        autoSaveDelayMs,
    });
}

/**
 * @function stopAutoSaveService
 * @description 停止自动保存服务：取消事件订阅，立即保存所有待保存内容，清理状态。
 * @sideEffects 设置 running = false，清理订阅和定时器，flush 所有待保存项。
 */
export function stopAutoSaveService(): void {
    if (!running) {
        return;
    }

    running = false;

    if (unsubscribeContentEvent) {
        unsubscribeContentEvent();
        unsubscribeContentEvent = null;
    }

    if (unsubscribeConfigEvent) {
        unsubscribeConfigEvent();
        unsubscribeConfigEvent = null;
    }

    // 停止前 flush 所有待保存内容
    const flushing = Array.from(pendingMap.keys()).map((path) => flushEntry(path));
    void Promise.all(flushing).then(() => {
        console.info("[auto-save] service stopped, all pending flushed");
    });

    // 清理内部缓存
    lastSavedContentMap.clear();
}

/**
 * @function flushAutoSave
 * @description 立即保存所有待保存文件内容。适用于编辑器失焦、Tab 切换、应用退出前等场景。
 * @returns Promise，所有保存完成后 resolve。
 * @sideEffects 清空 pendingMap，逐一调用后端保存。
 */
export async function flushAutoSave(): Promise<void> {
    const paths = Array.from(pendingMap.keys());
    if (paths.length === 0) {
        return;
    }

    console.info("[auto-save] flush requested", { pathCount: paths.length });
    await Promise.all(paths.map((path) => flushEntry(path)));
}

/**
 * @function flushAutoSaveByPath
 * @description 立即保存指定路径的待保存内容。适用于单个编辑器失焦场景。
 * @param path 文件相对路径。
 * @returns Promise，保存完成后 resolve。
 * @sideEffects 从 pendingMap 中移除条目，调用后端保存。
 */
export async function flushAutoSaveByPath(path: string): Promise<void> {
    if (!pendingMap.has(path)) {
        return;
    }

    console.info("[auto-save] flush by path", { path });
    await flushEntry(path);
}

/**
 * @function markContentAsSaved
 * @description 标记指定路径的内容为已保存状态（用于手动 Cmd+S 保存后同步状态）。
 * @param path 文件相对路径。
 * @param content 已保存的内容。
 * @sideEffects 更新 lastSavedContentMap，若 pendingMap 中有同内容条目则清除。
 */
export function markContentAsSaved(path: string, content: string): void {
    lastSavedContentMap.set(path, content);

    const pending = pendingMap.get(path);
    if (pending && pending.content === content) {
        clearPendingTimer(pending);
        pendingMap.delete(path);
        console.debug("[auto-save] pending cleared after manual save", { path });
    }
}

/**
 * @function useAutoSaveLifecycle
 * @description React Hook：在组件挂载时启动自动保存服务，卸载时停止。
 * @sideEffects 挂载时调用 startAutoSaveService，卸载时调用 stopAutoSaveService。
 */
export function useAutoSaveLifecycle(): void {
    useEffect(() => {
        startAutoSaveService();
        return () => {
            stopAutoSaveService();
        };
    }, []);
}

// ────────── 测试/调试辅助 ──────────

/**
 * @interface AutoSaveServiceState
 * @description 自动保存服务内部状态快照（仅供测试和调试使用）。
 * @field running - 服务是否运行中
 * @field autoSaveEnabled - 自动保存是否启用
 * @field autoSaveDelayMs - 当前防抖延迟
 * @field pendingPaths - 待保存路径列表
 * @field lastSavedPaths - 已记录最后保存内容的路径列表
 */
export interface AutoSaveServiceState {
    /** 服务是否运行中 */
    running: boolean;
    /** 自动保存是否启用 */
    autoSaveEnabled: boolean;
    /** 当前防抖延迟 */
    autoSaveDelayMs: number;
    /** 待保存路径列表 */
    pendingPaths: string[];
    /** 已记录最后保存内容的路径列表 */
    lastSavedPaths: string[];
}

/**
 * @function getAutoSaveServiceState
 * @description 获取自动保存服务内部状态快照，仅用于测试和调试。
 * @returns 服务内部状态快照。
 */
export function getAutoSaveServiceState(): AutoSaveServiceState {
    return {
        running,
        autoSaveEnabled,
        autoSaveDelayMs,
        pendingPaths: Array.from(pendingMap.keys()),
        lastSavedPaths: Array.from(lastSavedContentMap.keys()),
    };
}
