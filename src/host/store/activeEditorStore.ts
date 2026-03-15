/**
 * @module host/store/activeEditorStore
 * @description 当前活跃编辑器状态管理：记录主工作区中当前活跃的 Markdown 编辑器及其对应笔记。
 *
 *   该 Store 与 focusContext 的 DOM 焦点语义不同，专门回答：
 *   - 当前活跃的 editor tab 是哪个？
 *   - 该 editor 对应哪篇 Markdown 笔记？
 *
 *   典型消费者包括 Outline、Backlinks 等“跟随当前活跃笔记”的只读型插件。
 *
 * @dependencies
 *  - react (useSyncExternalStore)
 *
 * @example
 *   reportActiveEditor({
 *     articleId: "file:notes/demo.md",
 *     path: "notes/demo.md",
 *   });
 *
 *   const activeEditor = useActiveEditor();
 *
 * @exports
 *  - ActiveEditorState: 活跃编辑器快照
 *  - reportActiveEditor: 上报当前活跃 Markdown 编辑器
 *  - clearActiveEditor: 清空当前活跃编辑器
 *  - useActiveEditor: React Hook，订阅活跃编辑器状态
 *  - getActiveEditorSnapshot: 非响应式读取当前活跃编辑器
 */

import { useSyncExternalStore } from "react";

/**
 * @interface ActiveEditorState
 * @description 当前活跃 Markdown 编辑器的状态快照。
 */
export interface ActiveEditorState {
    /** 对应文章 ID（通常等于 dockview tab id） */
    articleId: string;
    /** 对应 Markdown 相对路径 */
    path: string;
    /** 文件标题（通常为文件名） */
    title: string;
    /** 编辑器类型，当前固定为 markdown */
    kind: "markdown";
    /** 最后更新时间戳 */
    updatedAt: number;
}

/**
 * @class ActiveEditorStore
 * @description 维护当前活跃 Markdown 编辑器的全局状态。
 *
 * @state
 *  - activeEditor - 当前活跃编辑器快照 (ActiveEditorState | null) [null]
 *
 * @lifecycle
 *  - 初始化时机：模块首次导入时初始化
 *  - 数据来源：DockviewLayout 的主区标签激活变化
 *  - 更新触发：主区活跃标签切换到 Markdown 编辑器、或失活/切换到非 Markdown 标签
 *  - 清理时机：无活跃 Markdown 编辑器时置空
 *
 * @sync
 *  - 与后端同步：否，仅前端运行时状态
 *  - 缓存策略：内存态，页面刷新后重置
 *  - 与其他 Store 的关系：为 Outline、Backlinks 等跟随当前活跃笔记的组件提供状态来源
 */
class ActiveEditorStore {
    private activeEditor: ActiveEditorState | null = null;

    private listeners = new Set<() => void>();

    /**
     * @function subscribe
     * @description 订阅状态变化。
     * @param listener 订阅回调。
     * @returns 取消订阅函数。
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * @function emit
     * @description 广播状态更新。
     */
    private emit(): void {
        this.listeners.forEach((listener) => listener());
    }

    /**
     * @function getSnapshot
     * @description 获取当前活跃编辑器快照。
     * @returns 当前活跃编辑器或 null。
     */
    getSnapshot(): ActiveEditorState | null {
        return this.activeEditor;
    }

    /**
     * @function reportActiveEditor
     * @description 上报当前活跃的 Markdown 编辑器。
     * @param payload 活跃编辑器信息。
     */
    reportActiveEditor(payload: {
        articleId: string;
        path: string;
    }): void {
        const title = payload.path.split("/").pop() ?? payload.path;
        const nextState: ActiveEditorState = {
            articleId: payload.articleId,
            path: payload.path,
            title,
            kind: "markdown",
            updatedAt: Date.now(),
        };

        if (
            this.activeEditor?.articleId === nextState.articleId
            && this.activeEditor.path === nextState.path
        ) {
            return;
        }

        this.activeEditor = nextState;
        console.info("[activeEditorStore] active editor updated", {
            articleId: nextState.articleId,
            path: nextState.path,
        });
        this.emit();
    }

    /**
     * @function clearActiveEditor
     * @description 清空当前活跃编辑器状态。
     */
    clearActiveEditor(): void {
        if (!this.activeEditor) {
            return;
        }

        console.info("[activeEditorStore] active editor cleared", {
            articleId: this.activeEditor.articleId,
            path: this.activeEditor.path,
        });
        this.activeEditor = null;
        this.emit();
    }
}

const activeEditorStore = new ActiveEditorStore();

/**
 * @function reportActiveEditor
 * @description 对外暴露：上报当前活跃 Markdown 编辑器。
 * @param payload 活跃编辑器信息。
 */
export function reportActiveEditor(payload: {
    articleId: string;
    path: string;
}): void {
    activeEditorStore.reportActiveEditor(payload);
}

/**
 * @function clearActiveEditor
 * @description 对外暴露：清空当前活跃编辑器状态。
 */
export function clearActiveEditor(): void {
    activeEditorStore.clearActiveEditor();
}

/**
 * @function useActiveEditor
 * @description React Hook：订阅当前活跃 Markdown 编辑器状态。
 * @returns 当前活跃编辑器或 null。
 */
export function useActiveEditor(): ActiveEditorState | null {
    return useSyncExternalStore(
        (listener) => activeEditorStore.subscribe(listener),
        () => activeEditorStore.getSnapshot(),
        () => activeEditorStore.getSnapshot(),
    );
}

/**
 * @function getActiveEditorSnapshot
 * @description 非响应式读取当前活跃 Markdown 编辑器状态。
 * @returns 当前活跃编辑器或 null。
 */
export function getActiveEditorSnapshot(): ActiveEditorState | null {
    return activeEditorStore.getSnapshot();
}