/**
 * @module host/store/themeStore
 * @description 主题状态管理：集中维护全局界面风格，并同步到文档根节点 CSS 变量。
 * @dependencies
 *  - react (useEffect/useSyncExternalStore)
 *
 * @example
 *  - 在 App 顶层调用 useThemeSync() 同步 data-theme。
 *  - 在设置页调用 updateThemeMode("light") 切换日间主题。
 *  - 在设置页调用 updateThemeMode("kraft") 切换牛皮纸主题。
 *
 * @exports
 *  - useThemeState
 *  - useThemeSync
 *  - updateThemeMode
 *  - type ThemeMode
 */

import { useEffect, useSyncExternalStore } from "react";

/**
 * @constant THEME_MODE_STORAGE_KEY
 * @description 本地持久化键：记录用户选择的主题模式。
 */
const THEME_MODE_STORAGE_KEY = "ofive:settings:theme-mode";

/**
 * @type ThemeMode
 * @description 支持的主题模式。
 */
export type ThemeMode = "dark" | "light" | "kraft";

/**
 * @interface ThemeState
 * @description 主题模块状态快照。
 */
interface ThemeState {
    /** 当前主题模式 */
    themeMode: ThemeMode;
}

/**
 * @function isThemeMode
 * @description 判定输入值是否为合法主题模式。
 * @param value 待判定值。
 * @returns 合法时返回 true。
 */
function isThemeMode(value: unknown): value is ThemeMode {
    return value === "dark" || value === "light" || value === "kraft";
}

/**
 * @function readThemeModeFromLocal
 * @description 从 localStorage 读取主题模式。
 * @returns 读取到的主题模式；异常或缺失时返回 dark。
 */
function readThemeModeFromLocal(): ThemeMode {
    if (typeof window === "undefined") {
        return "dark";
    }

    const raw = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
    if (raw === null) {
        console.warn("[theme-store] local theme mode is null, fallback to dark");
        return "dark";
    }

    if (!isThemeMode(raw)) {
        console.warn("[theme-store] invalid local theme mode, fallback to dark", { raw });
        return "dark";
    }

    return raw;
}

/**
 * @function writeThemeModeToLocal
 * @description 写入主题模式到 localStorage。
 * @param themeMode 要写入的主题模式。
 */
function writeThemeModeToLocal(themeMode: ThemeMode): void {
    if (typeof window === "undefined") {
        return;
    }
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
}

/**
 * @function applyThemeToDocument
 * @description 将主题模式同步到文档根节点，驱动全局 CSS 变量切换。
 * @param themeMode 主题模式。
 */
function applyThemeToDocument(themeMode: ThemeMode): void {
    if (typeof document === "undefined") {
        return;
    }
    document.documentElement.setAttribute("data-theme", themeMode);
}

/**
 * @class ThemeStore
 * @description 主题状态存储实现。
 *
 * @state
 *  - themeMode - 当前主题模式 (ThemeMode) ["dark"]
 *
 * @lifecycle
 *  - 初始化时机：模块首次导入时读取 localStorage。
 *  - 数据来源：浏览器 localStorage（ofive:settings:theme-mode）。
 *  - 更新触发：updateThemeMode。
 *  - 清理时机：页面刷新后重建内存状态。
 *
 * @sync
 *  - 与后端同步：否（纯前端 UI 风格状态）。
 *  - 缓存策略：内存快照 + localStorage 持久化。
 *  - 与其他Store的关系：由 App 通过 useThemeSync 驱动文档样式。
 */
class ThemeStore {
    private state: ThemeState = {
        themeMode: readThemeModeFromLocal(),
    };

    private listeners = new Set<() => void>();

    constructor() {
        applyThemeToDocument(this.state.themeMode);
        console.info("[theme-store] initialized", { themeMode: this.state.themeMode });
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getSnapshot(): ThemeState {
        return this.state;
    }

    updateThemeMode(themeMode: ThemeMode): void {
        if (this.state.themeMode === themeMode) {
            return;
        }

        const previousMode = this.state.themeMode;
        this.state = {
            ...this.state,
            themeMode,
        };

        writeThemeModeToLocal(themeMode);
        applyThemeToDocument(themeMode);
        this.listeners.forEach((listener) => listener());

        console.info("[theme-store] theme mode updated", {
            previousMode,
            nextMode: themeMode,
        });
    }

    syncThemeToDocument(): void {
        applyThemeToDocument(this.state.themeMode);
    }
}

const themeStore = new ThemeStore();

/**
 * @function useThemeState
 * @description 订阅主题状态快照。
 * @returns 当前主题状态。
 */
export function useThemeState(): ThemeState {
    return useSyncExternalStore(
        (listener) => themeStore.subscribe(listener),
        () => themeStore.getSnapshot(),
        () => themeStore.getSnapshot(),
    );
}

/**
 * @function updateThemeMode
 * @description 更新主题模式并同步到文档样式与本地存储。
 * @param themeMode 目标主题模式。
 */
export function updateThemeMode(themeMode: ThemeMode): void {
    themeStore.updateThemeMode(themeMode);
}

/**
 * @function useThemeSync
 * @description React Hook：确保当前主题始终同步到 document 根节点。
 */
export function useThemeSync(): void {
    const themeState = useThemeState();

    useEffect(() => {
        themeStore.syncThemeToDocument();
    }, [themeState.themeMode]);
}
