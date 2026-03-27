/**
 * @module plugins/quick-switcher/overlay/QuickSwitcherOverlay
 * @description Quick Switcher 浮层：实时搜索 Markdown 文件并支持键盘与鼠标打开。
 *   该浮层通过 overlayRegistry 由宿主统一挂载，但打开状态由插件自行维护。
 *
 * @dependencies
 *   - react
 *   - ../../../api/vaultApi
 *   - ../../../host/registry/overlayRegistry
 *   - ../quickSwitcherEvents
 *   - ./QuickSwitcherModal.css
 *
 * @exports
 *   - QuickSwitcherOverlay
 */

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from "react";
import { CornerDownLeft, FileText, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { searchVaultMarkdownFiles, type VaultQuickSwitchItem } from "../../../api/vaultApi";
import { UI_LANGUAGE } from "../../../i18n/uiLanguage";
import type { OverlayRenderContext } from "../../../host/registry/overlayRegistry";
import { QUICK_SWITCHER_OPEN_REQUESTED_EVENT } from "../quickSwitcherEvents";
import "./QuickSwitcherModal.css";

/**
 * @interface QuickSwitcherOverlayProps
 * @description Quick Switcher 浮层参数。
 */
export interface QuickSwitcherOverlayProps {
    /** 宿主 overlay 渲染上下文 */
    context: OverlayRenderContext;
}

/**
 * @function wrapSelectedIndex
 * @description 将索引在候选范围内循环。
 * @param nextIndex 目标索引。
 * @param itemCount 候选数量。
 * @returns 循环后的合法索引；无候选时返回 -1。
 */
function wrapSelectedIndex(nextIndex: number, itemCount: number): number {
    if (itemCount <= 0) {
        return -1;
    }
    return ((nextIndex % itemCount) + itemCount) % itemCount;
}

/**
 * @function QuickSwitcherOverlay
 * @description 渲染 Quick Switcher 浮层。
 * @param props 组件参数。
 * @returns 浮层节点；关闭时返回 null。
 */
export function QuickSwitcherOverlay(props: QuickSwitcherOverlayProps): ReactNode {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState<boolean>(false);
    const [query, setQuery] = useState<string>("");
    const [results, setResults] = useState<VaultQuickSwitchItem[]>([]);
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const requestVersionRef = useRef<number>(0);

    const selectedItem = useMemo(() => {
        if (selectedIndex < 0 || selectedIndex >= results.length) {
            return null;
        }
        return results[selectedIndex] ?? null;
    }, [results, selectedIndex]);
    const selectedPath = selectedItem?.relativePath ?? null;

    /**
     * 选中项变化时，将对应 DOM 元素滚动到可视区域，避免键盘导航跳出视口。
     */
    const scrollActiveItemIntoView = useCallback(() => {
        if (selectedIndex < 0 || !listRef.current) {
            return;
        }

        const activeElement = listRef.current.querySelector(".quick-switcher-item.active") as HTMLElement | null;
        if (activeElement) {
            activeElement.scrollIntoView({ block: "nearest" });
        }
    }, [selectedIndex]);

    useEffect(() => {
        scrollActiveItemIntoView();
    }, [scrollActiveItemIntoView]);

    useEffect(() => {
        const handleOpenRequested = (): void => {
            console.info("[quick-switcher] open requested by plugin event");
            setIsOpen(true);
        };

        window.addEventListener(QUICK_SWITCHER_OPEN_REQUESTED_EVENT, handleOpenRequested);
        return () => {
            window.removeEventListener(QUICK_SWITCHER_OPEN_REQUESTED_EVENT, handleOpenRequested);
        };
    }, []);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setQuery("");
        setError(null);
        setResults([]);
        setSelectedIndex(-1);

        const timer = window.setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 0);

        console.info("[quick-switcher] opened");

        return () => {
            window.clearTimeout(timer);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const timer = window.setTimeout(() => {
            const requestVersion = requestVersionRef.current + 1;
            requestVersionRef.current = requestVersion;

            setIsLoading(true);
            setError(null);

            void searchVaultMarkdownFiles(query, 80)
                .then((nextResults) => {
                    if (requestVersion !== requestVersionRef.current) {
                        return;
                    }

                    setResults(nextResults);
                    setSelectedIndex(nextResults.length > 0 ? 0 : -1);
                })
                .catch((reason) => {
                    if (requestVersion !== requestVersionRef.current) {
                        return;
                    }

                    const message = reason instanceof Error ? reason.message : String(reason);
                    console.error("[quick-switcher] search failed", { message, query });
                    setError(message);
                    setResults([]);
                    setSelectedIndex(-1);
                })
                .finally(() => {
                    if (requestVersion !== requestVersionRef.current) {
                        return;
                    }

                    setIsLoading(false);
                });
        }, 120);

        return () => {
            window.clearTimeout(timer);
        };
    }, [isOpen, query]);

    const closeOverlay = (): void => {
        console.info("[quick-switcher] closed");
        setIsOpen(false);
    };

    const openResultByIndex = (index: number): void => {
        if (index < 0 || index >= results.length) {
            return;
        }

        const target = results[index];
        if (!target) {
            return;
        }

        console.info("[quick-switcher] open item", {
            relativePath: target.relativePath,
            score: target.score,
        });

        closeOverlay();
        void props.context.openFile({
            relativePath: target.relativePath,
        }).catch((reason) => {
            console.error("[quick-switcher] open file failed", {
                relativePath: target.relativePath,
                error: reason instanceof Error ? reason.message : String(reason),
            });
        });
    };

    const handleKeyboard = (event: KeyboardEvent<HTMLDivElement | HTMLInputElement>): void => {
        const nativeEvent = event.nativeEvent;
        const isComposing = nativeEvent.isComposing || nativeEvent.keyCode === 229;
        if (isComposing) {
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            closeOverlay();
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((previous) => {
                const base = previous < 0 ? 0 : previous + 1;
                return wrapSelectedIndex(base, results.length);
            });
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((previous) => {
                const base = previous < 0 ? results.length - 1 : previous - 1;
                return wrapSelectedIndex(base, results.length);
            });
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            const targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
            openResultByIndex(targetIndex);
        }
    };

    if (!isOpen) {
        return null;
    }

    return (
        /* quick-switcher-overlay: 页面级遮罩层，用于聚焦当前快速切换交互 */
        <div
            className="quick-switcher-overlay"
            data-floating-backdrop="true"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    closeOverlay();
                }
            }}
            onKeyDown={handleKeyboard}
        >
            {/* quick-switcher-panel: 浮窗主体容器，承载输入与候选列表 */}
            <section
                className="quick-switcher-panel"
                data-floating-surface="true"
                aria-label={t("quickSwitcher.ariaLabel")}
            >
                <div className="quick-switcher-header">
                    <div className="quick-switcher-header-copy">
                        <span className="quick-switcher-kicker">{t("quickSwitcher.ariaLabel")}</span>
                        <span className="quick-switcher-summary">{t("quickSwitcher.resultCount", { count: results.length })}</span>
                    </div>
                    <div className="quick-switcher-header-badge">
                        <FileText size={14} strokeWidth={1.8} />
                        <span>{selectedPath ?? t(UI_LANGUAGE.overlays.navigateList)}</span>
                    </div>
                </div>

                {/* quick-switcher-input: 搜索输入框，输入即触发后端检索 */}
                <label className="quick-switcher-input-shell">
                    <Search size={16} strokeWidth={1.8} className="quick-switcher-input-icon" />
                    <input
                        ref={inputRef}
                        className="quick-switcher-input"
                        type="text"
                        value={query}
                        placeholder={t("quickSwitcher.placeholder")}
                        onChange={(event) => {
                            setQuery(event.target.value);
                        }}
                    />
                </label>

                {/* quick-switcher-list: 搜索结果列表容器 */}
                <div
                    ref={listRef}
                    className="quick-switcher-list"
                    role="listbox"
                    aria-activedescendant={selectedItem?.relativePath}
                >
                    {isLoading && <div className="quick-switcher-empty">{t("quickSwitcher.searching")}</div>}
                    {!isLoading && error && <div className="quick-switcher-empty">{t("quickSwitcher.searchFailed", { message: error })}</div>}
                    {!isLoading && !error && results.length === 0 && <div className="quick-switcher-empty">{t("quickSwitcher.noMatch")}</div>}

                    {!isLoading && !error && results.map((item, index) => (
                        /* quick-switcher-item: 单条候选项，可通过鼠标与键盘高亮选择 */
                        <button
                            key={item.relativePath}
                            id={item.relativePath}
                            type="button"
                            role="option"
                            className={`quick-switcher-item ${index === selectedIndex ? "active" : ""}`}
                            aria-selected={index === selectedIndex}
                            onMouseEnter={() => {
                                setSelectedIndex(index);
                            }}
                            onClick={() => {
                                openResultByIndex(index);
                            }}
                        >
                            <div className="quick-switcher-item-row">
                                {/* quick-switcher-item-title: 候选项标题文本 */}
                                <span className="quick-switcher-item-title">{item.title}</span>
                                {item.score !== null ? (
                                    <span className="quick-switcher-item-score">{t("quickSwitcher.scoreLabel", { score: item.score.toFixed(2) })}</span>
                                ) : null}
                            </div>
                            {/* quick-switcher-item-path: 候选项相对路径文本 */}
                            <span className="quick-switcher-item-path">{item.relativePath}</span>
                        </button>
                    ))}
                </div>

                <div className="quick-switcher-footer">
                    <span>{t(UI_LANGUAGE.overlays.navigateList)}</span>
                    <span className="quick-switcher-footer-enter">
                        <CornerDownLeft size={12} strokeWidth={1.8} />
                        {t(UI_LANGUAGE.actions.open)}
                    </span>
                </div>
            </section>
        </div>
    );
}