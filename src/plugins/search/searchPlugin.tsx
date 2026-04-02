/**
 * @module plugins/search/searchPlugin
 * @description 搜索插件入口：负责注册搜索 activity 与 panel，并在面板内提供
 *   文件名搜索、全文本搜索和 tag 过滤能力。
 *
 * @dependencies
 *   - react
 *   - ../../api/vaultApi
 *   - ../../host/config/configStore
 *   - ../../host/registry/activityRegistry
 *   - ../../host/registry/panelRegistry
 *   - ../../host/layout/DockviewLayout
 *   - ../../i18n
 *   - lucide-react
 *
 * @example
 *   import { activatePlugin } from "./searchPlugin";
 *   const dispose = activatePlugin();
 *
 * @exports
 *   - SearchPluginConfigState
 *   - SearchPluginDependencies
 *   - activateSearchPluginRuntime
 *   - activatePlugin
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as LucideIcons from "lucide-react";
import {
    searchVaultMarkdown,
    type VaultSearchMatchItem,
    type VaultSearchScope,
} from "../../api/vaultApi";
import type { PanelRenderContext } from "../../host/layout/DockviewLayout";
import i18n from "../../i18n";
import {
    getConfigSnapshot,
    subscribeConfigChanges,
} from "../../host/config/configStore";
import {
    registerActivity,
    unregisterActivity,
    type ActivityDescriptor,
} from "../../host/registry/activityRegistry";
import {
    registerPanel,
    unregisterPanel,
    type PanelDescriptor,
} from "../../host/registry/panelRegistry";
import { UI_LANGUAGE } from "../../i18n/uiLanguage";
import "./searchPlugin.css";

const { FileText, Hash, Search } = LucideIcons;

const SEARCH_SURFACE_ID = "search";
const SEARCH_RESULT_LIMIT = 80;
const SEARCH_DEBOUNCE_MS = 220;

const SEARCH_SCOPE_OPTIONS: Array<{
    scope: VaultSearchScope;
    translationKey: string;
}> = [
        {
            scope: "all",
            translationKey: "searchPlugin.scopeAll",
        },
        {
            scope: "content",
            translationKey: "searchPlugin.scopeContent",
        },
        {
            scope: "fileName",
            translationKey: "searchPlugin.scopeFileName",
        },
    ];

/**
 * @interface SearchHighlightSegment
 * @description 搜索结果高亮片段，供渲染层将命中词与普通文本拆分显示。
 * @field text 片段文本。
 * @field matched 是否为命中片段。
 */
export interface SearchHighlightSegment {
    text: string;
    matched: boolean;
}

/**
 * @function escapeHighlightTerm
 * @description 转义正则特殊字符，避免用户输入破坏高亮匹配表达式。
 * @param term 用户输入的高亮关键字。
 * @returns 可安全用于正则的关键字文本。
 */
function escapeHighlightTerm(term: string): string {
    return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @function normalizeHighlightTerms
 * @description 归一化搜索与 tag 输入，得到去重后的高亮词列表。
 * @param query 搜索关键字。
 * @param tag 标签过滤关键字。
 * @returns 高亮词列表。
 */
function normalizeHighlightTerms(query: string, tag: string): string[] {
    const queryTerms = query.trim().split(/\s+/).filter(Boolean);
    const normalizedTag = tag.trim().replace(/^#+/, "").trim();

    return Array.from(new Set([
        ...queryTerms,
        ...(normalizedTag ? [normalizedTag] : []),
    ])).sort((left, right) => right.length - left.length);
}

/**
 * @function buildSearchHighlightSegments
 * @description 按关键字将文本拆分为普通片段与高亮片段。
 * @param text 原始文本。
 * @param terms 高亮关键字列表。
 * @returns 按显示顺序排列的片段数组。
 */
export function buildSearchHighlightSegments(
    text: string,
    terms: string[],
): SearchHighlightSegment[] {
    if (!text) {
        return [];
    }

    const normalizedTerms = Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean)));
    if (normalizedTerms.length === 0) {
        return [{ text, matched: false }];
    }

    const expression = new RegExp(`(${normalizedTerms.map(escapeHighlightTerm).join("|")})`, "giu");
    const segments: SearchHighlightSegment[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(expression)) {
        const matchText = match[0] ?? "";
        const matchIndex = match.index ?? -1;
        if (!matchText || matchIndex < 0) {
            continue;
        }

        if (matchIndex > lastIndex) {
            segments.push({
                text: text.slice(lastIndex, matchIndex),
                matched: false,
            });
        }

        segments.push({
            text: matchText,
            matched: true,
        });
        lastIndex = matchIndex + matchText.length;
    }

    if (lastIndex < text.length) {
        segments.push({
            text: text.slice(lastIndex),
            matched: false,
        });
    }

    return segments.length > 0 ? segments : [{ text, matched: false }];
}

/**
 * @function renderHighlightedText
 * @description 将高亮片段转换为 React 节点数组。
 * @param text 原始文本。
 * @param terms 高亮关键字列表。
 * @returns 可直接插入 JSX 的节点数组。
 */
function renderHighlightedText(text: string, terms: string[]): ReactNode {
    return buildSearchHighlightSegments(text, terms).map((segment, index) => {
        if (!segment.matched) {
            return <span key={`${text}-${String(index)}`}>{segment.text}</span>;
        }

        return (
            /* search-highlight: 命中词高亮标记，用于强调搜索匹配内容 */
            <mark key={`${text}-${String(index)}`} className="search-highlight">
                {segment.text}
            </mark>
        );
    });
}

/**
 * @interface SearchPluginConfigState
 * @description 搜索插件依赖的最小配置状态契约。
 * @field featureSettings.searchEnabled 是否启用搜索面板。
 */
export interface SearchPluginConfigState {
    featureSettings: {
        searchEnabled: boolean;
    };
}

/**
 * @interface SearchPluginDependencies
 * @description 搜索插件运行所需依赖，便于测试时注入替身实现。
 * @field getConfigSnapshot 同步读取配置快照。
 * @field subscribeConfigChanges 订阅配置变化。
 * @field registerActivity 注册搜索 activity。
 * @field unregisterActivity 注销搜索 activity。
 * @field registerPanel 注册搜索 panel。
 * @field unregisterPanel 注销搜索 panel。
 */
export interface SearchPluginDependencies {
    getConfigSnapshot: () => SearchPluginConfigState;
    subscribeConfigChanges: (
        listener: (state: SearchPluginConfigState) => void,
    ) => () => void;
    registerActivity: (descriptor: ActivityDescriptor) => () => void;
    unregisterActivity: (id: string) => void;
    registerPanel: (descriptor: PanelDescriptor) => () => void;
    unregisterPanel: (id: string) => void;
}

const defaultDependencies: SearchPluginDependencies = {
    getConfigSnapshot,
    subscribeConfigChanges,
    registerActivity,
    unregisterActivity,
    registerPanel,
    unregisterPanel,
};

/**
 * @function SearchPanel
 * @description 搜索面板组件：提供关键词、tag 和 scope 输入，并展示命中结果列表。
 * @param props.context 面板上下文，用于打开结果文件。
 * @returns 搜索面板 React 节点。
 */
function SearchPanel({ context }: { context: PanelRenderContext }): ReactNode {
    const [query, setQuery] = useState("");
    const [tag, setTag] = useState("");
    const [scope, setScope] = useState<VaultSearchScope>("all");
    const [results, setResults] = useState<VaultSearchMatchItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasSearched, setHasSearched] = useState(false);
    const requestIdRef = useRef(0);
    const highlightTerms = normalizeHighlightTerms(query, tag);

    /**
     * 翻译辅助函数。
     */
    const t = useCallback((key: string, options?: Record<string, unknown>) => {
        return i18n.t(key, options);
    }, []);

    /**
     * 打开单条搜索结果对应文件。
     * @param item 搜索命中项。
     */
    const handleOpenResult = useCallback(async (item: VaultSearchMatchItem) => {
        console.info("[searchPlugin] open search result start", {
            relativePath: item.relativePath,
        });

        try {
            await context.openFile({
                relativePath: item.relativePath,
            });
            console.info("[searchPlugin] open search result success", {
                relativePath: item.relativePath,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[searchPlugin] open search result failed", {
                relativePath: item.relativePath,
                error: message,
            });
            setError(t("searchPlugin.openFailed", { message }));
        }
    }, [context, t]);

    useEffect(() => {
        const trimmedQuery = query.trim();
        const trimmedTag = tag.trim();

        if (!trimmedQuery && !trimmedTag) {
            setResults([]);
            setLoading(false);
            setError(null);
            setHasSearched(false);
            console.info("[searchPlugin] search state reset: empty filters");
            return;
        }

        const nextRequestId = requestIdRef.current + 1;
        requestIdRef.current = nextRequestId;
        const timer = window.setTimeout(() => {
            setLoading(true);
            setError(null);

            console.info("[searchPlugin] search request start", {
                query: trimmedQuery,
                tag: trimmedTag || null,
                scope,
            });

            void searchVaultMarkdown(trimmedQuery, {
                tag: trimmedTag || undefined,
                scope,
                limit: SEARCH_RESULT_LIMIT,
            }).then((items) => {
                if (requestIdRef.current !== nextRequestId) {
                    return;
                }

                setResults(items);
                setHasSearched(true);
                setLoading(false);
                console.info("[searchPlugin] search state updated", {
                    query: trimmedQuery,
                    tag: trimmedTag || null,
                    scope,
                    resultCount: items.length,
                });
            }).catch((err) => {
                if (requestIdRef.current !== nextRequestId) {
                    return;
                }

                const message = err instanceof Error ? err.message : String(err);
                setResults([]);
                setHasSearched(true);
                setLoading(false);
                setError(t("searchPlugin.failed", { message }));
                console.error("[searchPlugin] search request failed", {
                    query: trimmedQuery,
                    tag: trimmedTag || null,
                    scope,
                    error: message,
                });
            });
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timer);
        };
    }, [query, tag, scope, t]);

    return (
        /* search-panel: 搜索面板根容器，承担整体纵向布局 */
        <div className="search-panel">
            {/* search-toolbar: 顶部搜索控制区，承载 query/tag/scope 输入 */}
            <div className="search-toolbar">
                <div className="search-toolbar-head">
                    <div className="search-toolbar-copy">
                        <span className="search-toolbar-title">{t("searchPlugin.toolbarTitle")}</span>
                        <span className="search-toolbar-hint">{t("searchPlugin.toolbarHint")}</span>
                    </div>
                    <span className="search-meta-chip">{t("searchPlugin.resultCount", { count: results.length })}</span>
                </div>

                <div className="search-toolbar-grid">
                    <div className="search-input-stack">
                        <span className="search-input-label">{t(UI_LANGUAGE.labels.keyword)}</span>
                        {/* search-query-field: 主搜索框，负责文件名与全文关键词输入 */}
                        <label className="search-query-field">
                            <Search size={14} strokeWidth={1.8} />
                            <input
                                type="search"
                                value={query}
                                placeholder={t("searchPlugin.queryPlaceholder")}
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                }}
                            />
                        </label>
                    </div>

                    <div className="search-input-stack">
                        <span className="search-input-label">{t(UI_LANGUAGE.labels.tagFilter)}</span>
                        {/* search-tag-field: 标签过滤输入框，仅负责 tag 条件输入 */}
                        <label className="search-tag-field">
                            <Hash size={14} strokeWidth={1.8} />
                            <input
                                type="search"
                                value={tag}
                                placeholder={t("searchPlugin.tagPlaceholder")}
                                onChange={(event) => {
                                    setTag(event.target.value);
                                }}
                            />
                        </label>
                    </div>
                </div>

                {/* search-scope-switch: 搜索范围切换按钮组 */}
                <div className="search-scope-switch">
                    {SEARCH_SCOPE_OPTIONS.map((option) => (
                        <button
                            key={option.scope}
                            type="button"
                            className={scope === option.scope
                                ? "search-scope-button search-scope-button--active"
                                : "search-scope-button"}
                            onClick={() => {
                                setScope(option.scope);
                            }}
                        >
                            {t(option.translationKey)}
                        </button>
                    ))}
                </div>
            </div>

            {/* search-meta: 结果统计与状态信息栏 */}
            <div className="search-meta">
                <span>
                    {t("searchPlugin.filtersSummary", {
                        scope: t(SEARCH_SCOPE_OPTIONS.find((entry) => entry.scope === scope)?.translationKey ?? "searchPlugin.scopeAll"),
                        tag: tag.trim() ? `#${tag.trim().replace(/^#+/, "")}` : t("searchPlugin.scopeAll"),
                    })}
                </span>
                {loading ? (
                    <span className="search-meta-chip search-meta-chip--active">{t("searchPlugin.loading")}</span>
                ) : null}
            </div>

            {error ? (
                /* search-error: 搜索或打开文件失败时的错误提示 */
                <div className="search-error">{error}</div>
            ) : null}

            {!hasSearched && !loading ? (
                /* search-empty: 初始空状态提示 */
                <div className="search-empty">
                    <div className="search-empty-title">{t("searchPlugin.emptyStateTitle")}</div>
                    <div>{t("searchPlugin.emptyStateHint")}</div>
                </div>
            ) : null}

            {hasSearched && !loading && results.length === 0 && !error ? (
                <div className="search-empty">{t("searchPlugin.noResults")}</div>
            ) : null}

            {/* search-results: 命中结果滚动列表 */}
            <ul className="search-results">
                {results.map((item) => (
                    <li key={`${item.relativePath}-${String(item.snippetLine ?? 0)}`}>
                        {/* search-result: 单条搜索结果按钮，负责打开对应文件 */}
                        <button
                            type="button"
                            className="search-result"
                            onClick={() => {
                                void handleOpenResult(item);
                            }}
                        >
                            {/* search-result-header: 结果头部，显示标题与匹配徽章 */}
                            <div className="search-result-header">
                                <div className="search-result-title-wrap">
                                    <FileText size={14} strokeWidth={1.8} />
                                    <span className="search-result-title">
                                        {renderHighlightedText(item.title, highlightTerms)}
                                    </span>
                                </div>

                                {/* search-badges: 匹配来源徽章区域 */}
                                <div className="search-badges">
                                    {item.matchedFileName ? (
                                        <span className="search-badge">
                                            {t("searchPlugin.matchedFileName")}
                                        </span>
                                    ) : null}
                                    {item.matchedContent ? (
                                        <span className="search-badge">
                                            {t("searchPlugin.matchedContent")}
                                        </span>
                                    ) : null}
                                    {item.matchedTag ? (
                                        <span className="search-badge">
                                            {t("searchPlugin.matchedTag")}
                                        </span>
                                    ) : null}
                                </div>
                            </div>

                            {/* search-result-path: 结果文件相对路径 */}
                            <div className="search-result-path">
                                {renderHighlightedText(item.relativePath, highlightTerms)}
                            </div>

                            {item.snippet ? (
                                /* search-result-snippet: 正文命中摘要 */
                                <div className="search-result-snippet">
                                    {renderHighlightedText(item.snippet, highlightTerms)}
                                </div>
                            ) : null}

                            {/* search-result-footer: 行号与标签列表 */}
                            <div className="search-result-footer">
                                <span>
                                    {item.snippetLine
                                        ? t("searchPlugin.snippetLine", { line: item.snippetLine })
                                        : ""}
                                </span>

                                {(item.tags ?? []).length > 0 ? (
                                    /* search-tag-list: 当前命中项的标签摘要 */
                                    <span className="search-tag-list">
                                        {(item.tags ?? []).slice(0, 4).map((entry, index) => (
                                            <span key={`${item.relativePath}-tag-${entry}`}>
                                                {index > 0 ? " " : ""}
                                                {renderHighlightedText(`#${entry}`, highlightTerms)}
                                            </span>
                                        ))}
                                        {(item.tags ?? []).length > 4 ? ` +${String((item.tags ?? []).length - 4)}` : ""}
                                    </span>
                                ) : null}
                            </div>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * @function buildSearchActivityDescriptor
 * @description 构造搜索 activity 的注册描述。
 * @returns 搜索 activity 描述对象。
 */
function buildSearchActivityDescriptor(): ActivityDescriptor {
    return {
        type: "panel-container",
        id: SEARCH_SURFACE_ID,
        title: () => i18n.t("searchPlugin.title"),
        icon: <Search size={18} strokeWidth={1.8} />,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 2,
    };
}

/**
 * @function buildSearchPanelDescriptor
 * @description 构造搜索 panel 的注册描述。
 * @returns 搜索 panel 描述对象。
 */
function buildSearchPanelDescriptor(): PanelDescriptor {
    return {
        id: SEARCH_SURFACE_ID,
        title: () => i18n.t("searchPlugin.title"),
        activityId: SEARCH_SURFACE_ID,
        defaultPosition: "left",
        defaultOrder: 2,
        render: (context) => <SearchPanel context={context} />,
    };
}

/**
 * @function registerSearchSurfaces
 * @description 注册搜索 activity 与 panel，并返回统一清理函数。
 * @param dependencies 搜索插件依赖。
 * @returns 清理函数。
 */
function registerSearchSurfaces(
    dependencies: SearchPluginDependencies,
): () => void {
    const disposeActivity = dependencies.registerActivity(
        buildSearchActivityDescriptor(),
    );
    const disposePanel = dependencies.registerPanel(buildSearchPanelDescriptor());

    console.info("[searchPlugin] registered search surfaces");

    return () => {
        disposePanel();
        disposeActivity();
        dependencies.unregisterPanel(SEARCH_SURFACE_ID);
        dependencies.unregisterActivity(SEARCH_SURFACE_ID);
        console.info("[searchPlugin] unregistered search surfaces");
    };
}

/**
 * @function activateSearchPluginRuntime
 * @description 激活搜索插件运行时，根据配置状态同步搜索 UI 面。
 * @param dependencies 可选依赖注入，用于测试或替换实现。
 * @returns 插件清理函数。
 */
export function activateSearchPluginRuntime(
    dependencies: SearchPluginDependencies = defaultDependencies,
): () => void {
    let disposeSearchSurfaces: (() => void) | null = null;

    const syncSearchVisibility = (state: SearchPluginConfigState): void => {
        if (state.featureSettings.searchEnabled) {
            if (!disposeSearchSurfaces) {
                disposeSearchSurfaces = registerSearchSurfaces(dependencies);
            }
            return;
        }

        if (disposeSearchSurfaces) {
            const cleanup = disposeSearchSurfaces;
            disposeSearchSurfaces = null;
            cleanup();
        }
    };

    syncSearchVisibility(dependencies.getConfigSnapshot());
    const unsubscribe = dependencies.subscribeConfigChanges(syncSearchVisibility);

    return () => {
        unsubscribe();
        if (disposeSearchSurfaces) {
            const cleanup = disposeSearchSurfaces;
            disposeSearchSurfaces = null;
            cleanup();
        }
    };
}

/**
 * @function activatePlugin
 * @description 搜索插件入口，供插件运行时自动发现并激活。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    return activateSearchPluginRuntime();
}