/**
 * @module plugins/backlinks/backlinksPlugin
 * @description 反向链接面板插件：自注册式插件，展示当前聚焦笔记的所有反向链接。
 *
 *   本模块是"零接触扩展"的示范：放置在 src/plugins/ 目录下后，
 *   由 main.tsx 的 import.meta.glob 自动导入，无需修改任何已有代码。
 *
 *   面板注册到 activityId = "outline"，与大纲面板同属一个活动图标分组，
 *   位于大纲面板下方。
 *
 * @dependencies
 *   - react
 *   - ../../host/registry/panelRegistry
 *   - ../../host/store/activeEditorStore
 *   - ../../api/vaultApi
 *   - i18next
 *
 * @exports
 *   - activatePlugin 注册并返回清理函数
 */

import React, { useEffect, useState, useCallback, type ReactNode } from "react";
import { Link2 } from "lucide-react";
import { registerCommand } from "../../host/commands/commandSystem";
import { registerPanel } from "../../host/registry/panelRegistry";
import type { PanelRenderContext } from "../../host/layout/DockviewLayout";
import { useActiveEditor } from "../../host/store/activeEditorStore";
import { getBacklinksForFile, type BacklinkItem } from "../../api/vaultApi";
import i18n from "../../i18n";
import "./backlinksPlugin.css";

const BACKLINKS_PANEL_ID = "backlinks";

/* ────────────────── React 组件 ────────────────── */

/**
 * @function BacklinksPanel
 * @description 反向链接面板组件。监听聚焦文章变化，
 *   自动从后端加载反向链接并渲染列表。
 *   点击某条反向链接可通过 openTab 跳转到对应笔记。
 * @param props.context 面板渲染上下文，提供 openTab 等方法。
 * @returns 面板 ReactNode。
 */
function BacklinksPanel({ context }: { context: PanelRenderContext }): ReactNode {
    const activeEditor = useActiveEditor();
    const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * 翻译辅助函数，使用插件注册的 i18n 资源。
     */
    const t = useCallback((key: string, options?: Record<string, unknown>) => {
        return i18n.t(key, options);
    }, []);

    /**
     * 点击反向链接条目：通过中心化 opener 服务打开对应笔记。
     * @param item 反向链接条目
     */
    const handleItemClick = useCallback(
        async (item: BacklinkItem) => {
            console.info("[backlinksPlugin] navigating to backlink source", {
                sourcePath: item.sourcePath,
                title: item.title,
            });
            try {
                await context.openFile({
                    relativePath: item.sourcePath,
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error("[backlinksPlugin] failed to read file for navigation", {
                    sourcePath: item.sourcePath,
                    error: message,
                });
            }
        },
        [context],
    );

    /**
     * @function renderInactiveEmptyState
     * @description 渲染未聚焦文章时的反向链接空状态，用简洁图标卡片表达当前上下文缺失。
     * @returns 空状态 ReactNode。
     */
    const renderInactiveEmptyState = (): ReactNode => {
        return (
            <div className="backlinks-panel backlinks-panel--empty-state">
                <div className="backlinks-empty-state">
                    <div className="backlinks-empty-state-icon" aria-hidden="true">
                        <Link2 size={18} strokeWidth={1.8} />
                    </div>
                    <div className="backlinks-empty-state-title">
                        {t("backlinks.noFocusedArticle")}
                    </div>
                    <div className="backlinks-empty-state-desc">
                        {t("backlinks.focusArticleHint")}
                    </div>
                </div>
            </div>
        );
    };

    /* 当聚焦文章变化时加载反向链接 */
    useEffect(() => {
        if (!activeEditor) {
            setBacklinks([]);
            setError(null);
            return;
        }

        const path = activeEditor.path;
        if (!path) {
            console.warn("[backlinksPlugin] active editor has no path", {
                articleId: activeEditor.articleId,
            });
            setBacklinks([]);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        console.info("[backlinksPlugin] loading backlinks for", { path });

        getBacklinksForFile(path)
            .then((items) => {
                if (!cancelled) {
                    setBacklinks(items);
                    setLoading(false);
                    console.info("[backlinksPlugin] backlinks state updated", {
                        path,
                        count: items.length,
                    });
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : String(err);
                    setError(message);
                    setLoading(false);
                    console.error("[backlinksPlugin] failed to load backlinks", {
                        path,
                        error: message,
                    });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [activeEditor?.path]);

    /* ── 未聚焦文章状态 ── */
    if (!activeEditor) {
        return renderInactiveEmptyState();
    }

    /* ── 加载中状态 ── */
    if (loading) {
        return (
            <div className="backlinks-panel">
                <div className="backlinks-panel-header">{activeEditor.title}</div>
                <div className="backlinks-empty">{t("backlinks.loading")}</div>
            </div>
        );
    }

    /* ── 错误状态 ── */
    if (error) {
        return (
            <div className="backlinks-panel">
                <div className="backlinks-panel-header">{activeEditor.title}</div>
                {/* backlinks-error: 错误提示文字 */}
                <div className="backlinks-error">
                    {t("backlinks.loadFailed", { message: error })}
                </div>
            </div>
        );
    }

    /* ── 正常渲染 ── */
    return (
        <div className="backlinks-panel">
            <div className="backlinks-panel-header">
                {activeEditor.title}
                {/* backlinks-count: 引用计数标签 */}
                <span className="backlinks-count">
                    {t("backlinks.referencedBy", { count: backlinks.length })}
                </span>
            </div>
            {backlinks.length === 0 ? (
                <div className="backlinks-empty">
                    {t("backlinks.noBacklinks")}
                </div>
            ) : (
                /* backlinks-list: 反向链接列表 */
                <ul className="backlinks-list">
                    {backlinks.map((item) => (
                        <li key={item.sourcePath}>
                            {/* backlinks-item: 单条反向链接按钮 */}
                            <button
                                type="button"
                                className="backlinks-item"
                                title={item.sourcePath}
                                onClick={() => handleItemClick(item)}
                            >
                                {/* backlinks-item-title: 链接标题 */}
                                <span className="backlinks-item-title">
                                    {item.title}
                                </span>
                                {item.weight > 1 && (
                                    /* backlinks-item-weight: 引用次数徽章 */
                                    <span className="backlinks-item-weight">
                                        ×{item.weight}
                                    </span>
                                )}
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
 * 模块加载时自动注册反向链接面板到 outline 活动分组。
 * 注册完成后无需其他文件引用该模块。
 */
/**
 * @function activatePlugin
 * @description 注册反向链接面板与打开命令。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterCommand = registerCommand({
        id: "backlinks.open",
        title: "backlinks.openCommand",
        execute: (context) => {
            if (!context.activatePanel) {
                console.warn("[backlinksPlugin] open command skipped: activatePanel missing");
                return;
            }

            context.activatePanel(BACKLINKS_PANEL_ID);
        },
    });

    const unregisterPanel = registerPanel({
        id: BACKLINKS_PANEL_ID,
        title: () => i18n.t("backlinks.title"),
        activityId: "outline",
        defaultPosition: "right",
        defaultOrder: 2,
        render: (ctx) => React.createElement(BacklinksPanel, { context: ctx }),
    });

    console.info("[backlinksPlugin] registered backlinks plugin");

    return () => {
        unregisterPanel();
        unregisterCommand();
        console.info("[backlinksPlugin] unregistered backlinks plugin");
    };
}
