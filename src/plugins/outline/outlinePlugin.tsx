/**
 * @module plugins/outline/outlinePlugin
 * @description 文章大纲插件：自注册式插件，展示当前聚焦笔记的标题大纲。
 *
 *   本模块是"内容型读插件"的标准样板：
 *   - 优先从前端 canonical Markdown 内容快照派生大纲，缺失时回退后端持久态
 *   - 监听编辑内容、持久态内容更新事件和聚焦文件变化事件刷新数据
 *   - 自包含 activity / panel / i18n 注册，无需修改任何已有代码
 *
 *   放置在 src/plugins/ 目录下后，由 main.tsx 的 import.meta.glob
 *   自动导入，执行自注册副作用。
 *
 * @dependencies
 *   - react
 *   - lucide-react (Compass 图标)
 *   - ../../host/registry/activityRegistry
 *   - ../../host/registry/panelRegistry
 *   - ../../host/editor/activeEditorStore
 *   - ../../host/events/appEventBus
 *   - ../../api/vaultApi
 *   - i18next
 *
 * @exports
 *   - activatePlugin 注册并返回清理函数
 */

import React, { useCallback, type ReactNode } from "react";
import { Compass, FileText } from "lucide-react";
import { registerCommand } from "../../host/commands/commandSystem";
import { registerActivity } from "../../host/registry/activityRegistry";
import { registerPanel } from "../../host/registry/panelRegistry";
import type { OutlineHeading } from "../../api/vaultApi";
import {
    ensureOutlineStoreStarted,
    useOutlineSnapshot,
} from "./outlineStore";
import { registerOutlineManagedStore } from "./outlineManagedStoreRegistration";
import {
    emitEditorRevealRequestedEvent,
} from "../../host/events/appEventBus";
import i18n from "../../i18n";
import "./outlinePlugin.css";

const OUTLINE_PANEL_ID = "outline";

/* ────────────────── React 组件 ────────────────── */

/**
 * @function OutlinePanelPlugin
 * @description 大纲面板组件。监听聚焦文章变化和持久态内容更新事件，
 *   从后端加载大纲标题并渲染列表。
 * @returns 面板 ReactNode。
 */
export function OutlinePanelPlugin(): ReactNode {
    const {
        activeEditor,
        headings,
        loading,
        error,
    } = useOutlineSnapshot();

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
            scrollAlignment: "center",
        });

        console.info("[outlinePlugin] reveal requested from outline item", {
            articleId: activeEditor.articleId,
            path: activeEditor.path,
            line: heading.line,
            scrollAlignment: "center",
            text: heading.text,
        });
    }, [activeEditor]);

    /**
     * @function renderInactiveEmptyState
     * @description 渲染未聚焦文章时的大纲空状态，用更明确的图标化占位替代生硬文字。
     * @returns 空状态 ReactNode。
     */
    const renderInactiveEmptyState = (): ReactNode => {
        return (
            <div className="outline-panel outline-panel--empty-state">
                <div className="outline-empty-state">
                    <div className="outline-empty-state-icon" aria-hidden="true">
                        <FileText size={18} strokeWidth={1.8} />
                    </div>
                    <div className="outline-empty-state-title">
                        {t("outlinePlugin.noFocusedArticle")}
                    </div>
                    <div className="outline-empty-state-desc">
                        {t("outlinePlugin.focusArticleHint")}
                    </div>
                </div>
            </div>
        );
    };

    /* ── 未聚焦文章状态 ── */
    if (!activeEditor) {
        return renderInactiveEmptyState();
    }

    /* ── 加载中状态 ── */
    if (loading && headings.length === 0) {
        return (
            <div className="outline-panel">
                <div className="outline-empty">{t("outlinePlugin.loading")}</div>
            </div>
        );
    }

    /* ── 错误状态 ── */
    if (error) {
        return (
            <div className="outline-panel">
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
    ensureOutlineStoreStarted();
    const unregisterOutlineStore = registerOutlineManagedStore();

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
        unregisterOutlineStore();
        console.info("[outlinePlugin] unregistered outline plugin");
    };
}
