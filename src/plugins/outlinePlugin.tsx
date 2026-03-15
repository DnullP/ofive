/**
 * @module plugins/outlinePlugin
 * @description 文章大纲插件：自注册式插件，展示当前聚焦笔记的标题大纲。
 *
 *   本模块是"内容型读插件"的标准样板：
 *   - 以后端持久化文件为数据来源（调用 get_vault_markdown_outline 接口）
 *   - 监听持久态内容更新事件和聚焦文件变化事件刷新数据
 *   - 自包含 activity / panel / i18n 注册，无需修改任何已有代码
 *
 *   放置在 src/plugins/ 目录下后，由 main.tsx 的 import.meta.glob
 *   自动导入，执行自注册副作用。
 *
 * @dependencies
 *   - react
 *   - lucide-react (Compass 图标)
 *   - ../host/registry/activityRegistry
 *   - ../host/registry/panelRegistry
 *   - ../host/store/activeEditorStore
 *   - ../host/events/appEventBus
 *   - ../api/vaultApi
 *   - i18next
 *
 * @exports
 *   - activatePlugin 注册并返回清理函数
 */

import React, { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { Compass } from "lucide-react";
import { registerCommand } from "../host/commands/commandSystem";
import { registerActivity } from "../host/registry/activityRegistry";
import { registerPanel } from "../host/registry/panelRegistry";
import { useActiveEditor } from "../host/store/activeEditorStore";
import { getVaultMarkdownOutline, type OutlineHeading } from "../api/vaultApi";
import {
    emitEditorRevealRequestedEvent,
    subscribePersistedContentUpdatedEvent,
    type PersistedContentUpdatedBusEvent,
} from "../host/events/appEventBus";
import i18n from "../i18n";
import "./outlinePlugin.css";

/* ────────────────── i18n 资源注册 ────────────────── */

/**
 * 为插件注册 i18n 资源包，避免修改全局 locale 文件。
 * 使用 addResourceBundle 的 deep + overwrite 合并模式。
 */
i18n.addResourceBundle("en", "translation", {
    outlinePlugin: {
        title: "Outline",
        noFocusedArticle: "No focused article",
        focusArticleHint: "Focus an article to see its outline.",
        noHeadings: "No heading structure found.",
        lineNumber: "Line {{line}}",
        persistedBasis: "Based on saved content",
        loading: "Loading outline...",
        loadFailed: "Failed to load outline: {{message}}",
        openCommand: "Open Outline Panel",
    },
}, true, true);

i18n.addResourceBundle("zh", "translation", {
    outlinePlugin: {
        title: "大纲",
        noFocusedArticle: "未聚焦文章",
        focusArticleHint: "请先聚焦一篇文章以查看其大纲。",
        noHeadings: "当前文章没有标题结构。",
        lineNumber: "第 {{line}} 行",
        persistedBasis: "基于已保存内容",
        loading: "正在加载大纲...",
        loadFailed: "加载大纲失败：{{message}}",
        openCommand: "打开大纲面板",
    },
}, true, true);

const OUTLINE_PANEL_ID = "outline";

/* ────────────────── 防抖辅助 ────────────────── */

/** 防抖延迟（毫秒），避免短时间内重复请求后端 */
const REFRESH_DEBOUNCE_MS = 200;

/* ────────────────── React 组件 ────────────────── */

/**
 * @function OutlinePanelPlugin
 * @description 大纲面板组件。监听聚焦文章变化和持久态内容更新事件，
 *   从后端加载大纲标题并渲染列表。
 * @returns 面板 ReactNode。
 */
function OutlinePanelPlugin(): ReactNode {
    const activeEditor = useActiveEditor();
    const [headings, setHeadings] = useState<OutlineHeading[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /**
     * 翻译辅助函数，使用插件注册的 i18n 资源。
     */
    const t = useCallback((key: string, options?: Record<string, unknown>) => {
        return i18n.t(key, options);
    }, []);

    /**
     * 点击标题项后，请求当前活跃编辑器跳转到对应行。
     */
    const handleHeadingClick = useCallback((heading: OutlineHeading) => {
        if (!activeEditor) {
            return;
        }

        emitEditorRevealRequestedEvent({
            articleId: activeEditor.articleId,
            path: activeEditor.path,
            line: heading.line,
        });

        console.info("[outlinePlugin] reveal requested from outline item", {
            articleId: activeEditor.articleId,
            path: activeEditor.path,
            line: heading.line,
            text: heading.text,
        });
    }, [activeEditor]);

    /**
     * 加载大纲数据：调用后端 get_vault_markdown_outline 接口。
     * 内置防抖机制，避免短时间内重复请求。
     */
    const loadOutline = useCallback((relativePath: string) => {
        if (debounceTimerRef.current !== null) {
            clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;

            setLoading(true);
            setError(null);

            console.info("[outlinePlugin] loading outline for", { relativePath });

            getVaultMarkdownOutline(relativePath)
                .then((result) => {
                    setHeadings(result.headings);
                    setLoading(false);
                    console.info("[outlinePlugin] outline state updated", {
                        relativePath,
                        count: result.headings.length,
                    });
                })
                .catch((err) => {
                    const message = err instanceof Error ? err.message : String(err);
                    setError(message);
                    setLoading(false);
                    console.error("[outlinePlugin] failed to load outline", {
                        relativePath,
                        error: message,
                    });
                });
        }, REFRESH_DEBOUNCE_MS);
    }, []);

    /* ── 当聚焦文章切换时加载大纲 ── */
    useEffect(() => {
        if (!activeEditor?.path) {
            setHeadings([]);
            setError(null);
            return;
        }

        loadOutline(activeEditor.path);

        return () => {
            if (debounceTimerRef.current !== null) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, [activeEditor?.path, loadOutline]);

    /* ── 订阅持久态内容更新事件，刷新当前聚焦文件的大纲 ── */
    useEffect(() => {
        const currentPath = activeEditor?.path;
        if (!currentPath) {
            return;
        }

        const unlisten = subscribePersistedContentUpdatedEvent(
            (event: PersistedContentUpdatedBusEvent) => {
                if (event.relativePath !== currentPath) {
                    return;
                }
                console.info("[outlinePlugin] persisted content updated, refreshing outline", {
                    eventId: event.eventId,
                    source: event.source,
                    relativePath: event.relativePath,
                });
                loadOutline(currentPath);
            },
        );

        return unlisten;
    }, [activeEditor?.path, loadOutline]);

    /* ── 未聚焦文章状态 ── */
    if (!activeEditor) {
        return (
            /* outline-panel: 面板根容器 */
            <div className="outline-panel">
                {/* outline-panel-header: 面板标题栏 */}
                <div className="outline-panel-header">
                    {t("outlinePlugin.noFocusedArticle")}
                </div>
                {/* outline-empty: 空状态提示 */}
                <div className="outline-empty">
                    {t("outlinePlugin.focusArticleHint")}
                </div>
            </div>
        );
    }

    /* ── 加载中状态 ── */
    if (loading && headings.length === 0) {
        return (
            <div className="outline-panel">
                <div className="outline-panel-header">{activeEditor.path}</div>
                <div className="outline-empty">{t("outlinePlugin.loading")}</div>
            </div>
        );
    }

    /* ── 错误状态 ── */
    if (error) {
        return (
            <div className="outline-panel">
                <div className="outline-panel-header">{activeEditor.path}</div>
                {/* outline-error: 错误提示文字 */}
                <div className="outline-error">
                    {t("outlinePlugin.loadFailed", { message: error })}
                </div>
            </div>
        );
    }

    /* ── 正常渲染 ── */
    return (
        <div className="outline-panel">
            <div className="outline-panel-header">
                {activeEditor.path}
                {/* outline-persisted-hint: 提示面板展示的是已保存内容 */}
                <span className="outline-persisted-hint">
                    {t("outlinePlugin.persistedBasis")}
                </span>
            </div>
            {headings.length === 0 ? (
                <div className="outline-empty">{t("outlinePlugin.noHeadings")}</div>
            ) : (
                /* outline-list: 标题列表，按层级缩进 */
                <ul className="outline-list">
                    {headings.map((heading) => (
                        <li key={`${String(heading.line)}-${heading.text}`}>
                            {/* outline-item: 单条标题按钮，paddingLeft 按层级递增 */}
                            <button
                                type="button"
                                className="outline-item"
                                style={{ paddingLeft: `${String((heading.level - 1) * 14 + 8)}px` }}
                                title={t("outlinePlugin.lineNumber", { line: String(heading.line) })}
                                onClick={() => {
                                    handleHeadingClick(heading);
                                }}
                            >
                                {heading.text}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/* ────────────────── 自注册 ────────────────── */

/**
 * 模块加载时自动注册大纲活动图标（面板容器型）和大纲面板。
 * activity 类型为 panel-container，面板通过 activityId 关联。
 */
/**
 * @function activatePlugin
 * @description 注册大纲面板、活动图标与打开命令。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterCommand = registerCommand({
        id: "outline.open",
        title: "outlinePlugin.openCommand",
        execute: (context) => {
            if (!context.activatePanel) {
                console.warn("[outlinePlugin] open command skipped: activatePanel missing");
                return;
            }

            context.activatePanel(OUTLINE_PANEL_ID);
        },
    });

    const unregisterActivity = registerActivity({
        type: "panel-container",
        id: OUTLINE_PANEL_ID,
        title: () => i18n.t("outlinePlugin.title"),
        icon: React.createElement(Compass, { size: 18, strokeWidth: 1.8 }),
        defaultSection: "top",
        defaultBar: "right",
        defaultOrder: 4,
    });

    const unregisterPanel = registerPanel({
        id: OUTLINE_PANEL_ID,
        title: () => i18n.t("outlinePlugin.title"),
        activityId: OUTLINE_PANEL_ID,
        defaultPosition: "right",
        defaultOrder: 1,
        render: () => React.createElement(OutlinePanelPlugin),
    });

    console.info("[outlinePlugin] registered outline plugin");

    return () => {
        unregisterPanel();
        unregisterActivity();
        unregisterCommand();
        console.info("[outlinePlugin] unregistered outline plugin");
    };
}
