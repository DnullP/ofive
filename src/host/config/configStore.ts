/**
 * @module host/config/configStore
 * @description 配置模块：统一管理后端仓库配置与前端本地配置，并提供纯前端事件发布能力。
 * @dependencies
 *  - react (useEffect/useSyncExternalStore)
 *  - ../../api/vaultApi
 */

import { useEffect, useSyncExternalStore } from "react";
import {
    getCurrentVaultConfig,
    isSelfTriggeredVaultConfigEvent,
    saveCurrentVaultConfig,
    type VaultConfig,
    type VaultConfigEventPayload,
} from "../../api/vaultApi";
import { subscribeVaultConfigBusEvent } from "../events/appEventBus";
import {
    isEditorTabRestoreMode,
    type EditorTabRestoreMode,
} from "./editorTabRestoreMode";
import i18n from "../../i18n";

/**
 * @constant DEFAULT_EDITOR_FONT_FAMILY
 * @description 编辑器默认字体族，使用 San Francisco 系统字体。
 * 采用系统 UI 字体栈：macOS 下即为 San Francisco，其余平台使用对应系统 UI 字体。
 */
export const DEFAULT_EDITOR_FONT_FAMILY =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * @constant FONT_FAMILY_PRESETS
 * @description 编辑器字体预设列表，供设置页面下拉框使用。
 * 每项包含 label（显示名称的 i18n key）和 value（CSS font-family 值）。
 */
export const FONT_FAMILY_PRESETS: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
    { label: "settings.fontPresetSanFrancisco", value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
    { label: "settings.fontPresetInter", value: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
    { label: "settings.fontPresetGeorgia", value: 'Georgia, "Times New Roman", Times, serif' },
    { label: "settings.fontPresetMonospace", value: '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' },
];

/**
 * @constant CONFIG_CHANGE_EVENT_NAME
 * @description 纯前端配置变更事件名称。
 */
const CONFIG_CHANGE_EVENT_NAME = "ofive:config-changed";

/**
 * @constant FRONTEND_REMEMBER_LAST_VAULT_KEY
 * @description 前端本地配置键：是否记住上次打开仓库。
 * @design
 *  - 仅该项允许使用 localStorage。
 *  - 原因：应用尚未打开仓库时，无法读取仓库内配置文件，必须先通过本地信息恢复“默认打开哪个仓库”。
 *  - 其余业务设置（如图谱/快捷键/Vim 等）应持久化到仓库配置，保证设置跟随仓库而非跟随设备浏览器缓存。
 */
const FRONTEND_REMEMBER_LAST_VAULT_KEY = "ofive:settings:remember-last-vault";

/**
 * @constant LAST_VAULT_PATH_STORAGE_KEY
 * @description 与 vault store 保持一致的上次仓库存储键，用于关闭“记住仓库”时清理。
 */
const LAST_VAULT_PATH_STORAGE_KEY = "ofive:last-vault-path";

/**
 * @interface FeatureSettings
 * @description 功能开关与编辑器体验配置。
 * @field searchEnabled - 是否开启搜索功能
 * @field knowledgeGraphEnabled - 是否开启知识图谱功能
 * @field glassEffectEnabled - 是否开启桌面毛玻璃效果
 * @field glassTintOpacity - 毛玻璃基础底色透明度（0.02–0.24）
 * @field glassSurfaceOpacity - 毛玻璃表面透明度（0.08–0.4）
 * @field glassInactiveSurfaceOpacity - 失焦时毛玻璃表面透明度（0.04–0.4）
 * @field glassBlurRadius - 毛玻璃模糊半径（4–24 px）
 * @field windowsAcrylicFocusedRed - Windows 聚焦 Acrylic 红色通道（0–255）
 * @field windowsAcrylicFocusedGreen - Windows 聚焦 Acrylic 绿色通道（0–255）
 * @field windowsAcrylicFocusedBlue - Windows 聚焦 Acrylic 蓝色通道（0–255）
 * @field windowsAcrylicFocusedAlpha - Windows 聚焦 Acrylic 透明度通道（0–255）
 * @field windowsAcrylicInactiveRed - Windows 失焦 Acrylic 红色通道（0–255）
 * @field windowsAcrylicInactiveGreen - Windows 失焦 Acrylic 绿色通道（0–255）
 * @field windowsAcrylicInactiveBlue - Windows 失焦 Acrylic 蓝色通道（0–255）
 * @field windowsAcrylicInactiveAlpha - Windows 失焦 Acrylic 透明度通道（0–255）
 * @field windowsAcrylicDisableSystemBackdrop - Windows 应用自定义 Acrylic 前是否先关闭系统 backdrop
 * @field windowsAcrylicFocusedAccentFlags - Windows 聚焦 Acrylic AccentFlags（u32）
 * @field windowsAcrylicFocusedAnimationId - Windows 聚焦 Acrylic AnimationId（u32）
 * @field windowsAcrylicInactiveAccentFlags - Windows 失焦 Acrylic AccentFlags（u32）
 * @field windowsAcrylicInactiveAnimationId - Windows 失焦 Acrylic AnimationId（u32）
 * @field vimModeEnabled - 是否开启 Vim 编辑模式
 * @field editorFontSize - 编辑器字体大小（px），范围 10–32
 * @field editorTabSize - Tab 缩进宽度（空格数），范围 1–8
 * @field editorLineWrapping - 是否开启自动换行
 * @field editorTabRestoreMode - Tab 切换/重建时优先恢复视图位置还是光标位置
 * @field editorTabOutEnabled - 是否开启编辑器 TabOut（光标位于闭合括号前时按 Tab 跳出）
 * @field editorLineNumbers - 行号显示模式："off" 隐藏 | "absolute" 绝对行号 | "relative" 相对行号
 * @field autoSaveEnabled - 是否开启自动保存
 * @field autoSaveDelayMs - 自动保存防抖延迟（毫秒），范围 500–10000
 * @field editorFontFamily - 编辑器字体族，默认与 Obsidian 一致的无衬线字体栈
 * @field notificationsEnabled - 是否开启前端消息通知
 * @field notificationsMaxVisible - 前端同时最多显示的通知数量，范围 1–10
 * @field frontmatterTemplate - Frontmatter 模板，支持 {{filename}} / {{date}} / {{directory}} 占位符
 * @field restoreWorkspaceLayout - 重启时是否恢复上次的工作区布局和标签页
 */
export interface FeatureSettings {
    /** 是否开启搜索功能（后端配置） */
    searchEnabled: boolean;
    /** 是否开启知识图谱功能（后端配置） */
    knowledgeGraphEnabled: boolean;
    /** 是否开启桌面毛玻璃效果（后端配置） */
    glassEffectEnabled: boolean;
    /** 毛玻璃基础底色透明度（0.02–0.24），默认 0.08 */
    glassTintOpacity: number;
    /** 毛玻璃表面透明度（0.08–0.40），默认 0.18 */
    glassSurfaceOpacity: number;
    /** 失焦时毛玻璃表面透明度（0.04–0.40），默认 0.14 */
    glassInactiveSurfaceOpacity: number;
    /** 毛玻璃模糊半径（4–24 px），默认 10 */
    glassBlurRadius: number;
    /** Windows 聚焦 Acrylic 红色通道（0–255），默认 56 */
    windowsAcrylicFocusedRed: number;
    /** Windows 聚焦 Acrylic 绿色通道（0–255），默认 64 */
    windowsAcrylicFocusedGreen: number;
    /** Windows 聚焦 Acrylic 蓝色通道（0–255），默认 76 */
    windowsAcrylicFocusedBlue: number;
    /** Windows 聚焦 Acrylic 透明度通道（0–255），默认 72 */
    windowsAcrylicFocusedAlpha: number;
    /** Windows 失焦 Acrylic 红色通道（0–255），默认 64 */
    windowsAcrylicInactiveRed: number;
    /** Windows 失焦 Acrylic 绿色通道（0–255），默认 72 */
    windowsAcrylicInactiveGreen: number;
    /** Windows 失焦 Acrylic 蓝色通道（0–255），默认 84 */
    windowsAcrylicInactiveBlue: number;
    /** Windows 失焦 Acrylic 透明度通道（0–255），默认 56 */
    windowsAcrylicInactiveAlpha: number;
    /** Windows 应用自定义 Acrylic 前是否先关闭系统 backdrop，默认 true */
    windowsAcrylicDisableSystemBackdrop: boolean;
    /** Windows 聚焦 Acrylic AccentFlags（u32），默认 0 */
    windowsAcrylicFocusedAccentFlags: number;
    /** Windows 聚焦 Acrylic AnimationId（u32），默认 0 */
    windowsAcrylicFocusedAnimationId: number;
    /** Windows 失焦 Acrylic AccentFlags（u32），默认 0 */
    windowsAcrylicInactiveAccentFlags: number;
    /** Windows 失焦 Acrylic AnimationId（u32），默认 0 */
    windowsAcrylicInactiveAnimationId: number;
    /** 是否开启 Vim 编辑模式（后端配置） */
    vimModeEnabled: boolean;
    /** 编辑器字体大小（px），默认 16 */
    editorFontSize: number;
    /** Tab 缩进宽度（空格数），默认 4 */
    editorTabSize: number;
    /** 是否开启自动换行，默认 true */
    editorLineWrapping: boolean;
    /** Tab 切换/重建时优先恢复视图位置还是光标位置，默认 "viewport" */
    editorTabRestoreMode: EditorTabRestoreMode;
    /** 光标位于闭合括号前时按 Tab 跳到闭合括号右侧，默认 true */
    editorTabOutEnabled: boolean;
    /** 行号显示模式："off" 隐藏 | "absolute" 绝对行号 | "relative" 相对行号，默认 "absolute" */
    editorLineNumbers: "off" | "absolute" | "relative";
    /** 是否开启自动保存，默认 true */
    autoSaveEnabled: boolean;
    /** 自动保存防抖延迟（毫秒），默认 1500，范围 500–10000 */
    autoSaveDelayMs: number;
    /** 编辑器字体族，默认 Obsidian 同款无衬线字体栈 */
    editorFontFamily: string;
    /** 是否开启前端消息通知，默认 true */
    notificationsEnabled: boolean;
    /** 前端同时最多显示的通知数量，默认 3，范围 1–10 */
    notificationsMaxVisible: number;
    /** Frontmatter 模板，支持 {{filename}} / {{date}} / {{directory}} 占位符 */
    frontmatterTemplate: string;
    /** 重启时是否恢复上次的工作区布局和标签页，默认 true */
    restoreWorkspaceLayout: boolean;
}

/**
 * @interface FrontendSettings
 * @description 前端本地配置。
 */
interface FrontendSettings {
    /** 是否记住上次打开仓库（前端配置） */
    rememberLastVault: boolean;
}

/**
 * @interface ConfigState
 * @description 配置模块全局状态。
 */
interface ConfigState {
    loadedVaultPath: string | null;
    backendConfig: VaultConfig | null;
    featureSettings: FeatureSettings;
    frontendSettings: FrontendSettings;
    isLoading: boolean;
    error: string | null;
}

/**
 * @interface UpdateBackendConfigOptions
 * @description 通用后端配置写入选项。
 */
interface UpdateBackendConfigOptions {
    /** 日志标签，用于区分调用来源。 */
    logLabel?: string;
    /** 保存失败时的兜底 i18n key。 */
    fallbackErrorI18nKey?: string;
}

/**
 * @interface ConfigChangedEventDetail
 * @description 配置变更事件详情。
 */
interface ConfigChangedEventDetail {
    state: ConfigState;
}

const configEventTarget = new EventTarget();

/**
 * @constant DEFAULT_FEATURE_SETTINGS
 * @description 无仓库上下文或后端缺省字段时使用的功能配置默认值。
 */
export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
    searchEnabled: true,
    knowledgeGraphEnabled: true,
    glassEffectEnabled: true,
    glassTintOpacity: 0.05,
    glassSurfaceOpacity: 0.12,
    glassInactiveSurfaceOpacity: 0.09,
    glassBlurRadius: 8,
    windowsAcrylicFocusedRed: 56,
    windowsAcrylicFocusedGreen: 64,
    windowsAcrylicFocusedBlue: 76,
    windowsAcrylicFocusedAlpha: 72,
    windowsAcrylicInactiveRed: 64,
    windowsAcrylicInactiveGreen: 72,
    windowsAcrylicInactiveBlue: 84,
    windowsAcrylicInactiveAlpha: 56,
    windowsAcrylicDisableSystemBackdrop: true,
    windowsAcrylicFocusedAccentFlags: 0,
    windowsAcrylicFocusedAnimationId: 0,
    windowsAcrylicInactiveAccentFlags: 0,
    windowsAcrylicInactiveAnimationId: 0,
    vimModeEnabled: false,
    editorFontSize: 16,
    editorTabSize: 4,
    editorLineWrapping: true,
    editorTabRestoreMode: "viewport",
    editorTabOutEnabled: true,
    editorLineNumbers: "absolute",
    autoSaveEnabled: true,
    autoSaveDelayMs: 1500,
    editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
    notificationsEnabled: true,
    notificationsMaxVisible: 3,
    frontmatterTemplate: "---\ntitle: {{filename}}\ndate: {{date}}\n---",
    restoreWorkspaceLayout: true,
};

/**
 * @function buildDefaultFeatureSettings
 * @description 生成一份可安全写入 store 的默认功能配置快照。
 * @returns 默认功能配置副本。
 */
function buildDefaultFeatureSettings(): FeatureSettings {
    return {
        ...DEFAULT_FEATURE_SETTINGS,
    };
}

/**
 * @function readRememberLastVaultFromLocal
 * @description 读取“记住上次仓库”本地开关。
 * @returns 配置值，默认 true。
 */
function readRememberLastVaultFromLocal(): boolean {
    if (typeof window === "undefined") {
        return true;
    }

    const raw = window.localStorage.getItem(FRONTEND_REMEMBER_LAST_VAULT_KEY);
    if (raw === null) {
        return true;
    }

    return raw === "true";
}

/**
 * @function writeRememberLastVaultToLocal
 * @description 写入“记住上次仓库”本地开关。
 * @param value 配置值。
 */
function writeRememberLastVaultToLocal(value: boolean): void {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(FRONTEND_REMEMBER_LAST_VAULT_KEY, String(value));
    if (!value) {
        window.localStorage.removeItem(LAST_VAULT_PATH_STORAGE_KEY);
    }
}

/**
 * @function isRememberLastVaultEnabled
 * @description 对外暴露：读取当前“记住上次仓库”配置。
 * @returns 若开启返回 true。
 */
export function isRememberLastVaultEnabled(): boolean {
    return readRememberLastVaultFromLocal();
}

function normalizeByteFeature(
    value: unknown,
    fallback: number,
): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeUint32Feature(
    value: unknown,
    fallback: number,
): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(0, Math.min(4294967295, Math.round(value)));
}

/**
 * @function normalizeBackendConfig
 * @description 规范化后端配置，确保 feature 开关结构完整。
 * @param config 原始后端配置。
 * @returns 规范化后配置与 feature 配置。
 */
function normalizeBackendConfig(config: VaultConfig): {
    nextConfig: VaultConfig;
    featureSettings: FeatureSettings;
    changed: boolean;
} {
    const featuresRaw = config.entries.features;
    const featuresObj =
        featuresRaw && typeof featuresRaw === "object" && !Array.isArray(featuresRaw)
            ? (featuresRaw as Record<string, unknown>)
            : {};

    const searchEnabled =
        typeof featuresObj.searchEnabled === "boolean"
            ? featuresObj.searchEnabled
            : DEFAULT_FEATURE_SETTINGS.searchEnabled;
    const knowledgeGraphEnabled =
        typeof featuresObj.knowledgeGraphEnabled === "boolean"
            ? featuresObj.knowledgeGraphEnabled
            : DEFAULT_FEATURE_SETTINGS.knowledgeGraphEnabled;
    const glassEffectEnabled =
        typeof featuresObj.glassEffectEnabled === "boolean"
            ? featuresObj.glassEffectEnabled
            : DEFAULT_FEATURE_SETTINGS.glassEffectEnabled;
    const glassTintOpacity =
        typeof featuresObj.glassTintOpacity === "number" &&
            Number.isFinite(featuresObj.glassTintOpacity) &&
            (featuresObj.glassTintOpacity as number) >= 0.02 &&
            (featuresObj.glassTintOpacity as number) <= 0.24
            ? (featuresObj.glassTintOpacity as number)
            : DEFAULT_FEATURE_SETTINGS.glassTintOpacity;
    const glassSurfaceOpacity =
        typeof featuresObj.glassSurfaceOpacity === "number" &&
            Number.isFinite(featuresObj.glassSurfaceOpacity) &&
            (featuresObj.glassSurfaceOpacity as number) >= 0.08 &&
            (featuresObj.glassSurfaceOpacity as number) <= 0.40
            ? (featuresObj.glassSurfaceOpacity as number)
            : DEFAULT_FEATURE_SETTINGS.glassSurfaceOpacity;
    const glassInactiveSurfaceOpacity =
        typeof featuresObj.glassInactiveSurfaceOpacity === "number" &&
            Number.isFinite(featuresObj.glassInactiveSurfaceOpacity) &&
            (featuresObj.glassInactiveSurfaceOpacity as number) >= 0.04 &&
            (featuresObj.glassInactiveSurfaceOpacity as number) <= 0.40
            ? (featuresObj.glassInactiveSurfaceOpacity as number)
            : DEFAULT_FEATURE_SETTINGS.glassInactiveSurfaceOpacity;
    const glassBlurRadius =
        typeof featuresObj.glassBlurRadius === "number" &&
            Number.isFinite(featuresObj.glassBlurRadius) &&
            (featuresObj.glassBlurRadius as number) >= 4 &&
            (featuresObj.glassBlurRadius as number) <= 24
            ? (featuresObj.glassBlurRadius as number)
            : DEFAULT_FEATURE_SETTINGS.glassBlurRadius;
    const windowsAcrylicFocusedRed =
        normalizeByteFeature(
            featuresObj.windowsAcrylicFocusedRed,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedRed,
        );
    const windowsAcrylicFocusedGreen =
        normalizeByteFeature(
            featuresObj.windowsAcrylicFocusedGreen,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedGreen,
        );
    const windowsAcrylicFocusedBlue =
        normalizeByteFeature(
            featuresObj.windowsAcrylicFocusedBlue,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedBlue,
        );
    const windowsAcrylicFocusedAlpha =
        normalizeByteFeature(
            featuresObj.windowsAcrylicFocusedAlpha,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedAlpha,
        );
    const windowsAcrylicInactiveRed =
        normalizeByteFeature(
            featuresObj.windowsAcrylicInactiveRed,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveRed,
        );
    const windowsAcrylicInactiveGreen =
        normalizeByteFeature(
            featuresObj.windowsAcrylicInactiveGreen,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveGreen,
        );
    const windowsAcrylicInactiveBlue =
        normalizeByteFeature(
            featuresObj.windowsAcrylicInactiveBlue,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveBlue,
        );
    const windowsAcrylicInactiveAlpha =
        normalizeByteFeature(
            featuresObj.windowsAcrylicInactiveAlpha,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveAlpha,
        );
    const windowsAcrylicDisableSystemBackdrop =
        typeof featuresObj.windowsAcrylicDisableSystemBackdrop === "boolean"
            ? featuresObj.windowsAcrylicDisableSystemBackdrop
            : DEFAULT_FEATURE_SETTINGS.windowsAcrylicDisableSystemBackdrop;
    const windowsAcrylicFocusedAccentFlags =
        normalizeUint32Feature(
            featuresObj.windowsAcrylicFocusedAccentFlags,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedAccentFlags,
        );
    const windowsAcrylicFocusedAnimationId =
        normalizeUint32Feature(
            featuresObj.windowsAcrylicFocusedAnimationId,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedAnimationId,
        );
    const windowsAcrylicInactiveAccentFlags =
        normalizeUint32Feature(
            featuresObj.windowsAcrylicInactiveAccentFlags,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveAccentFlags,
        );
    const windowsAcrylicInactiveAnimationId =
        normalizeUint32Feature(
            featuresObj.windowsAcrylicInactiveAnimationId,
            DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveAnimationId,
        );
    const vimModeEnabled =
        typeof featuresObj.vimModeEnabled === "boolean"
            ? featuresObj.vimModeEnabled
            : DEFAULT_FEATURE_SETTINGS.vimModeEnabled;
    const editorFontSize =
        typeof featuresObj.editorFontSize === "number" &&
            Number.isFinite(featuresObj.editorFontSize) &&
            (featuresObj.editorFontSize as number) >= 10 &&
            (featuresObj.editorFontSize as number) <= 32
            ? (featuresObj.editorFontSize as number)
            : DEFAULT_FEATURE_SETTINGS.editorFontSize;
    const editorTabSize =
        typeof featuresObj.editorTabSize === "number" &&
            Number.isFinite(featuresObj.editorTabSize) &&
            (featuresObj.editorTabSize as number) >= 1 &&
            (featuresObj.editorTabSize as number) <= 8
            ? (featuresObj.editorTabSize as number)
            : DEFAULT_FEATURE_SETTINGS.editorTabSize;
    const editorLineWrapping =
        typeof featuresObj.editorLineWrapping === "boolean"
            ? featuresObj.editorLineWrapping
            : DEFAULT_FEATURE_SETTINGS.editorLineWrapping;
    const editorTabRestoreMode = isEditorTabRestoreMode(featuresObj.editorTabRestoreMode)
        ? featuresObj.editorTabRestoreMode
        : DEFAULT_FEATURE_SETTINGS.editorTabRestoreMode;
    const editorTabOutEnabled =
        typeof featuresObj.editorTabOutEnabled === "boolean"
            ? featuresObj.editorTabOutEnabled
            : DEFAULT_FEATURE_SETTINGS.editorTabOutEnabled;
    /* 行号模式：兼容旧版 boolean 值（true→"absolute"，false→"off"） */
    const editorLineNumbers: "off" | "absolute" | "relative" = (() => {
        const raw = featuresObj.editorLineNumbers;
        if (raw === "off" || raw === "absolute" || raw === "relative") {
            return raw;
        }
        if (typeof raw === "boolean") {
            return raw ? "absolute" : "off";
        }
        return DEFAULT_FEATURE_SETTINGS.editorLineNumbers;
    })();
    const autoSaveEnabled =
        typeof featuresObj.autoSaveEnabled === "boolean"
            ? featuresObj.autoSaveEnabled
            : DEFAULT_FEATURE_SETTINGS.autoSaveEnabled;
    const autoSaveDelayMs =
        typeof featuresObj.autoSaveDelayMs === "number" &&
            Number.isFinite(featuresObj.autoSaveDelayMs) &&
            (featuresObj.autoSaveDelayMs as number) >= 500 &&
            (featuresObj.autoSaveDelayMs as number) <= 10000
            ? (featuresObj.autoSaveDelayMs as number)
            : DEFAULT_FEATURE_SETTINGS.autoSaveDelayMs;
    const editorFontFamily =
        typeof featuresObj.editorFontFamily === "string" &&
            (featuresObj.editorFontFamily as string).trim().length > 0
            ? (featuresObj.editorFontFamily as string).trim()
            : DEFAULT_FEATURE_SETTINGS.editorFontFamily;
    const notificationsEnabled =
        typeof featuresObj.notificationsEnabled === "boolean"
            ? featuresObj.notificationsEnabled
            : DEFAULT_FEATURE_SETTINGS.notificationsEnabled;
    const notificationsMaxVisible =
        typeof featuresObj.notificationsMaxVisible === "number" &&
            Number.isFinite(featuresObj.notificationsMaxVisible) &&
            (featuresObj.notificationsMaxVisible as number) >= 1 &&
            (featuresObj.notificationsMaxVisible as number) <= 10
            ? (featuresObj.notificationsMaxVisible as number)
            : DEFAULT_FEATURE_SETTINGS.notificationsMaxVisible;
    const frontmatterTemplate =
        typeof featuresObj.frontmatterTemplate === "string"
            ? (featuresObj.frontmatterTemplate as string)
            : DEFAULT_FEATURE_SETTINGS.frontmatterTemplate;
    const restoreWorkspaceLayout =
        typeof featuresObj.restoreWorkspaceLayout === "boolean"
            ? featuresObj.restoreWorkspaceLayout
            : DEFAULT_FEATURE_SETTINGS.restoreWorkspaceLayout;

    const nextFeatures = {
        ...featuresObj,
        searchEnabled,
        knowledgeGraphEnabled,
        glassEffectEnabled,
        glassTintOpacity,
        glassSurfaceOpacity,
        glassInactiveSurfaceOpacity,
        glassBlurRadius,
        windowsAcrylicFocusedRed,
        windowsAcrylicFocusedGreen,
        windowsAcrylicFocusedBlue,
        windowsAcrylicFocusedAlpha,
        windowsAcrylicInactiveRed,
        windowsAcrylicInactiveGreen,
        windowsAcrylicInactiveBlue,
        windowsAcrylicInactiveAlpha,
        windowsAcrylicDisableSystemBackdrop,
        windowsAcrylicFocusedAccentFlags,
        windowsAcrylicFocusedAnimationId,
        windowsAcrylicInactiveAccentFlags,
        windowsAcrylicInactiveAnimationId,
        vimModeEnabled,
        editorFontSize,
        editorTabSize,
        editorLineWrapping,
        editorTabRestoreMode,
        editorTabOutEnabled,
        editorLineNumbers,
        autoSaveEnabled,
        autoSaveDelayMs,
        editorFontFamily,
        notificationsEnabled,
        notificationsMaxVisible,
        frontmatterTemplate,
        restoreWorkspaceLayout,
    };

    const nextConfig: VaultConfig = {
        ...config,
        entries: {
            ...config.entries,
            features: nextFeatures,
        },
    };

    const changed =
        featuresObj.searchEnabled !== searchEnabled ||
        featuresObj.knowledgeGraphEnabled !== knowledgeGraphEnabled ||
        featuresObj.glassEffectEnabled !== glassEffectEnabled ||
        featuresObj.glassTintOpacity !== glassTintOpacity ||
        featuresObj.glassSurfaceOpacity !== glassSurfaceOpacity ||
        featuresObj.glassInactiveSurfaceOpacity !== glassInactiveSurfaceOpacity ||
        featuresObj.glassBlurRadius !== glassBlurRadius ||
        featuresObj.windowsAcrylicFocusedRed !== windowsAcrylicFocusedRed ||
        featuresObj.windowsAcrylicFocusedGreen !== windowsAcrylicFocusedGreen ||
        featuresObj.windowsAcrylicFocusedBlue !== windowsAcrylicFocusedBlue ||
        featuresObj.windowsAcrylicFocusedAlpha !== windowsAcrylicFocusedAlpha ||
        featuresObj.windowsAcrylicInactiveRed !== windowsAcrylicInactiveRed ||
        featuresObj.windowsAcrylicInactiveGreen !== windowsAcrylicInactiveGreen ||
        featuresObj.windowsAcrylicInactiveBlue !== windowsAcrylicInactiveBlue ||
        featuresObj.windowsAcrylicInactiveAlpha !== windowsAcrylicInactiveAlpha ||
        featuresObj.windowsAcrylicDisableSystemBackdrop !== windowsAcrylicDisableSystemBackdrop ||
        featuresObj.windowsAcrylicFocusedAccentFlags !== windowsAcrylicFocusedAccentFlags ||
        featuresObj.windowsAcrylicFocusedAnimationId !== windowsAcrylicFocusedAnimationId ||
        featuresObj.windowsAcrylicInactiveAccentFlags !== windowsAcrylicInactiveAccentFlags ||
        featuresObj.windowsAcrylicInactiveAnimationId !== windowsAcrylicInactiveAnimationId ||
        featuresObj.vimModeEnabled !== vimModeEnabled ||
        featuresObj.editorFontSize !== editorFontSize ||
        featuresObj.editorTabSize !== editorTabSize ||
        featuresObj.editorLineWrapping !== editorLineWrapping ||
        featuresObj.editorTabRestoreMode !== editorTabRestoreMode ||
        featuresObj.editorTabOutEnabled !== editorTabOutEnabled ||
        featuresObj.editorLineNumbers !== editorLineNumbers ||
        featuresObj.autoSaveEnabled !== autoSaveEnabled ||
        featuresObj.autoSaveDelayMs !== autoSaveDelayMs ||
        featuresObj.editorFontFamily !== editorFontFamily ||
        featuresObj.notificationsEnabled !== notificationsEnabled ||
        featuresObj.notificationsMaxVisible !== notificationsMaxVisible ||
        featuresObj.frontmatterTemplate !== frontmatterTemplate ||
        featuresObj.restoreWorkspaceLayout !== restoreWorkspaceLayout;

    return {
        nextConfig,
        featureSettings: {
            searchEnabled,
            knowledgeGraphEnabled,
            glassEffectEnabled,
            glassTintOpacity,
            glassSurfaceOpacity,
            glassInactiveSurfaceOpacity,
            glassBlurRadius,
            windowsAcrylicFocusedRed,
            windowsAcrylicFocusedGreen,
            windowsAcrylicFocusedBlue,
            windowsAcrylicFocusedAlpha,
            windowsAcrylicInactiveRed,
            windowsAcrylicInactiveGreen,
            windowsAcrylicInactiveBlue,
            windowsAcrylicInactiveAlpha,
            windowsAcrylicDisableSystemBackdrop,
            windowsAcrylicFocusedAccentFlags,
            windowsAcrylicFocusedAnimationId,
            windowsAcrylicInactiveAccentFlags,
            windowsAcrylicInactiveAnimationId,
            vimModeEnabled,
            editorFontSize,
            editorTabSize,
            editorLineWrapping,
            editorTabRestoreMode,
            editorTabOutEnabled,
            editorLineNumbers,
            autoSaveEnabled,
            autoSaveDelayMs,
            editorFontFamily,
            notificationsEnabled,
            notificationsMaxVisible,
            frontmatterTemplate,
            restoreWorkspaceLayout,
        },
        changed,
    };
}

/**
 * @class ConfigStore
 * @description 配置状态存储，负责加载、同步、更新与事件发布。
 */
class ConfigStore {
    private state: ConfigState = {
        loadedVaultPath: null,
        backendConfig: null,
        featureSettings: buildDefaultFeatureSettings(),
        frontendSettings: {
            rememberLastVault: readRememberLastVaultFromLocal(),
        },
        isLoading: false,
        error: null,
    };

    private listeners = new Set<() => void>();
    private activeVaultUnlisten: (() => void) | null = null;
    private latestHandledEventId: string | null = null;
    private backendConfigWriteQueue: Promise<unknown> = Promise.resolve();

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(): void {
        this.listeners.forEach((listener) => listener());
        configEventTarget.dispatchEvent(
            new CustomEvent<ConfigChangedEventDetail>(CONFIG_CHANGE_EVENT_NAME, {
                detail: { state: this.state },
            }),
        );
    }

    getSnapshot(): ConfigState {
        return this.state;
    }

    resetForNoVault(): void {
        if (this.activeVaultUnlisten) {
            this.activeVaultUnlisten();
            this.activeVaultUnlisten = null;
        }

        this.latestHandledEventId = null;
        this.state = {
            ...this.state,
            loadedVaultPath: null,
            backendConfig: null,
            featureSettings: buildDefaultFeatureSettings(),
            frontendSettings: {
                rememberLastVault: readRememberLastVaultFromLocal(),
            },
            isLoading: false,
            error: null,
        };
        this.emit();
        console.info("[config-store] reset to default feature settings for empty vault context");
    }

    async ensureLoaded(vaultPath: string): Promise<void> {
        if (!vaultPath || vaultPath.trim().length === 0) {
            return;
        }

        if (this.state.loadedVaultPath === vaultPath && !this.state.error) {
            return;
        }

        this.state = {
            ...this.state,
            loadedVaultPath: vaultPath,
            isLoading: true,
            error: null,
        };
        this.emit();

        try {
            const rawConfig = await getCurrentVaultConfig();
            const { nextConfig, featureSettings, changed } = normalizeBackendConfig(rawConfig);

            if (changed) {
                await saveCurrentVaultConfig(nextConfig);
            }

            this.state = {
                ...this.state,
                backendConfig: nextConfig,
                featureSettings,
                frontendSettings: {
                    rememberLastVault: readRememberLastVaultFromLocal(),
                },
                isLoading: false,
                error: null,
            };
            this.emit();

            this.bindVaultConfigFileSubscription(vaultPath);
            console.info("[config-store] loaded", {
                vaultPath,
                featureSettings,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("store.loadConfigFailed");
            this.state = {
                ...this.state,
                isLoading: false,
                error: message,
            };
            this.emit();
            console.error("[config-store] load failed", { vaultPath, message });
        }
    }

    private bindVaultConfigFileSubscription(vaultPath: string): void {
        if (this.activeVaultUnlisten) {
            this.activeVaultUnlisten();
            this.activeVaultUnlisten = null;
        }

        this.activeVaultUnlisten = subscribeVaultConfigBusEvent((eventPayload) => {
            if (this.state.loadedVaultPath !== vaultPath) {
                return;
            }

            if (isSelfTriggeredVaultConfigEvent(eventPayload)) {
                console.info("[config-store] skip self-triggered config event", {
                    eventId: eventPayload.eventId,
                    sourceTraceId: eventPayload.sourceTraceId,
                    eventType: eventPayload.eventType,
                    relativePath: eventPayload.relativePath,
                });
                return;
            }

            if (this.latestHandledEventId === eventPayload.eventId) {
                return;
            }
            this.latestHandledEventId = eventPayload.eventId;

            // 设计预留：未来保存流程会使用 sourceTraceId 做“自触发事件”过滤。
            // 当前阶段仅基于后端事件刷新配置快照。
            void this.reloadBackendConfigByEvent(eventPayload);
        });
    }

    private async reloadBackendConfigByEvent(eventPayload: VaultConfigEventPayload): Promise<void> {
        if (eventPayload.eventType === "deleted") {
            return;
        }

        try {
            const rawConfig = await getCurrentVaultConfig();
            const { nextConfig, featureSettings } = normalizeBackendConfig(rawConfig);

            this.state = {
                ...this.state,
                backendConfig: nextConfig,
                featureSettings,
                error: null,
            };
            this.emit();
            console.info("[config-store] reloaded by backend event", {
                eventId: eventPayload.eventId,
                eventType: eventPayload.eventType,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("store.refreshConfigFailed");
            this.state = {
                ...this.state,
                error: message,
            };
            this.emit();
            console.error("[config-store] reload by event failed", { message, eventPayload });
        }
    }

    async setSearchEnabled(nextValue: boolean): Promise<void> {
        const currentConfig = this.state.backendConfig;
        if (!currentConfig) {
            return;
        }

        const featuresRaw = currentConfig.entries.features;
        const featuresObj =
            featuresRaw && typeof featuresRaw === "object" && !Array.isArray(featuresRaw)
                ? (featuresRaw as Record<string, unknown>)
                : {};

        const nextConfig: VaultConfig = {
            ...currentConfig,
            entries: {
                ...currentConfig.entries,
                features: {
                    ...featuresObj,
                    searchEnabled: nextValue,
                },
            },
        };

        this.state = {
            ...this.state,
            backendConfig: nextConfig,
            featureSettings: {
                ...this.state.featureSettings,
                searchEnabled: nextValue,
            },
        };
        this.emit();

        try {
            await saveCurrentVaultConfig(nextConfig);
            console.info("[config-store] searchEnabled saved", { nextValue });
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("store.saveSearchConfigFailed");
            this.state = {
                ...this.state,
                error: message,
            };
            this.emit();
            console.error("[config-store] save searchEnabled failed", { nextValue, message });
        }
    }

    async setVimModeEnabled(nextValue: boolean): Promise<void> {
        const currentConfig = this.state.backendConfig;
        if (!currentConfig) {
            return;
        }

        const featuresRaw = currentConfig.entries.features;
        const featuresObj =
            featuresRaw && typeof featuresRaw === "object" && !Array.isArray(featuresRaw)
                ? (featuresRaw as Record<string, unknown>)
                : {};

        const nextConfig: VaultConfig = {
            ...currentConfig,
            entries: {
                ...currentConfig.entries,
                features: {
                    ...featuresObj,
                    vimModeEnabled: nextValue,
                },
            },
        };

        this.state = {
            ...this.state,
            backendConfig: nextConfig,
            featureSettings: {
                ...this.state.featureSettings,
                vimModeEnabled: nextValue,
            },
        };
        this.emit();

        try {
            await saveCurrentVaultConfig(nextConfig);
            console.info("[config-store] vimModeEnabled saved", { nextValue });
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("store.saveVimConfigFailed");
            this.state = {
                ...this.state,
                error: message,
            };
            this.emit();
            console.error("[config-store] save vimModeEnabled failed", { nextValue, message });
        }
    }

    setRememberLastVault(nextValue: boolean): void {
        writeRememberLastVaultToLocal(nextValue);
        this.state = {
            ...this.state,
            frontendSettings: {
                ...this.state.frontendSettings,
                rememberLastVault: nextValue,
            },
            error: null,
        };
        this.emit();
        console.info("[config-store] rememberLastVault changed", { nextValue });
    }

    /**
     * @method setFeatureSetting
     * @description 通用更新单个 feature 配置项并持久化到后端。
     * @param key 配置键名。
     * @param nextValue 配置值。
     * @sideEffects 更新 backendConfig + featureSettings，调用后端保存接口。
     */
    async setFeatureSetting<K extends keyof FeatureSettings>(
        key: K,
        nextValue: FeatureSettings[K],
    ): Promise<void> {
        const currentConfig = this.state.backendConfig;
        if (!currentConfig) {
            console.warn("[config-store] setFeatureSetting: no backendConfig loaded", { key });
            return;
        }

        const featuresRaw = currentConfig.entries.features;
        const featuresObj =
            featuresRaw && typeof featuresRaw === "object" && !Array.isArray(featuresRaw)
                ? (featuresRaw as Record<string, unknown>)
                : {};

        const nextConfig: VaultConfig = {
            ...currentConfig,
            entries: {
                ...currentConfig.entries,
                features: {
                    ...featuresObj,
                    [key]: nextValue,
                },
            },
        };

        this.state = {
            ...this.state,
            backendConfig: nextConfig,
            featureSettings: {
                ...this.state.featureSettings,
                [key]: nextValue,
            },
        };
        this.emit();

        try {
            await saveCurrentVaultConfig(nextConfig);
            console.info("[config-store] feature setting saved", { key, nextValue });
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("store.saveConfigFailed", { key });
            this.state = {
                ...this.state,
                error: message,
            };
            this.emit();
            console.error("[config-store] save feature setting failed", { key, nextValue, message });
        }
    }

    /**
     * @method updateBackendConfig
     * @description 通用更新后端仓库配置并立即同步到当前 store。
     * @param recipe 基于当前配置生成下一份配置的变换函数。
     * @param options 写入日志与错误兜底选项。
     * @returns 保存完成后的配置快照。
     * @throws 当配置尚未加载或后端保存失败时抛出异常。
     * @sideEffects 更新 backendConfig + featureSettings，并调用后端保存接口。
     */
    async updateBackendConfig(
        recipe: (currentConfig: VaultConfig) => VaultConfig,
        options: UpdateBackendConfigOptions = {},
    ): Promise<VaultConfig> {
        const runUpdate = (): Promise<VaultConfig> => this.updateBackendConfigNow(recipe, options);
        const nextWrite = this.backendConfigWriteQueue.then(runUpdate, runUpdate);
        this.backendConfigWriteQueue = nextWrite.catch(() => {
            /* keep later writes from being blocked by a failed save */
        });
        return nextWrite;
    }

    private async updateBackendConfigNow(
        recipe: (currentConfig: VaultConfig) => VaultConfig,
        options: UpdateBackendConfigOptions = {},
    ): Promise<VaultConfig> {
        const logLabel = options.logLabel ?? "unknown";
        let currentConfig = this.state.backendConfig;

        if (!currentConfig) {
            if (!this.state.loadedVaultPath) {
                const message = i18n.t("store.loadConfigFailed");
                console.warn("[config-store] updateBackendConfig skipped: no vault context", {
                    logLabel,
                });
                throw new Error(message);
            }

            try {
                const rawConfig = await getCurrentVaultConfig();
                const { nextConfig, featureSettings } = normalizeBackendConfig(rawConfig);
                currentConfig = nextConfig;

                this.state = {
                    ...this.state,
                    backendConfig: nextConfig,
                    featureSettings,
                    error: null,
                };
                this.emit();

                console.info("[config-store] updateBackendConfig loaded missing backendConfig", {
                    logLabel,
                    vaultPath: this.state.loadedVaultPath,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : i18n.t("store.loadConfigFailed");
                console.warn("[config-store] updateBackendConfig skipped: unable to load backendConfig", {
                    logLabel,
                    message,
                    vaultPath: this.state.loadedVaultPath,
                });
                throw error instanceof Error ? error : new Error(message);
            }
        }

        try {
            currentConfig = await getCurrentVaultConfig();
        } catch (error) {
            console.warn("[config-store] updateBackendConfig fallback to in-memory snapshot", {
                logLabel,
                message: error instanceof Error ? error.message : String(error),
            });
        }

        const rawNextConfig = recipe(currentConfig);
        const { nextConfig, featureSettings } = normalizeBackendConfig(rawNextConfig);

        this.state = {
            ...this.state,
            backendConfig: nextConfig,
            featureSettings,
            error: null,
        };
        this.emit();

        try {
            await saveCurrentVaultConfig(nextConfig);
            console.info("[config-store] backend config saved", {
                logLabel,
            });
            return nextConfig;
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : i18n.t(options.fallbackErrorI18nKey ?? "store.saveConfigFailed", {
                    key: logLabel,
                });
            this.state = {
                ...this.state,
                error: message,
            };
            this.emit();
            console.error("[config-store] backend config save failed", {
                logLabel,
                message,
            });
            throw error instanceof Error ? error : new Error(message);
        }
    }
}

const configStore = new ConfigStore();

/**
 * @function subscribeConfigChanges
 * @description 纯前端事件订阅：接收配置模块发布的变更事件。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeConfigChanges(listener: (state: ConfigState) => void): () => void {
    const handler = (event: Event): void => {
        const customEvent = event as CustomEvent<ConfigChangedEventDetail>;
        listener(customEvent.detail.state);
    };

    configEventTarget.addEventListener(CONFIG_CHANGE_EVENT_NAME, handler);
    return () => {
        configEventTarget.removeEventListener(CONFIG_CHANGE_EVENT_NAME, handler);
    };
}

/**
 * @function useConfigState
 * @description React Hook：订阅配置状态。
 * @returns 配置状态快照。
 */
export function useConfigState(): ConfigState {
    return useSyncExternalStore(
        (listener) => configStore.subscribe(listener),
        () => configStore.getSnapshot(),
        () => configStore.getSnapshot(),
    );
}

/**
 * @function subscribeConfigState
 * @description 对外暴露配置 store 的订阅接口，供状态治理中心注册使用。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeConfigState(listener: () => void): () => void {
    return configStore.subscribe(listener);
}

/**
 * @function getConfigSnapshot
 * @description 非响应式读取当前配置状态，供插件入口同步 feature flag。
 * @returns 配置状态快照。
 */
export function getConfigSnapshot(): ConfigState {
    return configStore.getSnapshot();
}

/**
 * @function ensureConfigLoadedForVault
 * @description 为指定仓库加载配置状态。
 * @param vaultPath 当前仓库路径。
 */
export async function ensureConfigLoadedForVault(vaultPath: string): Promise<void> {
    await configStore.ensureLoaded(vaultPath);
}

/**
 * @function syncConfigStateForVault
 * @description 根据当前仓库上下文同步配置；未打开仓库时回落到全局默认配置。
 * @param vaultPath 当前仓库路径。
 * @param enabled 是否允许执行同步。
 */
export async function syncConfigStateForVault(
    vaultPath: string,
    enabled: boolean,
): Promise<void> {
    if (!enabled) {
        return;
    }

    if (!vaultPath || vaultPath.trim().length === 0) {
        configStore.resetForNoVault();
        return;
    }

    await configStore.ensureLoaded(vaultPath);
}

/**
 * @function updateSearchEnabled
 * @description 更新后端配置项“是否开启搜索功能”。
 * @param nextValue 配置值。
 */
export async function updateSearchEnabled(nextValue: boolean): Promise<void> {
    await configStore.setSearchEnabled(nextValue);
}

/**
 * @function updateVimModeEnabled
 * @description 更新后端配置项“是否开启 Vim 编辑模式”。
 * @param nextValue 配置值。
 */
export async function updateVimModeEnabled(nextValue: boolean): Promise<void> {
    await configStore.setVimModeEnabled(nextValue);
}

/**
 * @function updateRememberLastVault
 * @description 更新前端配置项“是否记住上次打开仓库”。
 * @param nextValue 配置值。
 */
export function updateRememberLastVault(nextValue: boolean): void {
    configStore.setRememberLastVault(nextValue);
}
/**
 * @function updateFeatureSetting
 * @description 通用更新单个 feature 配置项并持久化到后端。
 * @param key 配置键名，必须是 FeatureSettings 的有效属性。
 * @param nextValue 对应键的配置值。
 */
export async function updateFeatureSetting<K extends keyof FeatureSettings>(
    key: K,
    nextValue: FeatureSettings[K],
): Promise<void> {
    await configStore.setFeatureSetting(key, nextValue);
}

/**
 * @function updateBackendConfig
 * @description 通用更新后端仓库配置并持久化。
 * @param recipe 基于当前配置生成下一份配置的变换函数。
 * @param options 写入日志与错误兜底选项。
 * @returns 保存完成后的配置快照。
 */
export async function updateBackendConfig(
    recipe: (currentConfig: VaultConfig) => VaultConfig,
    options?: { logLabel?: string; fallbackErrorI18nKey?: string },
): Promise<VaultConfig> {
    return configStore.updateBackendConfig(recipe, options);
}

/**
 * @function useConfigSync
 * @description 在仓库就绪后加载并同步配置。
 * @param vaultPath 当前仓库路径。
 * @param enabled 是否允许执行同步。
 */
export function useConfigSync(vaultPath: string, enabled: boolean): void {
    useEffect(() => {
        void syncConfigStateForVault(vaultPath, enabled);
    }, [vaultPath, enabled]);
}
