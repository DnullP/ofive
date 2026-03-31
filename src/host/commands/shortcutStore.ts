/**
 * @module host/commands/shortcutStore
 * @description 快捷键状态管理：读取/持久化仓库级快捷键配置，并提供前端订阅能力。
 * @dependencies
 *  - react (useSyncExternalStore)
 *  - ../../api/vaultApi
 *  - ../commands/commandSystem
 */

import { useSyncExternalStore } from "react";
import {
    getCurrentVaultConfig,
    saveCurrentVaultConfig,
    type VaultConfig,
} from "../../api/vaultApi";
import {
    getCommandBindingPolicy,
    getCommandDefinitions,
    subscribeCommands,
    type CommandId,
} from "./commandSystem";
import { allowsSystemReservedBinding, isSystemReservedBinding } from "./shortcutPolicies";
import i18n from "../../i18n";

/**
 * @constant SHORTCUTS_CONFIG_KEY
 * @description 仓库配置中用于存储快捷键映射的键。
 */
const SHORTCUTS_CONFIG_KEY = "commandShortcuts";

/**
 * @constant DEFAULT_SHORTCUTS
 * @description 默认快捷键映射。
 */
function buildDefaultShortcuts(): Record<CommandId, string> {
    return getCommandDefinitions().reduce((accumulator, command) => {
        accumulator[command.id] = command.shortcut?.defaultBinding ?? "";
        return accumulator;
    }, {} as Record<CommandId, string>);
}

/**
 * @constant MODIFIER_TOKEN_ORDER
 * @description 规范化后的修饰键顺序，保证录制与展示稳定。
 */
const MODIFIER_TOKEN_ORDER = ["Cmd", "Ctrl", "Alt", "Shift"] as const;

/**
 * @interface ParsedShortcut
 * @description 解析后的快捷键信息。
 */
interface ParsedShortcut {
    modifiers: Set<(typeof MODIFIER_TOKEN_ORDER)[number]>;
    key: string;
}

/**
 * @function normalizeModifierToken
 * @description 将修饰键 token 规范化到统一名称。
 * @param token 原始 token。
 * @returns 规范化修饰键或 null。
 */
function normalizeModifierToken(token: string): (typeof MODIFIER_TOKEN_ORDER)[number] | null {
    const lowered = token.trim().toLowerCase();
    if (["cmd", "command", "meta", "⌘", "os"].includes(lowered)) {
        return "Cmd";
    }

    if (["ctrl", "control", "⌃", "mod"].includes(lowered)) {
        return "Ctrl";
    }

    if (["alt", "option", "opt", "⌥", "altgraph"].includes(lowered)) {
        return "Alt";
    }

    if (["shift", "⇧"].includes(lowered)) {
        return "Shift";
    }

    return null;
}

/**
 * @function normalizePrimaryKeyToken
 * @description 规范化主键 token（非修饰键）。
 * @param token 原始 token。
 * @returns 规范化主键或 null。
 */
function normalizePrimaryKeyToken(token: string): string | null {
    const trimmed = token.trim();
    if (!trimmed) {
        return null;
    }

    const lowered = trimmed.toLowerCase();

    const namedMap: Record<string, string> = {
        esc: "Esc",
        escape: "Esc",
        enter: "Enter",
        return: "Enter",
        tab: "Tab",
        space: "Space",
        spacebar: "Space",
        backspace: "Backspace",
        delete: "Delete",
        del: "Delete",
        home: "Home",
        end: "End",
        pageup: "PageUp",
        pagedown: "PageDown",
        up: "ArrowUp",
        down: "ArrowDown",
        left: "ArrowLeft",
        right: "ArrowRight",
        arrowup: "ArrowUp",
        arrowdown: "ArrowDown",
        arrowleft: "ArrowLeft",
        arrowright: "ArrowRight",
    };

    if (namedMap[lowered]) {
        return namedMap[lowered];
    }

    if (/^f\d{1,2}$/i.test(trimmed)) {
        return trimmed.toUpperCase();
    }

    if (trimmed.length === 1) {
        return /[a-zA-Z]/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
    }

    return trimmed;
}

/**
 * @function parseShortcut
 * @description 解析并规范化快捷键字符串。
 * @param shortcut 原始快捷键字符串。
 * @returns 解析结果；无效时返回 null。
 */
function parseShortcut(shortcut: string): ParsedShortcut | null {
    const parts = shortcut
        .split("+")
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length === 0) {
        return null;
    }

    const modifiers = new Set<(typeof MODIFIER_TOKEN_ORDER)[number]>();
    const keyTokens: string[] = [];

    parts.forEach((part) => {
        const modifierToken = normalizeModifierToken(part);
        if (modifierToken) {
            modifiers.add(modifierToken);
            return;
        }

        keyTokens.push(part);
    });

    if (keyTokens.length !== 1) {
        return null;
    }

    const key = normalizePrimaryKeyToken(keyTokens[0]);
    if (!key) {
        return null;
    }

    return {
        modifiers,
        key,
    };
}

/**
 * @function stringifyShortcut
 * @description 将解析后的快捷键重新序列化为统一字符串格式。
 * @param parsed 解析后的快捷键信息。
 * @returns 规范化字符串。
 */
function stringifyShortcut(parsed: ParsedShortcut): string {
    const orderedModifiers = MODIFIER_TOKEN_ORDER.filter((token) => parsed.modifiers.has(token));
    return [...orderedModifiers, parsed.key].join("+");
}

/**
 * @function normalizeEventPrimaryKey
 * @description 从键盘事件中提取稳定的主键信息，优先使用 event.code 规避输入法/布局差异。
 * @param event 键盘事件。
 * @returns 规范化主键；无法识别时返回 null。
 */
function normalizeEventPrimaryKey(event: KeyboardEvent): string | null {
    const modifierOnlyKeys = new Set(["Meta", "Control", "Shift", "Alt", "AltGraph"]);
    if (modifierOnlyKeys.has(event.key)) {
        return null;
    }

    if (/^Key[A-Z]$/.test(event.code)) {
        return event.code.slice(3).toUpperCase();
    }

    if (/^Digit\d$/.test(event.code)) {
        return event.code.slice(5);
    }

    const codeMap: Record<string, string> = {
        Minus: "-",
        Equal: "=",
        BracketLeft: "[",
        BracketRight: "]",
        Backslash: "\\",
        Semicolon: ";",
        Quote: "'",
        Comma: ",",
        Period: ".",
        Slash: "/",
        Backquote: "`",
    };

    if (codeMap[event.code]) {
        return codeMap[event.code];
    }

    const key = normalizePrimaryKeyToken(event.key);
    if (!key || key === "Dead") {
        return null;
    }

    return key;
}

/**
 * @function eventToParsedShortcut
 * @description 将键盘事件转换为解析后的快捷键结构。
 * @param event 键盘事件。
 * @returns 解析结果；无效时返回 null。
 */
function eventToParsedShortcut(event: KeyboardEvent): ParsedShortcut | null {
    const key = normalizeEventPrimaryKey(event);
    if (!key) {
        return null;
    }

    const modifiers = new Set<(typeof MODIFIER_TOKEN_ORDER)[number]>();
    if (event.metaKey) {
        modifiers.add("Cmd");
    }
    if (event.ctrlKey) {
        modifiers.add("Ctrl");
    }
    if (event.altKey || event.getModifierState("AltGraph")) {
        modifiers.add("Alt");
    }
    if (event.shiftKey) {
        modifiers.add("Shift");
    }

    return {
        modifiers,
        key,
    };
}

/**
 * @function normalizeShortcutString
 * @description 对快捷键字符串做语义规范化与格式统一。
 * @param shortcut 原始快捷键。
 * @returns 规范化后的快捷键；无效时返回 null。
 */
export function normalizeShortcutString(shortcut: string): string | null {
    const parsed = parseShortcut(shortcut);
    if (!parsed) {
        return null;
    }
    return stringifyShortcut(parsed);
}

/**
 * @function recordShortcutFromKeyboardEvent
 * @description 从键盘事件录制快捷键字符串。
 * @param event 键盘事件。
 * @returns 录制结果；无效按键返回 null。
 */
export function recordShortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
    const parsed = eventToParsedShortcut(event);
    if (!parsed) {
        return null;
    }
    return stringifyShortcut(parsed);
}

/**
 * @interface ShortcutState
 * @description 快捷键全局状态。
 */
interface ShortcutState {
    bindings: Record<CommandId, string>;
    loadedVaultPath: string | null;
    isLoading: boolean;
    error: string | null;
}

/**
 * @class ShortcutStore
 * @description 管理快捷键绑定状态并与后端仓库配置同步。
 */
class ShortcutStore {
    private state: ShortcutState = {
        bindings: buildDefaultShortcuts(),
        loadedVaultPath: null,
        isLoading: false,
        error: null,
    };

    private listeners = new Set<() => void>();

    constructor() {
        subscribeCommands(() => {
            this.syncBindingsWithRegisteredCommands();
        });
    }

    /**
     * @function syncBindingsWithRegisteredCommands
     * @description 当命令注册表变化时，合并当前绑定与新的默认命令集合。
     */
    private syncBindingsWithRegisteredCommands(): void {
        const defaults = buildDefaultShortcuts();
        const nextBindings = Object.keys(defaults).reduce((accumulator, commandId) => {
            accumulator[commandId] = this.state.bindings[commandId] ?? defaults[commandId] ?? "";
            return accumulator;
        }, {} as Record<CommandId, string>);

        const currentKeys = Object.keys(this.state.bindings);
        const nextKeys = Object.keys(nextBindings);
        const changed =
            currentKeys.length !== nextKeys.length ||
            nextKeys.some((commandId) => nextBindings[commandId] !== this.state.bindings[commandId]);

        if (!changed) {
            return;
        }

        this.state = {
            ...this.state,
            bindings: nextBindings,
        };
        this.emit();
    }

    /**
     * @function setError
     * @description 设置快捷键状态错误信息。
     * @param message 错误消息。
     */
    private setError(message: string | null): void {
        this.state = {
            ...this.state,
            error: message,
        };
        this.emit();
    }

    /**
     * @function subscribe
     * @description 订阅状态变化。
     * @param listener 监听函数。
     * @returns 取消订阅函数。
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * @function emit
     * @description 广播状态变化。
     */
    private emit(): void {
        this.listeners.forEach((listener) => listener());
    }

    /**
     * @function getSnapshot
     * @description 获取状态快照。
     * @returns 快捷键状态。
     */
    getSnapshot(): ShortcutState {
        return this.state;
    }

    /**
     * @function normalizeBindings
     * @description 规范化配置中的快捷键映射，缺失项回填默认值。
     * @param config 仓库配置对象。
     * @returns 规范化结果与是否有变更。
     */
    private normalizeBindings(config: VaultConfig): {
        normalizedBindings: Record<CommandId, string>;
        changed: boolean;
        nextConfig: VaultConfig;
    } {
        const rawValue = config.entries?.[SHORTCUTS_CONFIG_KEY];
        const rawObject =
            rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
                ? (rawValue as Record<string, unknown>)
                : {};

        const defaultShortcuts = buildDefaultShortcuts();
        const normalizedBindings = Object.entries(defaultShortcuts).reduce(
            (accumulator, [commandId, defaultShortcut]) => {
                const candidate = rawObject[commandId];
                accumulator[commandId as CommandId] =
                    typeof candidate === "string" && candidate.trim().length > 0
                        ? candidate
                        : defaultShortcut;
                return accumulator;
            },
            {} as Record<CommandId, string>,
        );

        const changedByBinding = Object.keys(defaultShortcuts).some((commandId) => {
            return rawObject[commandId] !== normalizedBindings[commandId as CommandId];
        });

        const changed =
            changedByBinding ||
            typeof config.entries?.[SHORTCUTS_CONFIG_KEY] !== "object";

        const nextConfig: VaultConfig = {
            ...config,
            entries: {
                ...config.entries,
                [SHORTCUTS_CONFIG_KEY]: normalizedBindings,
            },
        };

        return {
            normalizedBindings,
            changed,
            nextConfig,
        };
    }

    /**
     * @function ensureLoadedForVault
     * @description 为指定仓库加载快捷键配置，并在缺失时持久化默认值。
     * @param vaultPath 当前仓库路径。
     */
    async ensureLoadedForVault(vaultPath: string): Promise<void> {
        if (!vaultPath || vaultPath.trim().length === 0) {
            return;
        }

        if (this.state.loadedVaultPath === vaultPath && !this.state.error) {
            return;
        }

        this.state = {
            ...this.state,
            isLoading: true,
            error: null,
        };
        this.emit();

        try {
            const config = await getCurrentVaultConfig();
            const { normalizedBindings, changed, nextConfig } = this.normalizeBindings(config);

            if (changed) {
                await saveCurrentVaultConfig(nextConfig);
            }

            this.state = {
                bindings: normalizedBindings,
                loadedVaultPath: vaultPath,
                isLoading: false,
                error: null,
            };
            this.emit();
            console.info("[shortcut-store] loaded", { vaultPath, bindings: normalizedBindings });
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("settings.loadShortcutFailed");
            this.state = {
                ...this.state,
                bindings: buildDefaultShortcuts(),
                loadedVaultPath: vaultPath,
                isLoading: false,
                error: message,
            };
            this.emit();
            console.error("[shortcut-store] load failed", { vaultPath, message });
        }
    }

    /**
     * @function updateBinding
     * @description 更新某个指令的快捷键绑定并持久化到后端配置。
     * @param commandId 指令ID。
     * @param shortcut 快捷键字符串。
     */
    async updateBinding(commandId: CommandId, shortcut: string): Promise<void> {
        const nextShortcut = normalizeShortcutString(shortcut);
        if (!nextShortcut) {
            this.setError(i18n.t("settings.shortcutInvalid"));
            return;
        }

        const bindingPolicy = getCommandBindingPolicy(commandId);
        if (isSystemReservedBinding(nextShortcut) && !allowsSystemReservedBinding(bindingPolicy)) {
            this.setError(i18n.t("settings.shortcutReservedNotAllowed"));
            return;
        }

        const previousBindings = this.state.bindings;
        const nextBindings: Record<CommandId, string> = {
            ...previousBindings,
            [commandId]: nextShortcut,
        };

        this.state = {
            ...this.state,
            bindings: nextBindings,
            error: null,
        };
        this.emit();

        try {
            const config = await getCurrentVaultConfig();
            const rawValue = config.entries?.[SHORTCUTS_CONFIG_KEY];
            const rawObject =
                rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
                    ? (rawValue as Record<string, unknown>)
                    : {};

            const persistedShortcuts = {
                ...rawObject,
                ...nextBindings,
            };

            const nextConfig: VaultConfig = {
                ...config,
                entries: {
                    ...config.entries,
                    [SHORTCUTS_CONFIG_KEY]: persistedShortcuts,
                },
            };

            await saveCurrentVaultConfig(nextConfig);
            console.info("[shortcut-store] binding updated", {
                commandId,
                shortcut: nextShortcut,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("settings.saveShortcutFailed");
            this.state = {
                ...this.state,
                bindings: previousBindings,
                error: message,
            };
            this.emit();
            console.error("[shortcut-store] update binding failed", {
                commandId,
                shortcut: nextShortcut,
                message,
            });
        }
    }
}

const shortcutStore = new ShortcutStore();

/**
 * @function useShortcutState
 * @description 订阅快捷键状态。
 * @returns 快捷键状态快照。
 */
export function useShortcutState(): ShortcutState {
    return useSyncExternalStore(
        (listener) => shortcutStore.subscribe(listener),
        () => shortcutStore.getSnapshot(),
        () => shortcutStore.getSnapshot(),
    );
}

/**
 * @function subscribeShortcutState
 * @description 对外暴露快捷键 store 的订阅接口，供治理层注册使用。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeShortcutState(listener: () => void): () => void {
    return shortcutStore.subscribe(listener);
}

/**
 * @function getShortcutStateSnapshot
 * @description 对外暴露快捷键 store 当前快照，供治理层注册使用。
 * @returns 当前快捷键状态。
 */
export function getShortcutStateSnapshot(): ShortcutState {
    return shortcutStore.getSnapshot();
}

/**
 * @function ensureShortcutBindingsLoaded
 * @description 对外能力：为当前仓库确保快捷键配置可用。
 * @param vaultPath 当前仓库路径。
 */
export async function ensureShortcutBindingsLoaded(vaultPath: string): Promise<void> {
    await shortcutStore.ensureLoadedForVault(vaultPath);
}

/**
 * @function updateShortcutBinding
 * @description 更新某个指令的快捷键绑定。
 * @param commandId 指令ID。
 * @param shortcut 快捷键字符串。
 */
export async function updateShortcutBinding(commandId: CommandId, shortcut: string): Promise<void> {
    await shortcutStore.updateBinding(commandId, shortcut);
}

/**
 * @function matchShortcut
 * @description 判断键盘事件是否命中快捷键字符串（示例：Ctrl+W）。
 * @param event 键盘事件。
 * @param shortcut 快捷键描述。
 * @returns 命中返回 true。
 */
export function matchShortcut(event: KeyboardEvent, shortcut: string): boolean {
    const parsedShortcut = parseShortcut(shortcut);
    const parsedEvent = eventToParsedShortcut(event);

    if (!parsedShortcut || !parsedEvent) {
        return false;
    }

    if (parsedShortcut.key !== parsedEvent.key) {
        return false;
    }

    const requiresCmd = parsedShortcut.modifiers.has("Cmd");
    const requiresCtrl = parsedShortcut.modifiers.has("Ctrl");
    const requiresAlt = parsedShortcut.modifiers.has("Alt");
    const requiresShift = parsedShortcut.modifiers.has("Shift");

    // 兼容历史配置：当仅声明 Ctrl 时，允许 macOS 上 Meta 命中（如早期 Ctrl+W 语义）。
    const ctrlMatches = requiresCtrl
        ? (requiresCmd ? event.ctrlKey : event.ctrlKey || event.metaKey)
        : true;
    if (!ctrlMatches) {
        return false;
    }

    if (requiresCmd && !event.metaKey) {
        return false;
    }

    const hasAlt = event.altKey || event.getModifierState("AltGraph");
    if (requiresAlt !== hasAlt) {
        return false;
    }

    if (requiresShift !== event.shiftKey) {
        return false;
    }

    if (!requiresCmd && event.metaKey) {
        return false;
    }

    if (!requiresCtrl && event.ctrlKey) {
        return false;
    }

    return true;
}
