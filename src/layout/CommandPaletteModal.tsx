/**
 * @module layout/CommandPaletteModal
 * @description 指令搜索浮窗：实时过滤指令并支持键盘/鼠标选择执行。
 * @dependencies
 *  - react
 *  - ../commands/commandSystem
 *  - ./CommandPaletteModal.css
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CommandDefinition, CommandId } from "../commands/commandSystem";
import i18n from "../i18n";
import "./CommandPaletteModal.css";

/**
 * @interface CommandPaletteModalProps
 * @description 指令搜索浮窗组件参数。
 */
export interface CommandPaletteModalProps {
    /** 浮窗是否可见 */
    isOpen: boolean;
    /** 可搜索的指令定义列表 */
    commands: CommandDefinition[];
    /** 关闭浮窗回调 */
    onClose: () => void;
    /** 执行目标指令回调 */
    onExecuteCommand: (commandId: CommandId) => void;
}

/**
 * @function clampSelectedIndex
 * @description 将索引限制在候选列表范围内。
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
 * @function commandMatchesQuery
 * @description 判断指令是否匹配搜索关键字。
 * @param command 指令定义。
 * @param query 搜索关键字。
 * @returns 匹配返回 true。
 */
function commandMatchesQuery(command: CommandDefinition, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    const searchable = `${i18n.t(command.title)} ${command.id} ${command.shortcut?.defaultBinding ?? ""}`.toLowerCase();
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.every((token) => searchable.includes(token));
}

/**
 * @function CommandPaletteModal
 * @description 渲染指令搜索浮窗。
 * @param props 组件参数。
 * @returns 浮窗节点；未打开时返回 null。
 */
export function CommandPaletteModal(props: CommandPaletteModalProps): ReactNode {
    const { t } = useTranslation();
    const [query, setQuery] = useState<string>("");
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const filteredCommands = useMemo(
        () => props.commands.filter((command) => commandMatchesQuery(command, query)),
        [props.commands, query],
    );

    const selectedCommand = useMemo(() => {
        if (selectedIndex < 0 || selectedIndex >= filteredCommands.length) {
            return null;
        }

        return filteredCommands[selectedIndex] ?? null;
    }, [filteredCommands, selectedIndex]);

    const executeByIndex = (index: number): void => {
        if (index < 0 || index >= filteredCommands.length) {
            return;
        }

        const command = filteredCommands[index];
        if (!command) {
            return;
        }

        console.info("[command-palette] execute", { commandId: command.id, title: command.title });
        props.onExecuteCommand(command.id);
        props.onClose();
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
                return clampSelectedIndex(base, filteredCommands.length);
            });
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((previous) => {
                const base = previous < 0 ? filteredCommands.length - 1 : previous - 1;
                return clampSelectedIndex(base, filteredCommands.length);
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
        setSelectedIndex(props.commands.length > 0 ? 0 : -1);

        const timer = window.setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 0);

        return () => {
            window.clearTimeout(timer);
        };
    }, [props.isOpen, props.commands.length]);

    useEffect(() => {
        setSelectedIndex(filteredCommands.length > 0 ? 0 : -1);
    }, [query, filteredCommands.length]);

    if (!props.isOpen) {
        return null;
    }

    return (
        // command-palette-overlay: 页面级遮罩层，用于聚焦当前指令搜索交互
        <div
            className="command-palette-overlay"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    props.onClose();
                }
            }}
            onKeyDown={handleKeyboard}
        >
            {/* command-palette-panel: 浮窗主体容器，承载输入与候选列表 */}
            <section className="command-palette-panel" aria-label={t("commandPalette.ariaLabel")}>
                {/* command-palette-input: 搜索输入框，用于实时过滤指令 */}
                <input
                    ref={inputRef}
                    className="command-palette-input"
                    type="text"
                    value={query}
                    placeholder={t("commandPalette.placeholder")}
                    onChange={(event) => {
                        setQuery(event.target.value);
                    }}
                />

                {/* command-palette-list: 候选列表容器 */}
                <div className="command-palette-list" role="listbox" aria-activedescendant={selectedCommand?.id}>
                    {filteredCommands.length === 0 && <div className="command-palette-empty">{t("commandPalette.noMatch")}</div>}

                    {filteredCommands.map((command, index) => (
                        // command-palette-item: 单条指令候选，可通过键盘和鼠标选择
                        <button
                            key={command.id}
                            id={command.id}
                            type="button"
                            role="option"
                            className={`command-palette-item ${index === selectedIndex ? "active" : ""}`}
                            aria-selected={index === selectedIndex}
                            onMouseEnter={() => {
                                setSelectedIndex(index);
                            }}
                            onClick={() => {
                                executeByIndex(index);
                            }}
                        >
                            {/* command-palette-item-title: 指令显示名称 */}
                            <span className="command-palette-item-title">{t(command.title)}</span>
                            {/* command-palette-item-meta: 指令标识和默认快捷键 */}
                            <span className="command-palette-item-meta">
                                {command.id}
                                {command.shortcut?.defaultBinding ? ` · ${command.shortcut.defaultBinding}` : ""}
                            </span>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}
