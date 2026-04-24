/**
 * @module host/editor/editorViewStateStore
 * @description 记录编辑器运行时视图状态（选区与滚动位置），用于在主区 tab 被卸载重建后恢复阅读进度。
 */

import type { StateEffect } from "@codemirror/state";

/**
 * @interface EditorViewStateSnapshot
 * @description 单个编辑器实例最近一次记录的视图快照。
 */
export interface EditorViewStateSnapshot {
    /** 对应文章 ID（通常等于 tab id）。 */
    articleId: string;
    /** 主选区 anchor。 */
    anchor: number;
    /** 主选区 head。 */
    head: number;
    /** 垂直滚动位置。 */
    scrollTop: number;
    /** 水平滚动位置。 */
    scrollLeft: number;
    /** CodeMirror 原生滚动快照，用于无闪烁恢复滚动位置。 */
    scrollSnapshot: StateEffect<unknown> | null;
    /** 最后更新时间。 */
    updatedAt: number;
}

class EditorViewStateStore {
    private snapshots = new Map<string, EditorViewStateSnapshot>();

    get(articleId: string): EditorViewStateSnapshot | null {
        return this.snapshots.get(articleId) ?? null;
    }

    save(snapshot: Omit<EditorViewStateSnapshot, "updatedAt">): void {
        this.snapshots.set(snapshot.articleId, {
            ...snapshot,
            updatedAt: Date.now(),
        });
    }

    clear(articleId: string): void {
        this.snapshots.delete(articleId);
    }

    reset(): void {
        this.snapshots.clear();
    }
}

const editorViewStateStore = new EditorViewStateStore();

/**
 * @function getEditorViewStateSnapshot
 * @description 读取指定文章最近一次记录的视图状态。
 * @param articleId 文章 ID。
 * @returns 视图状态快照；未命中时返回 null。
 */
export function getEditorViewStateSnapshot(articleId: string): EditorViewStateSnapshot | null {
    return editorViewStateStore.get(articleId);
}

/**
 * @function saveEditorViewStateSnapshot
 * @description 保存指定文章的最新视图状态。
 * @param snapshot 视图状态。
 */
export function saveEditorViewStateSnapshot(
    snapshot: Omit<EditorViewStateSnapshot, "updatedAt">,
): void {
    editorViewStateStore.save(snapshot);
}

/**
 * @function clearEditorViewStateSnapshot
 * @description 清理指定文章的视图状态缓存。
 * @param articleId 文章 ID。
 */
export function clearEditorViewStateSnapshot(articleId: string): void {
    editorViewStateStore.clear(articleId);
}

/**
 * @function resetEditorViewStateSnapshots
 * @description 清空全部编辑器视图状态缓存。
 */
export function resetEditorViewStateSnapshots(): void {
    editorViewStateStore.reset();
}