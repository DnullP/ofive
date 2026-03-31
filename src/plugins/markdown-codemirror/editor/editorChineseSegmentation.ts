/**
 * @module plugins/markdown-codemirror/editor/editorChineseSegmentation
 * @description 编辑器中文分词控制器：负责行级分词缓存、请求去重、悬停预取与删词语义。
 * @dependencies
 *  - codemirror
 *  - @codemirror/state
 *  - ./editorWordBoundaries
 *  - ../../../api/vaultApi
 *
 * @example
 *   const controller = createEditorChineseSegmentationController({
 *     articleId: "file:demo",
 *     segmentLine: segmentChineseText,
 *   });
 *   await controller.prefetchLineSegmentation(1, "中文测试");
 *
 * @exports
 *  - createEditorChineseSegmentationController: 创建编辑器分词控制器
 */

import type { EditorState } from "@codemirror/state";
import { EditorView } from "codemirror";
import type { ChineseSegmentToken } from "../../../api/vaultApi";
import {
    containsChineseCharacter,
    getWordObjectRange,
    resolveChinesePreviousWordBoundary,
    resolveEnglishPreviousWordBoundary,
} from "./editorWordBoundaries";

/**
 * @interface SegmentationCacheItem
 * @description 行分词缓存条目。
 */
interface SegmentationCacheItem {
    /** 当前缓存对应的行文本。 */
    text: string;
    /** 当前缓存对应的分词结果。 */
    tokens: ChineseSegmentToken[];
}

/**
 * @interface SegmentationPendingItem
 * @description 行分词中的请求条目，用于去重并复用同一行的分词请求。
 */
interface SegmentationPendingItem {
    /** 当前请求对应的行文本。 */
    text: string;
    /** 当前请求 Promise。 */
    promise: Promise<ChineseSegmentToken[] | null>;
}

/**
 * @interface CreateEditorChineseSegmentationControllerOptions
 * @description 创建编辑器分词控制器所需的参数。
 */
export interface CreateEditorChineseSegmentationControllerOptions {
    /** 当前文章 id，仅用于日志与诊断。 */
    articleId: string;
    /** 实际执行后端分词的函数。 */
    segmentLine: (lineText: string) => Promise<ChineseSegmentToken[]>;
}

/**
 * @interface EditorChineseSegmentationController
 * @description 编辑器分词控制器暴露给宿主的能力集合。
 */
export interface EditorChineseSegmentationController {
    /** 清理定时器与 pending 请求。 */
    clearPendingSegmentation(): void;
    /** 同步读取缓存，缓存未命中时触发后台请求。 */
    getLineTokens(lineNumber: number, lineText: string): ChineseSegmentToken[] | null;
    /** 预取指定行的分词结果。 */
    prefetchLineSegmentation(lineNumber: number, lineText: string): Promise<ChineseSegmentToken[] | null>;
    /** 为当前选中行安排延迟预取。 */
    scheduleActiveLineSegmentation(state: EditorState): void;
    /** 根据鼠标位置预取当前行分词。 */
    prefetchSegmentationAtMouseEvent(view: EditorView, event: MouseEvent): void;
    /** 在鼠标位置尝试按词选中。 */
    trySelectWordAtMouseEvent(view: EditorView, event: MouseEvent): boolean;
    /** 执行中英文混合删词。 */
    executeSegmentedDeleteBackward(view: EditorView): Promise<void>;
}

/**
 * @function resolveLineAtMouseEvent
 * @description 根据鼠标事件解析所在行与行内偏移。
 * @param view 编辑器视图。
 * @param event 鼠标事件。
 * @returns 命中的行信息；命中失败时返回 null。
 */
function resolveLineAtMouseEvent(
    view: EditorView,
    event: MouseEvent,
): { lineNumber: number; lineText: string; lineFrom: number; lineOffset: number } | null {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) {
        return null;
    }

    const line = view.state.doc.lineAt(pos);
    return {
        lineNumber: line.number,
        lineText: line.text,
        lineFrom: line.from,
        lineOffset: pos - line.from,
    };
}

/**
 * @function createEditorChineseSegmentationController
 * @description 创建编辑器分词控制器。
 * @param options 控制器创建参数。
 * @returns 分词控制器实例。
 */
export function createEditorChineseSegmentationController(
    options: CreateEditorChineseSegmentationControllerOptions,
): EditorChineseSegmentationController {
    const segmentationCache = new Map<number, SegmentationCacheItem>();
    const segmentationPending = new Map<number, SegmentationPendingItem>();
    let segmentationTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const readCachedLineTokens = (
        lineNumber: number,
        lineText: string,
    ): ChineseSegmentToken[] | null => {
        const cacheItem = segmentationCache.get(lineNumber);
        if (cacheItem && cacheItem.text === lineText) {
            return cacheItem.tokens;
        }

        return null;
    };

    const prefetchLineSegmentation = (
        lineNumber: number,
        lineText: string,
    ): Promise<ChineseSegmentToken[] | null> => {
        if (!containsChineseCharacter(lineText)) {
            return Promise.resolve(null);
        }

        const cachedTokens = readCachedLineTokens(lineNumber, lineText);
        if (cachedTokens) {
            return Promise.resolve(cachedTokens);
        }

        const pendingItem = segmentationPending.get(lineNumber);
        if (pendingItem && pendingItem.text === lineText) {
            return pendingItem.promise;
        }

        let requestPromise: Promise<ChineseSegmentToken[] | null>;
        requestPromise = options.segmentLine(lineText)
            .then((tokens) => {
                segmentationCache.set(lineNumber, {
                    text: lineText,
                    tokens,
                });
                console.debug("[editor] segmented line", {
                    articleId: options.articleId,
                    lineNumber,
                    tokenCount: tokens.length,
                });
                return tokens;
            })
            .catch((error) => {
                console.warn("[editor] segment line failed", {
                    articleId: options.articleId,
                    lineNumber,
                    message: error instanceof Error ? error.message : String(error),
                });
                return null;
            })
            .finally(() => {
                const latestPendingItem = segmentationPending.get(lineNumber);
                if (latestPendingItem?.promise === requestPromise) {
                    segmentationPending.delete(lineNumber);
                }
            });

        segmentationPending.set(lineNumber, {
            text: lineText,
            promise: requestPromise,
        });

        return requestPromise;
    };

    const clearPendingSegmentation = (): void => {
        if (segmentationTimer !== null) {
            globalThis.clearTimeout(segmentationTimer);
            segmentationTimer = null;
        }
        segmentationPending.clear();
    };

    const scheduleActiveLineSegmentation = (state: EditorState): void => {
        if (segmentationTimer !== null) {
            globalThis.clearTimeout(segmentationTimer);
        }

        segmentationTimer = globalThis.setTimeout(() => {
            const activeLine = state.doc.lineAt(state.selection.main.head);
            void prefetchLineSegmentation(activeLine.number, activeLine.text);
        }, 120);
    };

    const getLineTokens = (
        lineNumber: number,
        lineText: string,
    ): ChineseSegmentToken[] | null => {
        const cachedTokens = readCachedLineTokens(lineNumber, lineText);
        if (cachedTokens) {
            return cachedTokens;
        }

        void prefetchLineSegmentation(lineNumber, lineText);
        return null;
    };

    const getOrRequestLineTokens = async (
        lineNumber: number,
        lineText: string,
    ): Promise<ChineseSegmentToken[] | null> => {
        const cachedTokens = readCachedLineTokens(lineNumber, lineText);
        if (cachedTokens) {
            return cachedTokens;
        }

        if (!containsChineseCharacter(lineText)) {
            return null;
        }

        return prefetchLineSegmentation(lineNumber, lineText);
    };

    const prefetchSegmentationAtMouseEvent = (view: EditorView, event: MouseEvent): void => {
        const lineInfo = resolveLineAtMouseEvent(view, event);
        if (!lineInfo) {
            return;
        }

        void prefetchLineSegmentation(lineInfo.lineNumber, lineInfo.lineText);
    };

    const trySelectWordAtMouseEvent = (view: EditorView, event: MouseEvent): boolean => {
        const lineInfo = resolveLineAtMouseEvent(view, event);
        if (!lineInfo) {
            return false;
        }

        const tokens = readCachedLineTokens(lineInfo.lineNumber, lineInfo.lineText);
        const range = getWordObjectRange(
            lineInfo.lineText,
            lineInfo.lineOffset,
            tokens,
            false,
        );
        if (!range) {
            return false;
        }

        view.dispatch({
            selection: {
                anchor: lineInfo.lineFrom + range.start,
                head: lineInfo.lineFrom + range.end,
            },
            scrollIntoView: true,
        });
        return true;
    };

    const executeSegmentedDeleteBackward = async (view: EditorView): Promise<void> => {
        const selection = view.state.selection.main;

        if (!selection.empty) {
            view.dispatch({
                changes: {
                    from: selection.from,
                    to: selection.to,
                    insert: "",
                },
                selection: {
                    anchor: selection.from,
                },
            });
            return;
        }

        const cursor = selection.head;
        if (cursor <= 0) {
            return;
        }

        const line = view.state.doc.lineAt(cursor);
        const lineOffset = cursor - line.from;
        if (lineOffset <= 0) {
            view.dispatch({
                changes: {
                    from: cursor - 1,
                    to: cursor,
                    insert: "",
                },
                selection: {
                    anchor: cursor - 1,
                },
            });
            return;
        }

        const previousChar = line.text.charAt(lineOffset - 1);
        const lineTokens = containsChineseCharacter(previousChar)
            ? await getOrRequestLineTokens(line.number, line.text)
            : null;

        const deleteFromOffset = containsChineseCharacter(previousChar)
            ? resolveChinesePreviousWordBoundary(line.text, lineOffset, lineTokens)
            : resolveEnglishPreviousWordBoundary(line.text, lineOffset);

        const safeFromOffset = Math.max(0, Math.min(deleteFromOffset, lineOffset));
        if (safeFromOffset === lineOffset) {
            return;
        }

        const deleteFrom = line.from + safeFromOffset;
        view.dispatch({
            changes: {
                from: deleteFrom,
                to: cursor,
                insert: "",
            },
            selection: {
                anchor: deleteFrom,
            },
        });
    };

    return {
        clearPendingSegmentation,
        getLineTokens,
        prefetchLineSegmentation,
        scheduleActiveLineSegmentation,
        prefetchSegmentationAtMouseEvent,
        trySelectWordAtMouseEvent,
        executeSegmentedDeleteBackward,
    };
}