/**
 * @module plugins/command-palette/overlay/CommandPaletteOverlay
 * @description Command Palette 浮层：实时过滤命令并调用宿主提供的执行能力。
 *   该浮层通过 overlayRegistry 统一挂载，打开状态由插件自身维护。
 *
 * @dependencies
 *   - react
 *   - ../../../host/commands/commandSystem
 *   - ../../../host/registry/overlayRegistry
 *   - ../commandPaletteEvents
 *   - ./CommandPaletteModal.css
 *
 * @exports
 *   - CommandPaletteOverlay
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Command, CornerDownLeft, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommandDefinition } from "../../../host/commands/commandSystem";
import { modalPlainTextInputProps } from "../../../host/layout/textInputBehaviors";
import i18n from "../../../i18n";
import { UI_LANGUAGE } from "../../../i18n/uiLanguage";
import type { OverlayRenderContext } from "../../../host/registry/overlayRegistry";
import { COMMAND_PALETTE_OPEN_REQUESTED_EVENT } from "../commandPaletteEvents";
import "./CommandPaletteModal.css";

/**
 * @interface CommandPaletteOverlayProps
 * @description Command Palette 浮层参数。
 */
export interface CommandPaletteOverlayProps {
    /** 宿主 overlay 渲染上下文 */
    context: OverlayRenderContext;
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
 * @function formatCommandShortcut
 * @description 提取指令默认快捷键，缺失时返回 null。
 * @param command 指令定义。
 * @returns 默认快捷键文本。
 */
function formatCommandShortcut(command: CommandDefinition): string | null {
    return command.shortcut?.defaultBinding?.trim() || null;
}

/**
 * @function CommandPaletteOverlay
 * @description 渲染指令搜索浮层。
 * @param props 组件参数。
 * @returns 浮层节点；未打开时返回 null。
 */
export function CommandPaletteOverlay(props: CommandPaletteOverlayProps): ReactNode {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState<boolean>(false);
    const [query, setQuery] = useState<string>("");
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const commands = useMemo(
        () => props.context.getCommandDefinitions().filter((command) => command.id !== "commandPalette.open"),
        [props.context],
    );

    const filteredCommands = useMemo(
        () => commands.filter((command) => commandMatchesQuery(command, query)),
        [commands, query],
    );

    const selectedCommand = useMemo(() => {
        if (selectedIndex < 0 || selectedIndex >= filteredCommands.length) {
            return null;
        }

        return filteredCommands[selectedIndex] ?? null;
    }, [filteredCommands, selectedIndex]);
    const selectedShortcut = selectedCommand ? formatCommandShortcut(selectedCommand) : null;

    useEffect(() => {
        const handleOpenRequested = (): void => {
            console.info("[command-palette-plugin] open requested by plugin event");
            setIsOpen(true);
        };

        window.addEventListener(COMMAND_PALETTE_OPEN_REQUESTED_EVENT, handleOpenRequested);
        return () => {
            window.removeEventListener(COMMAND_PALETTE_OPEN_REQUESTED_EVENT, handleOpenRequested);
        };
    }, []);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setQuery("");
        setSelectedIndex(commands.length > 0 ? 0 : -1);

        const timer = window.setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 0);

        console.info("[command-palette-plugin] opened");

        return () => {
            window.clearTimeout(timer);
        };
    }, [isOpen, commands.length]);

    useEffect(() => {
        setSelectedIndex(filteredCommands.length > 0 ? 0 : -1);
    }, [query, filteredCommands.length]);

    const closeOverlay = (): void => {
        console.info("[command-palette-plugin] closed");
        setIsOpen(false);
    };

    const executeByIndex = (index: number): void => {
        if (index < 0 || index >= filteredCommands.length) {
            return;
        }

        const command = filteredCommands[index];
        if (!command) {
            return;
        }

        console.info("[command-palette-plugin] execute", {
            commandId: command.id,
            title: command.title,
        });
        closeOverlay();
        window.setTimeout(() => {
            props.context.executeCommand(command.id);
        }, 0);
    };

    const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
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

    if (!isOpen) {
        return null;
    }

    return (
        <div
            className="command-palette-overlay"
            data-floating-backdrop="true"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    closeOverlay();
                }
            }}
            onKeyDown={handleKeyboard}
        >
            {/* command-palette-panel: 浮窗主体容器，承载输入与候选列表 */}
            <section
                className="command-palette-panel"
                data-floating-surface="true"
                aria-label={t("commandPalette.ariaLabel")}
            >
                <div className="command-palette-header">
                    <div className="command-palette-header-copy">
                        <span className="command-palette-kicker">{t("commandPalette.ariaLabel")}</span>
                        <span className="command-palette-summary">
                            {t("commandPalette.resultCount", { count: filteredCommands.length })}
                        </span>
                    </div>
                    <div className="command-palette-header-badge">
                        <Command size={14} strokeWidth={1.8} />
                        <span>{selectedShortcut ?? t(UI_LANGUAGE.overlays.navigateList)}</span>
                    </div>
                </div>

                {/* command-palette-input: 搜索输入框，用于实时过滤指令 */}
                <label className="command-palette-input-shell">
                    <Search size={16} strokeWidth={1.8} className="command-palette-input-icon" />
                    <input
                        ref={inputRef}
                        {...modalPlainTextInputProps}
                        className="command-palette-input"
                        type="text"
                        value={query}
                        placeholder={t("commandPalette.placeholder")}
                        onChange={(event) => {
                            setQuery(event.target.value);
                        }}
                    />
                </label>

                {/* command-palette-list: 候选列表容器 */}
                <div className="command-palette-list" role="listbox" aria-activedescendant={selectedCommand?.id}>
                    {filteredCommands.length === 0 && <div className="command-palette-empty">{t("commandPalette.noMatch")}</div>}

                    {filteredCommands.map((command, index) => (
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
                            <div className="command-palette-item-row">
                                {/* command-palette-item-title: 指令显示名称 */}
                                <span className="command-palette-item-title">{t(command.title)}</span>
                                {formatCommandShortcut(command) ? (
                                    <span className="command-palette-item-shortcut">{formatCommandShortcut(command)}</span>
                                ) : null}
                            </div>
                            {/* command-palette-item-meta: 指令标识和默认快捷键 */}
                            <span className="command-palette-item-meta">{command.id}</span>
                        </button>
                    ))}
                </div>

                <div className="command-palette-footer">
                    <span>{t(UI_LANGUAGE.overlays.navigateList)}</span>
                    <span className="command-palette-footer-enter">
                        <CornerDownLeft size={12} strokeWidth={1.8} />
                        {t(UI_LANGUAGE.actions.run)}
                    </span>
                </div>
            </section>
        </div>
    );
}