/**
 * @module host/layout/activityBarStore
 * @description 活动栏定制配置存储：管理活动栏图标排序、可见性与区域对齐。
 *   配置通过 VaultConfig.entries.activityBar 持久化到后端。
 *
 * @dependencies
 *   - react (useSyncExternalStore)
 *   - ../../api/vaultApi
 *
 * @state
 *   - config - 活动栏配置 (ActivityBarConfig) [默认 { items: [] }]
 *   - isLoaded - 是否已完成初始加载 (boolean) [false]
 *   - loadedVaultPath - 已加载的仓库路径 (string | null) [null]
 *
 * @lifecycle
 *   - 初始化时机：仓库路径就绪后调用 ensureActivityBarConfigLoaded
 *   - 数据来源：后端 VaultConfig.entries.activityBar
 *   - 更新触发：用户拖拽排序、右键切换可见性/对齐
 *   - 清理时机：仓库切换时自动重载
 *
 * @sync
 *   - 与后端同步：写入时主动推送（防抖 300ms）
 *   - 缓存策略：内存缓存，仓库切换时重新加载
 *   - 与其他 Store 的关系：依赖 vaultApi 的配置读写接口，与 configStore 独立
 *
 * @exports
 *   - ActivityBarItemConfig
 *   - ActivityBarConfig
 *   - SETTINGS_ACTIVITY_ID
 *   - useActivityBarConfig
 *   - ensureActivityBarConfigLoaded
 *   - updateActivityBarConfig
 *   - mergeActivityBarConfig
 */

import { useSyncExternalStore } from "react";
import {
    getCurrentVaultConfig,
    saveCurrentVaultConfig,
    type VaultConfig,
} from "../../api/vaultApi";

/**
 * @constant SETTINGS_ACTIVITY_ID
 * @description 设置按钮的特殊活动 ID，用于将设置按钮纳入活动栏配置体系。
 */
export const SETTINGS_ACTIVITY_ID = "__settings__";

/**
 * @interface ActivityBarItemConfig
 * @description 单个活动栏项的持久化配置。
 * @field id - 活动项唯一标识（对应面板 activityId 或 SETTINGS_ACTIVITY_ID）
 * @field section - 所在区域（top 靠上对齐 / bottom 靠下对齐）
 * @field visible - 是否可见
 */
export interface ActivityBarItemConfig {
    /** 活动项唯一标识 */
    id: string;
    /** 所在区域（竖向 ActivityBar 中的 top/bottom） */
    section: "top" | "bottom";
    /** 是否可见 */
    visible: boolean;
    /** 所属图标栏（left = 左侧 ActivityBar，right = 右侧 SidebarIconBar），默认 "left" */
    bar?: "left" | "right";
}

/**
 * @interface ActivityBarConfig
 * @description 活动栏完整配置，持久化到 VaultConfig.entries.activityBar。
 * @field items - 按显示顺序排列的活动项配置列表。
 *   列表顺序即为同一 section 内的显示顺序；
 *   top section 的项排在 bottom 之前只是约定，
 *   渲染时按 section 过滤后按列表相对顺序排列。
 */
export interface ActivityBarConfig {
    /** 按显示顺序排列的活动项配置列表 */
    items: ActivityBarItemConfig[];
}

/**
 * @interface ActivityBarStoreState
 * @description 活动栏配置模块内部状态。
 * @field config - 当前配置
 * @field isLoaded - 是否已完成初始加载
 * @field loadedVaultPath - 已加载的仓库路径
 */
interface ActivityBarStoreState {
    /** 当前配置 */
    config: ActivityBarConfig;
    /** 是否已完成初始加载 */
    isLoaded: boolean;
    /** 已加载的仓库路径 */
    loadedVaultPath: string | null;
}

/**
 * @interface DefaultActivityItemInfo
 * @description 面板派生的活动项默认信息，用于与存储配置合并。
 * @field id - 活动项唯一标识
 * @field section - 默认所在区域
 * @field bar - 默认所属图标栏（可选，默认 "left"）
 */
export interface DefaultActivityItemInfo {
    /** 活动项唯一标识 */
    id: string;
    /** 默认所在区域 */
    section: "top" | "bottom";
    /** 默认所属图标栏 */
    bar?: "left" | "right";
}

/**
 * @interface MergedActivityBarItem
 * @description 合并面板默认信息与存储配置后的活动项描述（不含 UI 层信息）。
 * @field id - 活动项唯一标识
 * @field section - 最终所在区域（来自存储配置或默认值）
 * @field visible - 是否可见（来自存储配置或默认 true）
 */
export interface MergedActivityBarItem {
    /** 活动项唯一标识 */
    id: string;
    /** 最终所在区域（竖向 ActivityBar 中的 top/bottom） */
    section: "top" | "bottom";
    /** 是否可见 */
    visible: boolean;
    /** 所属图标栏 */
    bar: "left" | "right";
}

export interface ActivityBarItemMove {
    sourceBarId: "left" | "right";
    targetBarId: "left" | "right";
    iconId: string;
    targetIndex: number;
}

/**
 * @function dedupeActivityBarItems
 * @description 按活动项 id 去重配置，保留最后一次出现的配置。
 * @param items 原始配置项数组。
 * @returns 去重后的配置项数组。
 */
export function dedupeActivityBarItems(items: ActivityBarItemConfig[]): ActivityBarItemConfig[] {
    const dedupedReversed: ActivityBarItemConfig[] = [];
    const seen = new Set<string>();

    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (!item || seen.has(item.id)) {
            continue;
        }
        seen.add(item.id);
        dedupedReversed.push(item);
    }

    return dedupedReversed.reverse();
}

/* ────────────────── 配置解析 ────────────────── */

/**
 * @function parseActivityBarConfig
 * @description 从 VaultConfig entries 中解析活动栏配置。
 *   对不合法的数据进行容错处理，返回默认空配置。
 * @param entries VaultConfig.entries 对象。
 * @returns 解析后的活动栏配置。
 */
function parseActivityBarConfig(entries: Record<string, unknown>): ActivityBarConfig {
    const raw = entries.activityBar;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { items: [] };
    }

    const rawObj = raw as Record<string, unknown>;
    const rawItems = rawObj.items;
    if (!Array.isArray(rawItems)) {
        return { items: [] };
    }

    const items: ActivityBarItemConfig[] = [];
    for (const item of rawItems) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }
        const itemObj = item as Record<string, unknown>;
        if (typeof itemObj.id !== "string" || itemObj.id.length === 0) {
            continue;
        }
        const section =
            itemObj.section === "top" || itemObj.section === "bottom"
                ? itemObj.section
                : "top";
        const visible = typeof itemObj.visible === "boolean" ? itemObj.visible : true;
        const bar =
            itemObj.bar === "left" || itemObj.bar === "right"
                ? itemObj.bar
                : "left";
        items.push({ id: itemObj.id, section, visible, bar });
    }

    return { items: dedupeActivityBarItems(items) };
}

/* ────────────────── 合并逻辑 ────────────────── */

/**
 * @function mergeActivityBarConfig
 * @description 将面板默认活动项列表与存储配置合并，生成最终有序的活动项列表。
 *
 * 合并规则：
 *   1. 若存储配置为空（items.length === 0），返回默认列表，所有项可见。
 *   2. 否则按存储配置的顺序排列；存储中引用的面板若已不存在则跳过。
 *   3. 默认列表中新增的项（不在存储配置中）追加到末尾，可见且使用默认 section。
 *
 * @param defaults 面板派生的默认活动项列表。
 * @param config 存储的活动栏配置。
 * @returns 合并后的有序活动项列表。
 */
export function mergeActivityBarConfig(
    defaults: DefaultActivityItemInfo[],
    config: ActivityBarConfig,
): MergedActivityBarItem[] {
    if (config.items.length === 0) {
        return defaults.map((d) => ({
            id: d.id,
            section: d.section,
            visible: true,
            bar: d.bar ?? ("left" as const),
        }));
    }

    const defaultsMap = new Map(defaults.map((d) => [d.id, d]));
    const result: MergedActivityBarItem[] = [];
    const seen = new Set<string>();

    for (const configItem of config.items) {
        if (!defaultsMap.has(configItem.id)) {
            continue;
        }
        if (seen.has(configItem.id)) {
            continue;
        }
        seen.add(configItem.id);
        result.push({
            id: configItem.id,
            section: configItem.section,
            visible: configItem.visible,
            bar: configItem.bar ?? "left",
        });
    }

    for (const def of defaults) {
        if (!seen.has(def.id)) {
            result.push({
                id: def.id,
                section: def.section,
                visible: true,
                bar: def.bar ?? ("left" as const),
            });
        }
    }

    return result;
}

export function reorderActivityBarItems(
    items: Array<Pick<MergedActivityBarItem, "id" | "section" | "visible" | "bar">>,
    move: ActivityBarItemMove,
): ActivityBarItemConfig[] {
    const movingItem = items.find((item) => item.id === move.iconId);
    if (!movingItem) {
        return items.map((item) => ({
            id: item.id,
            section: item.section,
            visible: item.visible,
            bar: item.bar,
        }));
    }

    const sourceBarId = move.sourceBarId;
    const targetBarId = move.targetBarId;
    const withoutMovingItem = items.filter((item) => item.id !== move.iconId);

    const buildBarItems = (barId: "left" | "right"): ActivityBarItemConfig[] => {
        const barItems = withoutMovingItem.filter((item) => item.bar === barId);
        const visibleItems = barItems.filter((item) => item.visible);
        const hiddenItems = barItems.filter((item) => !item.visible);

        if (barId !== targetBarId) {
            return [...visibleItems, ...hiddenItems].map((item) => ({
                id: item.id,
                section: item.section,
                visible: item.visible,
                bar: item.bar,
            }));
        }

        const clampedTargetIndex = Math.min(Math.max(0, move.targetIndex), visibleItems.length);
        const reorderedVisibleItems = [...visibleItems];
        reorderedVisibleItems.splice(clampedTargetIndex, 0, {
            ...movingItem,
            bar: targetBarId,
        });

        return [...reorderedVisibleItems, ...hiddenItems].map((item) => ({
            id: item.id,
            section: item.section,
            visible: item.visible,
            bar: item.bar,
        }));
    };

    const nextLeftItems = buildBarItems("left");
    const nextRightItems = buildBarItems("right");

    if (sourceBarId !== targetBarId) {
        return sourceBarId === "left"
            ? [...nextRightItems, ...nextLeftItems]
            : [...nextLeftItems, ...nextRightItems];
    }

    return [...nextLeftItems, ...nextRightItems];
}

export function projectActivityBarConfigFromRuntime(
    items: Array<Pick<MergedActivityBarItem, "id" | "section" | "visible" | "bar">>,
    runtimeOrder: {
        left: string[];
        right: string[];
    },
): ActivityBarConfig {
    const buildRuntimeQueue = (bar: "left" | "right"): ActivityBarItemConfig[] => {
        const managedVisibleItems = items.filter((item) => item.visible && item.bar === bar && (bar === "right" || item.id !== SETTINGS_ACTIVITY_ID));
        const managedItemsById = new Map(managedVisibleItems.map((item) => [item.id, item]));
        const queue: ActivityBarItemConfig[] = [];
        const seen = new Set<string>();

        for (const id of runtimeOrder[bar]) {
            const item = managedItemsById.get(id);
            if (!item || seen.has(id)) {
                continue;
            }

            seen.add(id);
            queue.push({
                id: item.id,
                section: item.section,
                visible: item.visible,
                bar: item.bar,
            });
        }

        for (const item of managedVisibleItems) {
            if (seen.has(item.id)) {
                continue;
            }

            queue.push({
                id: item.id,
                section: item.section,
                visible: item.visible,
                bar: item.bar,
            });
        }

        return queue;
    };

    const leftQueue = buildRuntimeQueue("left");
    const rightQueue = buildRuntimeQueue("right");

    return {
        items: items.map((item) => {
            const isManagedVisibleItem = item.visible && (item.bar === "right" || item.id !== SETTINGS_ACTIVITY_ID);
            if (!isManagedVisibleItem) {
                return {
                    id: item.id,
                    section: item.section,
                    visible: item.visible,
                    bar: item.bar,
                };
            }

            const nextItem = item.bar === "right"
                ? rightQueue.shift()
                : leftQueue.shift();

            return nextItem ?? {
                id: item.id,
                section: item.section,
                visible: item.visible,
                bar: item.bar,
            };
        }),
    };
}

/* ────────────────── 状态存储 ────────────────── */

/**
 * @class ActivityBarStore
 * @description 活动栏配置状态存储。
 *   负责加载、更新与持久化活动栏定制配置。
 *
 * @field state - 内部状态快照
 * @field listeners - 订阅监听器集合
 * @field saveTimer - 防抖定时器
 *
 * @method subscribe - 注册状态变更监听器
 * @method getSnapshot - 获取当前状态快照
 * @method ensureLoaded - 确保指定仓库配置已加载
 * @method updateConfig - 更新活动栏配置并异步持久化
 */
class ActivityBarStore {
    /** 内部状态 */
    private state: ActivityBarStoreState = {
        config: { items: [] },
        isLoaded: false,
        loadedVaultPath: null,
    };

    /** 订阅监听器集合 */
    private listeners = new Set<() => void>();

    /** 持久化防抖定时器 */
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    /** 持久化防抖延迟（毫秒） */
    private static readonly SAVE_DEBOUNCE_MS = 300;

    /**
     * @method subscribe
     * @description 注册状态变更监听器。
     * @param listener 回调函数。
     * @returns 取消订阅函数。
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * @method emit
     * @description 通知所有监听器状态已变更。
     * @sideEffects 调用所有已注册的监听器。
     */
    private emit(): void {
        this.listeners.forEach((fn) => fn());
    }

    /**
     * @method getSnapshot
     * @description 获取当前状态快照。
     * @returns 当前活动栏配置状态。
     */
    getSnapshot(): ActivityBarStoreState {
        return this.state;
    }

    /**
     * @method ensureLoaded
     * @description 确保指定仓库的活动栏配置已加载。
     *   若已加载同一仓库则跳过。
     * @param vaultPath 仓库路径。
     * @sideEffects 更新内部状态，调用后端接口读取配置。
     */
    async ensureLoaded(vaultPath: string): Promise<void> {
        if (!vaultPath || vaultPath.trim().length === 0) {
            return;
        }

        if (this.state.loadedVaultPath === vaultPath && this.state.isLoaded) {
            return;
        }

        try {
            const rawConfig = await getCurrentVaultConfig();
            const config = parseActivityBarConfig(rawConfig.entries);

            this.state = {
                config,
                isLoaded: true,
                loadedVaultPath: vaultPath,
            };
            this.emit();
            console.info("[activity-bar-store] loaded", {
                vaultPath,
                itemCount: config.items.length,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[activity-bar-store] load failed", { vaultPath, message });
            this.state = {
                config: { items: [] },
                isLoaded: true,
                loadedVaultPath: vaultPath,
            };
            this.emit();
        }
    }

    /**
     * @method updateConfig
     * @description 更新活动栏完整配置并异步持久化到后端。
     *   使用防抖策略避免频繁写入。
     * @param nextConfig 新的配置对象。
     * @sideEffects 更新内部状态、广播变更、延迟调用后端保存接口。
     */
    updateConfig(nextConfig: ActivityBarConfig): void {
        const dedupedItems = dedupeActivityBarItems(nextConfig.items);
        this.state = {
            ...this.state,
            config: { items: dedupedItems },
        };
        this.emit();
        console.info("[activity-bar-store] config updated", {
            itemCount: dedupedItems.length,
            items: dedupedItems.map(
                (i) => `${i.id}:${i.section}:${i.visible ? "v" : "h"}`,
            ),
        });
        this.debouncedSave();
    }

    /**
     * @method debouncedSave
     * @description 防抖持久化当前配置到后端。
     * @sideEffects 启动或重置定时器，在延迟后调用 persistToBackend。
     */
    private debouncedSave(): void {
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.persistToBackend();
        }, ActivityBarStore.SAVE_DEBOUNCE_MS);
    }

    /**
     * @method persistToBackend
     * @description 将当前配置持久化到后端 VaultConfig。
     *   采用读-改-写模式避免覆盖其他配置项。
     * @sideEffects 调用后端 getCurrentVaultConfig 和 saveCurrentVaultConfig 接口。
     */
    private async persistToBackend(): Promise<void> {
        try {
            const rawConfig = await getCurrentVaultConfig();
            const dedupedItems = dedupeActivityBarItems(this.state.config.items);
            const nextVaultConfig: VaultConfig = {
                ...rawConfig,
                entries: {
                    ...rawConfig.entries,
                    activityBar: {
                        items: dedupedItems.map((item) => ({
                            id: item.id,
                            section: item.section,
                            visible: item.visible,
                            bar: item.bar ?? "left",
                        })),
                    },
                },
            };
            await saveCurrentVaultConfig(nextVaultConfig);
            console.info("[activity-bar-store] persisted to backend");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[activity-bar-store] persist failed", { message });
        }
    }
}

const activityBarStore = new ActivityBarStore();

/* ────────────────── 公共 API ────────────────── */

/**
 * @function useActivityBarConfig
 * @description React Hook：订阅活动栏配置状态。
 * @returns 活动栏配置状态快照。
 */
export function useActivityBarConfig(): ActivityBarStoreState {
    return useSyncExternalStore(
        (listener) => activityBarStore.subscribe(listener),
        () => activityBarStore.getSnapshot(),
        () => activityBarStore.getSnapshot(),
    );
}

/**
 * @function ensureActivityBarConfigLoaded
 * @description 确保指定仓库的活动栏配置已加载。
 * @param vaultPath 仓库路径。
 * @sideEffects 若未加载则调用后端接口读取配置并更新状态。
 */
export async function ensureActivityBarConfigLoaded(vaultPath: string): Promise<void> {
    await activityBarStore.ensureLoaded(vaultPath);
}

/**
 * @function updateActivityBarConfig
 * @description 更新活动栏完整配置并持久化到后端。
 * @param config 新配置对象。
 * @sideEffects 更新内部状态并延迟持久化到后端。
 */
export function updateActivityBarConfig(config: ActivityBarConfig): void {
    activityBarStore.updateConfig(config);
}
