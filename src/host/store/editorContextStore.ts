/**
 * @module host/store/editorContextStore
 * @description 前端全局编辑上下文状态管理：用于跨组件共享“当前聚焦文章”和文章内容。
 * @dependencies
 *  - react (useSyncExternalStore)
 *
 * @example
 *   import { reportArticleFocus, reportArticleContent, useFocusedArticle } from "../host/store/editorContextStore";
 *
 *   reportArticleFocus({ articleId: "file:1", path: "test-resources/notes/guide.md", content: "# Guide" });
 *   reportArticleContent({ articleId: "file:1", content: "# Guide\n\nupdated" });
 *
 *   const focused = useFocusedArticle();
 *
 * @exports
 *  - reportArticleFocus: 上报当前被聚焦文章
 *  - reportArticleContent: 上报文章内容变更
 *  - useFocusedArticle: 订阅当前聚焦文章
 */

import { useSyncExternalStore } from "react";
import {
    emitEditorContentChangedEvent,
    emitEditorFocusChangedEvent,
} from "../events/appEventBus";

/**
 * @interface ArticleState
 * @description 单篇文章在前端运行时的状态快照。
 */
export interface ArticleState {
    /** 文章唯一标识（通常使用 tab id） */
    articleId: string;
    /** 文章路径 */
    path: string;
    /** 文章标题 */
    title: string;
    /** 当前最新内容 */
    content: string;
    /** 内容是否为可靠快照（由内容事件或带 content 的 focus 事件提供） */
    hasContentSnapshot: boolean;
    /** 最后更新时间戳 */
    updatedAt: number;
}

/**
 * @interface EditorContextState
 * @description 编辑上下文全局状态。
 */
interface EditorContextState {
    focusedArticleId: string | null;
    articles: Map<string, ArticleState>;
}

/**
 * @interface ArticleFocusPayload
 * @description 文章聚焦上报参数。
 */
interface ArticleFocusPayload {
    articleId: string;
    path: string;
    content?: string;
}

/**
 * @interface ArticleContentPayload
 * @description 文章内容上报参数。
 */
interface ArticleContentPayload {
    articleId: string;
    content: string;
    path?: string;
}

/**
 * @class EditorContextStore
 * @description 维护编辑器全局上下文，支持跨组件订阅。
 *
 * @state
 *  - focusedArticleId - 当前聚焦文章ID (string | null) [null]
 *  - articles - 文章状态映射 (Map<string, ArticleState>) [空Map]
 *
 * @lifecycle
 *  - 初始化时机：模块首次被导入时初始化
 *  - 数据来源：由编辑器组件上报（focus/content）
 *  - 更新触发：编辑器焦点变化、编辑器内容变化
 *  - 清理时机：页面刷新或模块卸载时重置
 *
 * @sync
 *  - 与后端同步：当前未直接同步后端，仅前端内存态
 *  - 缓存策略：以内存Map缓存，页面刷新即失效
 *  - 与其他Store的关系：为 Outline 等消费组件提供依赖状态
 */
class EditorContextStore {
    private state: EditorContextState = {
        focusedArticleId: null,
        articles: new Map<string, ArticleState>(),
    };

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
     * @description 读取当前状态快照。
     * @returns 当前状态。
     */
    getSnapshot(): EditorContextState {
        return this.state;
    }

    /**
     * @function reportArticleFocus
     * @description 上报文章聚焦事件，会更新 focusedArticleId 并写入文章快照。
     * @param payload 聚焦上报数据。
     */
    reportArticleFocus(payload: ArticleFocusPayload): void {
        const existing = this.state.articles.get(payload.articleId);
        const nextPath = payload.path || existing?.path || payload.articleId;
        const title = nextPath.split("/").pop() ?? nextPath;
        const nextArticle: ArticleState = {
            articleId: payload.articleId,
            path: nextPath,
            title,
            content: payload.content ?? existing?.content ?? "",
            hasContentSnapshot: payload.content !== undefined || existing?.hasContentSnapshot === true,
            updatedAt: Date.now(),
        };

        this.state = {
            focusedArticleId: payload.articleId,
            articles: new Map(this.state.articles).set(payload.articleId, nextArticle),
        };

        console.info("[editorContextStore] focus changed", {
            articleId: payload.articleId,
            path: payload.path,
        });

        emitEditorFocusChangedEvent({
            articleId: nextArticle.articleId,
            path: nextArticle.path,
            content: nextArticle.content,
            updatedAt: nextArticle.updatedAt,
        });

        this.emit();
    }

    /**
     * @function reportArticleContent
     * @description 上报文章内容变化。
     * @param payload 内容上报数据。
     */
    reportArticleContent(payload: ArticleContentPayload): void {
        const existing = this.state.articles.get(payload.articleId);
        const path = payload.path ?? existing?.path ?? payload.articleId;
        const title = path.split("/").pop() ?? path;

        const nextArticle: ArticleState = {
            articleId: payload.articleId,
            path,
            title,
            content: payload.content,
            hasContentSnapshot: true,
            updatedAt: Date.now(),
        };

        this.state = {
            focusedArticleId: this.state.focusedArticleId,
            articles: new Map(this.state.articles).set(payload.articleId, nextArticle),
        };

        emitEditorContentChangedEvent({
            articleId: nextArticle.articleId,
            path: nextArticle.path,
            content: nextArticle.content,
            updatedAt: nextArticle.updatedAt,
        });

        this.emit();
    }

    /**
     * @function getFocusedArticle
     * @description 获取当前聚焦文章。
     * @returns 当前聚焦文章或 null。
     */
    getFocusedArticle(): ArticleState | null {
        if (!this.state.focusedArticleId) {
            return null;
        }
        return this.state.articles.get(this.state.focusedArticleId) ?? null;
    }
}

const editorContextStore = new EditorContextStore();

/**
 * @function reportArticleFocus
 * @description 对外暴露：上报文章聚焦。
 * @param payload 聚焦上报参数。
 */
export function reportArticleFocus(payload: ArticleFocusPayload): void {
    editorContextStore.reportArticleFocus(payload);
}

/**
 * @function reportArticleContent
 * @description 对外暴露：上报文章内容。
 * @param payload 内容上报参数。
 */
export function reportArticleContent(payload: ArticleContentPayload): void {
    editorContextStore.reportArticleContent(payload);
}

/**
 * @function useFocusedArticle
 * @description React Hook：订阅当前聚焦文章。
 * @returns 当前聚焦文章。
 */
export function useFocusedArticle(): ArticleState | null {
    return useSyncExternalStore(
        (listener) => editorContextStore.subscribe(listener),
        () => editorContextStore.getFocusedArticle(),
        () => editorContextStore.getFocusedArticle(),
    );
}

/**
 * @function useArticleById
 * @description React Hook：按文章ID订阅文章快照。
 * @param articleId 文章ID。
 * @returns 文章快照或 null。
 */
export function useArticleById(articleId: string): ArticleState | null {
    return useSyncExternalStore(
        (listener) => editorContextStore.subscribe(listener),
        () => editorContextStore.getSnapshot().articles.get(articleId) ?? null,
        () => editorContextStore.getSnapshot().articles.get(articleId) ?? null,
    );
}

/**
 * @function getFocusedArticleSnapshot
 * @description 获取当前聚焦文章快照（非响应式）。
 * @returns 当前聚焦文章或 null。
 */
export function getFocusedArticleSnapshot(): ArticleState | null {
    return editorContextStore.getFocusedArticle();
}

/**
 * @function getArticleSnapshotById
 * @description 按文章ID获取文章快照（非响应式）。
 * @param articleId 文章ID。
 * @returns 对应文章或 null。
 */
export function getArticleSnapshotById(articleId: string): ArticleState | null {
    const snapshot = editorContextStore.getSnapshot();
    return snapshot.articles.get(articleId) ?? null;
}

/**
 * @function reportArticleContentByPath
 * @description 按路径上报内容更新，会将对应路径的缓存文章全部刷新。
 * @param path 文章路径。
 * @param content 最新内容。
 */
export function reportArticleContentByPath(path: string, content: string): void {
    const snapshot = editorContextStore.getSnapshot();

    snapshot.articles.forEach((article) => {
        if (article.path !== path) {
            return;
        }

        editorContextStore.reportArticleContent({
            articleId: article.articleId,
            path,
            content,
        });
    });
}
