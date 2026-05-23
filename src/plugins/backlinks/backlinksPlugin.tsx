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
 *   - ../../host/editor/activeEditorStore
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
import type { PanelRenderContext } from "../../host/layout/workbenchContracts";
import { useActiveBacklinkTarget, type ActiveBacklinkTarget } from "../../host/editor/activeBacklinkTargetStore";
import { emitEditorRevealRequestedEvent } from "../../host/events/appEventBus";
import { buildFileTabId, openFileInWorkbench } from "../../host/layout/openFileService";
import { getProjectReaderCodeReferences, type ProjectReaderCodeReference } from "../../api/projectReaderApi";
import { getBacklinksForFile, readVaultMarkdownFile, type BacklinkItem } from "../../api/vaultApi";
import i18n from "../../i18n";
import "./backlinksPlugin.css";

const BACKLINKS_PANEL_ID = "backlinks";

type BacklinksPanelItem =
    | { kind: "markdown"; item: BacklinkItem }
    | { kind: "project-source"; item: ProjectReaderCodeReference };

interface BacklinksPanelSnapshot {
    key: string;
    title: string;
    items: BacklinksPanelItem[];
}

function getTargetKey(target: ActiveBacklinkTarget): string {
    if (target.kind === "markdown") {
        return `markdown:${target.path}`;
    }
    return `project-source:${target.projectId}:${target.relativePath}`;
}

function isReferenceForProjectPath(reference: ProjectReaderCodeReference, relativePath: string): boolean {
    const normalizedTargetPath = reference.target.relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return normalizedTargetPath === relativePath;
}

function getProjectReferenceKey(reference: ProjectReaderCodeReference): string {
    return `${reference.sourcePath}:${String(reference.sourceLineNumber)}:${String(reference.sourceColumnNumber)}`;
}

function summarizeProjectReference(reference: ProjectReaderCodeReference): string {
    const lineText = reference.target.lineNumber !== null && reference.target.lineNumber !== undefined
        ? `:${String(reference.target.lineNumber)}`
        : "";
    return `${reference.linkText} -> ${reference.target.relativePath}${lineText}`;
}

function resolveReferenceInitialOffset(content: string, lineNumber: number, columnNumber: number): number {
    const targetLine = Math.max(1, lineNumber);
    const targetColumn = Math.max(1, columnNumber);
    let offset = 0;
    let currentLine = 1;

    while (currentLine < targetLine && offset < content.length) {
        const newlineIndex = content.indexOf("\n", offset);
        if (newlineIndex < 0) {
            return content.length;
        }
        offset = newlineIndex + 1;
        currentLine += 1;
    }

    return Math.min(content.length, offset + targetColumn - 1);
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
    const activeTarget = useActiveBacklinkTarget();
    const [snapshot, setSnapshot] = useState<BacklinksPanelSnapshot | null>(null);
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
    const handleMarkdownItemClick = useCallback(
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

    const handleProjectSourceItemClick = useCallback(
        async (reference: ProjectReaderCodeReference) => {
            const sourcePath = reference.sourcePath;
            const sourceLineNumber = Math.max(1, reference.sourceLineNumber);
            const sourceColumnNumber = Math.max(1, reference.sourceColumnNumber);
            let initialCursorOffset = 0;

            try {
                const sourceFile = await readVaultMarkdownFile(sourcePath);
                initialCursorOffset = resolveReferenceInitialOffset(
                    sourceFile.content,
                    sourceLineNumber,
                    sourceColumnNumber,
                );
            } catch (readError) {
                console.warn("[backlinksPlugin] failed to preload project source reference", {
                    sourcePath,
                    error: readError instanceof Error ? readError.message : String(readError),
                });
            }

            const tabId = buildFileTabId(sourcePath);
            if (context.workbenchApi) {
                const existingPanel = context.workbenchApi.getPanel(tabId);
                if (existingPanel) {
                    existingPanel.api.updateParameters?.({
                        ...(existingPanel.params ?? {}),
                        initialCursorOffset,
                        autoFocus: true,
                    });
                    existingPanel.api.setActive();
                } else {
                    await openFileInWorkbench({
                        containerApi: context.workbenchApi,
                        relativePath: sourcePath,
                        tabParams: {
                            initialCursorOffset,
                            autoFocus: true,
                        },
                    });
                }
            } else {
                await context.openFile({ relativePath: sourcePath });
            }

            window.requestAnimationFrame(() => {
                emitEditorRevealRequestedEvent({
                    articleId: tabId,
                    path: sourcePath,
                    line: sourceLineNumber,
                });
            });
        },
        [context],
    );

    const handleItemClick = useCallback(
        async (item: BacklinksPanelItem) => {
            if (item.kind === "markdown") {
                await handleMarkdownItemClick(item.item);
                return;
            }
            await handleProjectSourceItemClick(item.item);
        },
        [handleMarkdownItemClick, handleProjectSourceItemClick],
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

    /* 当关注目标变化时加载反向链接 */
    useEffect(() => {
        if (!activeTarget) {
            setSnapshot(null);
            setError(null);
            setLoading(false);
            return;
        }

        let cancelled = false;
        const targetKey = getTargetKey(activeTarget);
        setLoading(true);
        setError(null);

        const loadPromise = activeTarget.kind === "markdown"
            ? getBacklinksForFile(activeTarget.path).then((items): BacklinksPanelSnapshot => ({
                key: targetKey,
                title: activeTarget.title,
                items: items.map((item) => ({ kind: "markdown", item })),
            }))
            : getProjectReaderCodeReferences(activeTarget.projectId).then((response): BacklinksPanelSnapshot => ({
                key: targetKey,
                title: activeTarget.title,
                items: response.references
                    .filter((reference) => isReferenceForProjectPath(reference, activeTarget.relativePath))
                    .sort((left, right) =>
                        left.sourcePath.localeCompare(right.sourcePath)
                        || left.sourceLineNumber - right.sourceLineNumber
                        || left.sourceColumnNumber - right.sourceColumnNumber,
                    )
                    .map((item) => ({ kind: "project-source", item })),
            }));

        void loadPromise
            .then((nextSnapshot) => {
                if (!cancelled) {
                    setSnapshot(nextSnapshot);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setSnapshot(null);
                    setError(err instanceof Error ? err.message : String(err));
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [activeTarget]);

    /* ── 未聚焦文章状态 ── */
    if (!activeTarget) {
        return renderInactiveEmptyState();
    }

    const hasActivePathSnapshot = snapshot?.key === getTargetKey(activeTarget);

    /* ── 加载中状态 ── */
    if (loading && !hasActivePathSnapshot) {
        return (
            <div className="backlinks-panel">
                <div className="backlinks-empty">{t("backlinks.loading")}</div>
            </div>
        );
    }

    /* ── 错误状态 ── */
    if (error && !hasActivePathSnapshot) {
        return (
            <div className="backlinks-panel">
                {/* backlinks-error: 错误提示文字 */}
                <div className="backlinks-error">
                    {t("backlinks.loadFailed", { message: error })}
                </div>
            </div>
        );
    }

    if (!hasActivePathSnapshot || !snapshot) {
        return (
            <div className="backlinks-panel">
                <div className="backlinks-empty">{t("backlinks.loading")}</div>
            </div>
        );
    }

    /* ── 正常渲染 ── */
    return (
        <div className="backlinks-panel">
            {/* backlinks-count: 引用计数标签，浮动在右上角避免占用独立行 */}
            <span className="backlinks-count">
                {loading
                    ? t("backlinks.loading")
                    : t("backlinks.referencedBy", { count: snapshot.items.length })}
            </span>
            {snapshot.items.length === 0 ? (
                <div className="backlinks-empty">
                    {t("backlinks.noBacklinks")}
                </div>
            ) : (
                /* backlinks-list: 反向链接列表 */
                <ul className="backlinks-list">
                    {snapshot.items.map((item) => (
                        <li key={item.kind === "markdown" ? item.item.sourcePath : getProjectReferenceKey(item.item)}>
                            {/* backlinks-item: 单条反向链接按钮 */}
                            <button
                                type="button"
                                className="backlinks-item"
                                title={item.kind === "markdown" ? item.item.sourcePath : item.item.sourcePath}
                                onClick={() => handleItemClick(item)}
                            >
                                {/* backlinks-item-title: 链接标题 */}
                                {item.kind === "markdown" ? (
                                    <>
                                        <span className="backlinks-item-title">
                                            {item.item.title}
                                        </span>
                                        {item.item.weight > 1 && (
                                            /* backlinks-item-weight: 引用次数徽章 */
                                            <span className="backlinks-item-weight">
                                                ×{item.item.weight}
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <span className="backlinks-item-title">
                                            {item.item.title}
                                        </span>
                                        <span className="backlinks-item-detail">
                                            {item.item.sourcePath}:{item.item.sourceLineNumber}
                                        </span>
                                        <span className="backlinks-item-preview">
                                            {summarizeProjectReference(item.item)}
                                        </span>
                                    </>
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
