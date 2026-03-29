/**
 * @module host/layout/MoveFileDirectoryModal
 * @description 移动文件目录选择浮窗：通过搜索匹配选择目标目录。
 * @dependencies
 *  - react
 *  - ./MoveFileDirectoryModal.css
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { modalPlainTextInputProps } from "./textInputBehaviors";
import "./MoveFileDirectoryModal.css";

/**
 * @interface MoveDirectoryOption
 * @description 目录候选项。
 */
interface MoveDirectoryOption {
    /** 目录相对路径（空字符串表示仓库根目录） */
    relativePath: string;
    /** 展示标题 */
    title: string;
}

/**
 * @interface MoveFileDirectoryModalProps
 * @description 移动文件目录选择浮窗参数。
 */
export interface MoveFileDirectoryModalProps {
    /** 浮窗是否可见 */
    isOpen: boolean;
    /** 浮窗标题覆盖 */
    title?: string;
    /** aria-label 覆盖 */
    ariaLabel?: string;
    /** 当前待移动文件路径 */
    sourceFilePath: string;
    /** 可选目标目录列表（相对路径） */
    directories: string[];
    /** 关闭浮窗 */
    onClose: () => void;
    /** 确认目标目录 */
    onConfirmDirectory: (directoryRelativePath: string) => void;
}

/**
 * @function clampSelectedIndex
 * @description 将索引限制在候选范围内。
 * @param nextIndex 目标索引。
 * @param itemCount 候选数量。
 * @returns 合法索引；无候选时返回 -1。
 */
function clampSelectedIndex(nextIndex: number, itemCount: number): number {
    if (itemCount <= 0) {
        return -1;
    }

    return Math.max(0, Math.min(nextIndex, itemCount - 1));
}

/**
 * @function directoryMatchesQuery
 * @description 判断目录是否命中搜索关键字。
 * @param option 目录候选。
 * @param query 搜索关键字。
 * @returns 命中返回 true。
 */
function directoryMatchesQuery(option: MoveDirectoryOption, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    const searchable = `${option.title} ${option.relativePath}`.toLowerCase();
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.every((token) => searchable.includes(token));
}

/**
 * @function MoveFileDirectoryModal
 * @description 渲染“移动文件到目录”选择浮窗。
 * @param props 组件参数。
 * @returns 浮窗节点；未打开时返回 null。
 */
export function MoveFileDirectoryModal(props: MoveFileDirectoryModalProps): ReactNode {
    const { t } = useTranslation();
    const [query, setQuery] = useState<string>("");
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const directoryOptions = useMemo<MoveDirectoryOption[]>(() => {
        const normalizedSet = new Set(
            props.directories
                .map((path) => path.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, ""))
                .filter((path) => path.length > 0),
        );

        const sortedDirectoryPaths = Array.from(normalizedSet).sort((left, right) => left.localeCompare(right));
        return [
            {
                relativePath: "",
                title: t("moveFileModal.vaultRoot"),
            },
            ...sortedDirectoryPaths.map((relativePath) => ({
                relativePath,
                title: relativePath,
            })),
        ];
    }, [props.directories]);

    const filteredOptions = useMemo(
        () => directoryOptions.filter((option) => directoryMatchesQuery(option, query)),
        [directoryOptions, query],
    );

    const selectedOption = useMemo(() => {
        if (selectedIndex < 0 || selectedIndex >= filteredOptions.length) {
            return null;
        }

        return filteredOptions[selectedIndex] ?? null;
    }, [filteredOptions, selectedIndex]);

    const executeByIndex = (index: number): void => {
        if (index < 0 || index >= filteredOptions.length) {
            return;
        }

        const target = filteredOptions[index];
        if (!target) {
            return;
        }

        console.info("[move-file-modal] confirm target directory", {
            sourceFilePath: props.sourceFilePath,
            targetDirectory: target.relativePath,
        });
        props.onConfirmDirectory(target.relativePath);
    };

    const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
        const nativeEvent = event.nativeEvent;
        const isComposing = nativeEvent.isComposing || nativeEvent.keyCode === 229;
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
                return clampSelectedIndex(base, filteredOptions.length);
            });
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((previous) => {
                const base = previous < 0 ? filteredOptions.length - 1 : previous - 1;
                return clampSelectedIndex(base, filteredOptions.length);
            });
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            const targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
            executeByIndex(targetIndex);
        }
    };

    useEffect(() => {
        if (!props.isOpen) {
            return;
        }

        setQuery("");
        setSelectedIndex(directoryOptions.length > 0 ? 0 : -1);

        const timer = window.setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 0);

        return () => {
            window.clearTimeout(timer);
        };
    }, [props.isOpen, directoryOptions.length]);

    useEffect(() => {
        setSelectedIndex(filteredOptions.length > 0 ? 0 : -1);
    }, [query, filteredOptions.length]);

    if (!props.isOpen) {
        return null;
    }

    return (
        <div
            className="move-file-overlay"
            data-floating-backdrop="true"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    props.onClose();
                }
            }}
            onKeyDown={handleKeyboard}
        >
            <section
                className="move-file-panel"
                data-floating-surface="true"
                aria-label={props.ariaLabel ?? t("moveFileModal.ariaLabel")}
            >
                <header className="move-file-header">
                    <div className="move-file-title">{props.title ?? t("moveFileModal.title")}</div>
                    <div className="move-file-source-path" title={props.sourceFilePath}>
                        {props.sourceFilePath}
                    </div>
                </header>

                <input
                    ref={inputRef}
                    {...modalPlainTextInputProps}
                    className="move-file-input"
                    type="text"
                    value={query}
                    placeholder={t("moveFileModal.placeholder")}
                    onChange={(event) => {
                        setQuery(event.target.value);
                    }}
                />

                <div className="move-file-list" role="listbox" aria-activedescendant={selectedOption?.relativePath || "vault-root"}>
                    {filteredOptions.length === 0 && <div className="move-file-empty">{t("moveFileModal.noMatch")}</div>}

                    {filteredOptions.map((option, index) => {
                        const optionId = option.relativePath || "vault-root";
                        return (
                            <button
                                key={optionId}
                                id={optionId}
                                type="button"
                                role="option"
                                className={`move-file-item ${index === selectedIndex ? "active" : ""}`}
                                aria-selected={index === selectedIndex}
                                onMouseEnter={() => {
                                    setSelectedIndex(index);
                                }}
                                onClick={() => {
                                    executeByIndex(index);
                                }}
                            >
                                <span className="move-file-item-title">{option.title}</span>
                                <span className="move-file-item-meta">
                                    {option.relativePath || t("common.rootDirectory")}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
