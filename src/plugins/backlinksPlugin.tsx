/**
 * @module plugins/backlinksPlugin
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
 *   - @tauri-apps/api/core (invoke)
 *   - ../registry/panelRegistry
 *   - ../store/editorContextStore
 *   - i18next
 *
 * @exports 无导出（纯副作用模块）
 */

import React, { useEffect, useState, useCallback, type ReactNode } from "react";
import { registerPanel } from "../registry/panelRegistry";
import type { PanelRenderContext } from "../layout/DockviewLayout";
import { useFocusedArticle } from "../store/editorContextStore";
import { readVaultMarkdownFile } from "../api/vaultApi";
import i18n from "../i18n";
import "./backlinksPlugin.css";

/* ────────────────── i18n 资源注册 ────────────────── */

/**
 * 为插件注册 i18n 资源包，避免修改全局 locale 文件。
 * 使用 addResourceBundle 的 deep + overwrite 合并模式。
 */
i18n.addResourceBundle("en", "translation", {
    backlinks: {
        title: "Backlinks",
        noFocusedArticle: "No focused article",
        focusArticleHint: "Focus an article to see its backlinks.",
        noBacklinks: "No backlinks found.",
        loading: "Loading backlinks...",
        loadFailed: "Failed to load backlinks: {{message}}",
        referencedBy: "Referenced by {{count}} note(s)",
    },
}, true, true);

i18n.addResourceBundle("zh", "translation", {
    backlinks: {
        title: "反向链接",
        noFocusedArticle: "未聚焦文章",
        focusArticleHint: "请先聚焦一篇文章以查看其反向链接。",
        noBacklinks: "未找到反向链接。",
        loading: "正在加载反向链接...",
        loadFailed: "加载反向链接失败：{{message}}",
        referencedBy: "被 {{count}} 篇笔记引用",
    },
}, true, true);

/* ────────────────── 类型定义 ────────────────── */

/**
 * @interface BacklinkItem
 * @description 后端返回的反向链接条目。
 * @field sourcePath - 引用源文件相对路径
 * @field title      - 引用源文件标题
 * @field weight     - 引用权重（次数）
 */
interface BacklinkItem {
    sourcePath: string;
    title: string;
    weight: number;
}

/* ────────────────── 后端 API ────────────────── */

/**
 * @function getBacklinksForFile
 * @description 调用后端获取指定文件的反向链接列表。
 *   插件自带 API 封装，无需修改 vaultApi.ts。
 * @param relativePath 目标文件相对路径。
 * @returns 反向链接列表。
 * @throws 后端调用失败时抛出错误字符串。
 */
async function getBacklinksForFile(relativePath: string): Promise<BacklinkItem[]> {
    // 检查是否在 Tauri 环境中运行
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        console.debug("[backlinksPlugin] invoke get_backlinks_for_file", { relativePath });
        const result = await invoke<BacklinkItem[]>("get_backlinks_for_file", {
            relativePath,
        });
        console.debug("[backlinksPlugin] backlinks loaded", {
            relativePath,
            count: result.length,
        });
        return result;
    }
    // 浏览器开发环境回退
    console.warn("[backlinksPlugin] not in Tauri environment, returning empty backlinks");
    return [];
}

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
    const focusedArticle = useFocusedArticle();
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
     * 点击反向链接条目：先从后端读取文件内容，再通过 openTab 打开对应笔记。
     * 必须携带 content 参数，否则编辑器会使用模板内容覆盖原文件。
     * @param item 反向链接条目
     */
    const handleItemClick = useCallback(
        async (item: BacklinkItem) => {
            console.info("[backlinksPlugin] navigating to backlink source", {
                sourcePath: item.sourcePath,
                title: item.title,
            });
            try {
                const file = await readVaultMarkdownFile(item.sourcePath);
                context.openTab({
                    id: `file:${item.sourcePath}`,
                    title: item.title,
                    component: "codemirror",
                    params: { path: item.sourcePath, content: file.content },
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

    /* 当聚焦文章变化时加载反向链接 */
    useEffect(() => {
        if (!focusedArticle) {
            setBacklinks([]);
            setError(null);
            return;
        }

        const path = focusedArticle.path;
        if (!path) {
            console.warn("[backlinksPlugin] focused article has no path", {
                articleId: focusedArticle.articleId,
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
    }, [focusedArticle?.path]);

    /* ── 未聚焦文章状态 ── */
    if (!focusedArticle) {
        return (
            /* backlinks-panel: 面板根容器 */
            <div className="backlinks-panel">
                {/* backlinks-panel-header: 面板标题栏 */}
                <div className="backlinks-panel-header">
                    {t("backlinks.noFocusedArticle")}
                </div>
                {/* backlinks-empty: 空状态提示 */}
                <div className="backlinks-empty">
                    {t("backlinks.focusArticleHint")}
                </div>
            </div>
        );
    }

    /* ── 加载中状态 ── */
    if (loading) {
        return (
            <div className="backlinks-panel">
                <div className="backlinks-panel-header">{focusedArticle.title}</div>
                <div className="backlinks-empty">{t("backlinks.loading")}</div>
            </div>
        );
    }

    /* ── 错误状态 ── */
    if (error) {
        return (
            <div className="backlinks-panel">
                <div className="backlinks-panel-header">{focusedArticle.title}</div>
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
                {focusedArticle.title}
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
registerPanel({
    id: "backlinks",
    title: () => i18n.t("backlinks.title"),
    activityId: "outline",
    defaultPosition: "right",
    defaultOrder: 2,
    render: (ctx) => React.createElement(BacklinksPanel, { context: ctx }),
});

console.info("[backlinksPlugin] self-registered backlinks panel");
