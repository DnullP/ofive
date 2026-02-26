/**
 * @module layout/QuickSwitcherModal
 * @description 快速切换浮窗：实时搜索 Markdown 文件并支持键盘/鼠标选择打开。
 * @dependencies
 *  - react
 *  - ../api/vaultApi
 *  - ./QuickSwitcherModal.css
 *
 * @example
 *   <QuickSwitcherModal
 *     isOpen={isQuickSwitcherOpen}
 *     onClose={() => setQuickSwitcherOpen(false)}
 *     onOpenRelativePath={(path) => openMarkdownPath(path)}
 *   />
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { searchVaultMarkdownFiles, type VaultQuickSwitchItem } from "../api/vaultApi";
import "./QuickSwitcherModal.css";

/**
 * @interface QuickSwitcherModalProps
 * @description 快速切换浮窗组件参数。
 */
export interface QuickSwitcherModalProps {
    /** 浮窗是否可见 */
    isOpen: boolean;
    /** 关闭浮窗回调 */
    onClose: () => void;
    /** 打开目标文件回调（参数为相对路径） */
    onOpenRelativePath: (relativePath: string) => void;
}

/**
 * @function wrapSelectedIndex
 * @description 将索引在候选列表范围内循环（到达末尾回到开头，到达开头回到末尾）。
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
 * @function QuickSwitcherModal
 * @description 渲染快速切换浮窗，提供实时搜索与候选选择。
 * @param props 组件参数。
 * @returns 浮窗节点；未打开时返回 null。
 */
export function QuickSwitcherModal(props: QuickSwitcherModalProps): ReactNode {
    const { t } = useTranslation();
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

    /**
     * 选中项变化时，自动将对应 DOM 元素滚动到可视区域。
     * 使用 scrollIntoView({ block: "nearest" }) 避免不必要的大幅跳动。
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

        props.onOpenRelativePath(target.relativePath);
        props.onClose();
    };

    const handleKeyboard = (event: KeyboardEvent<HTMLDivElement | HTMLInputElement>): void => {
        const nativeEvent = event.nativeEvent;
        const isComposing =
            nativeEvent.isComposing ||
            nativeEvent.keyCode === 229;
        if (isComposing) {
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
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

    useEffect(() => {
        if (!props.isOpen) {
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
    }, [props.isOpen]);

    useEffect(() => {
        if (!props.isOpen) {
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
    }, [props.isOpen, query]);

    if (!props.isOpen) {
        return null;
    }

    return (
        // quick-switcher-overlay: 页面级遮罩层，用于聚焦当前快速切换交互
        <div
            className="quick-switcher-overlay"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    props.onClose();
                }
            }}
            onKeyDown={handleKeyboard}
        >
            {/* quick-switcher-panel: 浮窗主体容器，承载输入与候选列表 */}
            <section className="quick-switcher-panel" aria-label={t("quickSwitcher.ariaLabel")}>
                {/* quick-switcher-input: 搜索输入框，输入即触发后端检索 */}
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

                {/* quick-switcher-list: 搜索结果列表容器 */}
                <div ref={listRef} className="quick-switcher-list" role="listbox" aria-activedescendant={selectedItem?.relativePath}>
                    {isLoading && <div className="quick-switcher-empty">{t("quickSwitcher.searching")}</div>}
                    {!isLoading && error && <div className="quick-switcher-empty">{t("quickSwitcher.searchFailed", { message: error })}</div>}
                    {!isLoading && !error && results.length === 0 && <div className="quick-switcher-empty">{t("quickSwitcher.noMatch")}</div>}

                    {!isLoading && !error && results.map((item, index) => (
                        // quick-switcher-item: 单条候选项，可通过鼠标与键盘高亮选择
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
                            {/* quick-switcher-item-title: 候选项标题文本 */}
                            <span className="quick-switcher-item-title">{item.title}</span>
                            {/* quick-switcher-item-path: 候选项相对路径文本 */}
                            <span className="quick-switcher-item-path">{item.relativePath}</span>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}
