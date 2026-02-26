/**
 * @module store/graphSettingsStore
 * @description 知识图谱设置状态管理：支持仓库级（后端配置文件）持久化与订阅。
 * @dependencies
 *  - react (useSyncExternalStore)
 *  - ../api/vaultApi
 *  - ../layout/knowledgeGraphSettings
 *
 * @design
 *  - 设计原则：除“记住上次仓库”外，业务设置都应持久化在当前仓库配置中。
 *  - 原因：未打开仓库时无法读取仓库配置，因此仅“记住上次仓库路径”使用浏览器本地缓存。
 *  - 图谱设置属于业务设置，必须跟随仓库存储，保证跨设备/协作与仓库上下文一致性。
 */

import { useEffect, useSyncExternalStore } from "react";
import {
    getCurrentVaultConfig,
    saveCurrentVaultConfig,
    type VaultConfig,
} from "../api/vaultApi";
import {
    DEFAULT_KNOWLEDGE_GRAPH_SETTINGS,
    type KnowledgeGraphSettingKey,
    type KnowledgeGraphSettings,
} from "../layout/knowledgeGraphSettings";
import i18n from "../i18n";

/**
 * @constant GRAPH_SETTINGS_CONFIG_KEY
 * @description 仓库配置中用于存储图谱设置的键。
 */
const GRAPH_SETTINGS_CONFIG_KEY = "knowledgeGraphSettings";
const LEGACY_GRAPH_SETTINGS_STORAGE_KEY = "ofive:settings:knowledge-graph";

/**
 * @interface GraphSettingsState
 * @description 图谱设置状态。
 */
interface GraphSettingsState {
    /** 当前图谱设置 */
    settings: KnowledgeGraphSettings;
    /** 当前已加载的仓库路径 */
    loadedVaultPath: string | null;
    /** 加载中状态 */
    isLoading: boolean;
    /** 最近一次错误 */
    error: string | null;
}

/**
 * @function mergeWithDefaultSettings
 * @description 将输入设置与默认配置合并，确保结构完整。
 * @param partialSettings 候选设置。
 * @returns 设置对象。
 */
function mergeWithDefaultSettings(
    partialSettings: Partial<KnowledgeGraphSettings> | null | undefined,
): KnowledgeGraphSettings {
    const merged = { ...DEFAULT_KNOWLEDGE_GRAPH_SETTINGS } as KnowledgeGraphSettings;
    if (!partialSettings) {
        return merged;
    }

    (Object.keys(DEFAULT_KNOWLEDGE_GRAPH_SETTINGS) as KnowledgeGraphSettingKey[]).forEach((key) => {
        const value = partialSettings[key];
        if (value !== undefined) {
            (merged[key] as KnowledgeGraphSettings[typeof key]) = value as KnowledgeGraphSettings[typeof key];
        }
    });

    return merged;
}

/**
 * @function readGraphSettingsFromConfig
 * @description 从仓库配置读取图谱设置。
 * @param config 仓库配置。
 * @returns 合并后的设置对象。
 */
function readGraphSettingsFromConfig(config: VaultConfig): KnowledgeGraphSettings {
    const raw = config.entries?.[GRAPH_SETTINGS_CONFIG_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return mergeWithDefaultSettings(undefined);
    }

    try {
        return mergeWithDefaultSettings(raw as Partial<KnowledgeGraphSettings>);
    } catch (error) {
        console.warn("[graph-settings-store] parse config settings failed", {
            message: error instanceof Error ? error.message : String(error),
        });
        return mergeWithDefaultSettings(undefined);
    }
}

/**
 * @function readLegacyGraphSettingsFromLocal
 * @description 读取历史版本 localStorage 图谱设置（仅用于迁移）。
 * @returns 迁移用设置；不存在时返回 null。
 */
function readLegacyGraphSettingsFromLocal(): KnowledgeGraphSettings | null {
    if (typeof window === "undefined") {
        return null;
    }

    const raw = window.localStorage.getItem(LEGACY_GRAPH_SETTINGS_STORAGE_KEY);
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<KnowledgeGraphSettings>;
        return mergeWithDefaultSettings(parsed);
    } catch (error) {
        console.warn("[graph-settings-store] parse legacy local settings failed", {
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * @function clearLegacyGraphSettingsFromLocal
 * @description 清理历史 localStorage 图谱设置，避免后续误用。
 */
function clearLegacyGraphSettingsFromLocal(): void {
    if (typeof window === "undefined") {
        return;
    }
    window.localStorage.removeItem(LEGACY_GRAPH_SETTINGS_STORAGE_KEY);
}

/**
 * @function writeGraphSettingsToConfig
 * @description 写入图谱设置到仓库配置。
 * @param settings 图谱设置对象。
 */
async function writeGraphSettingsToConfig(settings: KnowledgeGraphSettings): Promise<void> {
    const currentConfig = await getCurrentVaultConfig();
    const nextConfig: VaultConfig = {
        ...currentConfig,
        entries: {
            ...currentConfig.entries,
            [GRAPH_SETTINGS_CONFIG_KEY]: settings,
        },
    };
    await saveCurrentVaultConfig(nextConfig);
}

/**
 * @class GraphSettingsStore
 * @description 图谱设置存储实现。
 *
 * @state
 *  - settings - 当前图谱设置 (KnowledgeGraphSettings) [DEFAULT_KNOWLEDGE_GRAPH_SETTINGS]
 *  - loadedVaultPath - 已加载设置对应的仓库路径 (string | null) [null]
 *  - isLoading - 图谱设置加载中状态 (boolean) [false]
 *  - error - 最近一次加载/保存错误 (string | null) [null]
 *
 * @lifecycle
 *  - 初始化时机：模块首次导入
 *  - 数据来源：后端仓库配置（VaultConfig.entries.knowledgeGraphSettings）
 *  - 更新触发：ensureLoadedForVault / updateSetting / reset
 *  - 清理时机：页面刷新后重建内存态
 *
 * @sync
 *  - 与后端同步：拉取 getCurrentVaultConfig，写回 saveCurrentVaultConfig
 *  - 缓存策略：内存态缓存 + 仓库级持久化；按 vaultPath 切换重载
 *  - 与其他Store的关系：依赖 vaultStore 提供 currentVaultPath，不依赖 localStorage
 */
class GraphSettingsStore {
    private state: GraphSettingsState = {
        settings: { ...DEFAULT_KNOWLEDGE_GRAPH_SETTINGS },
        loadedVaultPath: null,
        isLoading: false,
        error: null,
    };

    private listeners = new Set<() => void>();

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
     * @returns 图谱设置状态。
     */
    getSnapshot(): GraphSettingsState {
        return this.state;
    }

    /**
     * @function ensureLoadedForVault
     * @description 为指定仓库加载图谱设置，缺失时自动回填默认值。
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
            let loadedSettings = readGraphSettingsFromConfig(config);

            this.state = {
                settings: loadedSettings,
                loadedVaultPath: vaultPath,
                isLoading: false,
                error: null,
            };
            this.emit();

            const persistedRaw = config.entries?.[GRAPH_SETTINGS_CONFIG_KEY];
            const hasPersisted =
                persistedRaw &&
                typeof persistedRaw === "object" &&
                !Array.isArray(persistedRaw);
            if (!hasPersisted) {
                const legacySettings = readLegacyGraphSettingsFromLocal();
                if (legacySettings) {
                    loadedSettings = legacySettings;
                    this.state = {
                        ...this.state,
                        settings: loadedSettings,
                    };
                    this.emit();
                }
                await writeGraphSettingsToConfig(loadedSettings);
                clearLegacyGraphSettingsFromLocal();
            }

            console.info("[graph-settings-store] loaded", {
                vaultPath,
                hasPersisted,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("graph.loadSettingsFailed");
            this.state = {
                ...this.state,
                settings: { ...DEFAULT_KNOWLEDGE_GRAPH_SETTINGS },
                loadedVaultPath: vaultPath,
                isLoading: false,
                error: message,
            };
            this.emit();
            console.error("[graph-settings-store] load failed", { vaultPath, message });
        }
    }

    /**
     * @function updateSetting
     * @description 更新单个设置项。
     * @param key 设置键。
     * @param value 设置值。
     */
    async updateSetting<K extends KnowledgeGraphSettingKey>(
        key: K,
        value: KnowledgeGraphSettings[K],
    ): Promise<void> {
        const previousSettings = this.state.settings;
        const nextSettings: KnowledgeGraphSettings = {
            ...previousSettings,
            [key]: value,
        };

        this.state = {
            ...this.state,
            settings: nextSettings,
            error: null,
        };
        this.emit();

        try {
            await writeGraphSettingsToConfig(nextSettings);
            console.info("[graph-settings-store] setting updated", { key, value });
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("graph.saveSettingsFailed");
            this.state = {
                ...this.state,
                settings: previousSettings,
                error: message,
            };
            this.emit();
            console.error("[graph-settings-store] save setting failed", {
                key,
                value,
                message,
            });
        }
    }

    /**
     * @function reset
     * @description 重置图谱设置为默认值。
     */
    async reset(): Promise<void> {
        const previousSettings = this.state.settings;
        const nextSettings = { ...DEFAULT_KNOWLEDGE_GRAPH_SETTINGS };
        this.state = {
            ...this.state,
            settings: nextSettings,
            error: null,
        };
        this.emit();

        try {
            await writeGraphSettingsToConfig(nextSettings);
            console.info("[graph-settings-store] reset to defaults");
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("graph.resetSettingsFailed");
            this.state = {
                ...this.state,
                settings: previousSettings,
                error: message,
            };
            this.emit();
            console.error("[graph-settings-store] reset failed", { message });
        }
    }
}

const graphSettingsStore = new GraphSettingsStore();

/**
 * @function useGraphSettingsState
 * @description React Hook：订阅图谱设置状态。
 * @returns 图谱设置状态快照。
 */
export function useGraphSettingsState(): GraphSettingsState {
    return useSyncExternalStore(
        (listener) => graphSettingsStore.subscribe(listener),
        () => graphSettingsStore.getSnapshot(),
        () => graphSettingsStore.getSnapshot(),
    );
}

/**
 * @function ensureGraphSettingsLoadedForVault
 * @description 确保指定仓库的图谱设置已加载。
 * @param vaultPath 当前仓库路径。
 */
export async function ensureGraphSettingsLoadedForVault(vaultPath: string): Promise<void> {
    await graphSettingsStore.ensureLoadedForVault(vaultPath);
}

/**
 * @function updateGraphSetting
 * @description 更新单个图谱设置。
 * @param key 设置键。
 * @param value 设置值。
 */
export function updateGraphSetting<K extends KnowledgeGraphSettingKey>(
    key: K,
    value: KnowledgeGraphSettings[K],
): Promise<void> {
    return graphSettingsStore.updateSetting(key, value);
}

/**
 * @function resetGraphSettings
 * @description 重置图谱设置。
 */
export function resetGraphSettings(): Promise<void> {
    return graphSettingsStore.reset();
}

/**
 * @function useGraphSettingsSync
 * @description Hook：在仓库路径可用时同步加载图谱设置。
 * @param vaultPath 当前仓库路径。
 * @param enabled 是否启用同步。
 */
export function useGraphSettingsSync(vaultPath: string, enabled: boolean): void {
    useEffect(() => {
        if (!enabled) {
            return;
        }
        void ensureGraphSettingsLoadedForVault(vaultPath);
    }, [vaultPath, enabled]);
}
