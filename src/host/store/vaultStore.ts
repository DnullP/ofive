/**
 * @module host/store/vaultStore
 * @description Vault 全局状态管理：维护当前打开目录、文件树与加载状态，并提供目录变更后的后端同步 Hook。
 * @dependencies
 *  - react (useEffect/useSyncExternalStore)
 *  - ../../api/vaultApi
 *
 * @example
 *   import { setCurrentVaultPath, useVaultState, useVaultTreeSync } from "../host/store/vaultStore";
 *   setCurrentVaultPath("/Users/name/Notes");
 *   const state = useVaultState();
 *   useVaultTreeSync();
 */

import { useEffect, useSyncExternalStore } from "react";
import {
    getCurrentVaultTree,
    setCurrentVault,
    type VaultEntry,
    type VaultFsEventPayload,
} from "../../api/vaultApi";
import { subscribeVaultFsBusEvent } from "../events/appEventBus";
import type { FileTreeItem } from "../../plugins/file-tree";
import { isRememberLastVaultEnabled } from "./configStore";
import i18n from "../../i18n";

/**
 * @constant EMPTY_VAULT_PATH
 * @description 未选择仓库时的空路径标记。
 */
export const EMPTY_VAULT_PATH = "";

/**
 * @constant LAST_VAULT_PATH_STORAGE_KEY
 * @description 本地持久化“上次打开仓库路径”的存储键。
 */
const LAST_VAULT_PATH_STORAGE_KEY = "ofive:last-vault-path";

/**
 * @constant TREE_REFRESH_EVENT_TYPES
 * @description 触发文件树刷新所需的后端文件事件类型。
 */
const TREE_REFRESH_EVENT_TYPES: VaultFsEventPayload["eventType"][] = [
    "created",
    "deleted",
    "moved",
];

/**
 * @function readPersistedVaultPath
 * @description 从本地存储读取上次打开的仓库路径。
 * @returns 若存在有效路径则返回该路径，否则返回空路径。
 */
function readPersistedVaultPath(): string {
    if (!isRememberLastVaultEnabled()) {
        return EMPTY_VAULT_PATH;
    }

    if (typeof window === "undefined") {
        return EMPTY_VAULT_PATH;
    }

    const persisted = window.localStorage.getItem(LAST_VAULT_PATH_STORAGE_KEY);
    if (!persisted || persisted.trim().length === 0) {
        return EMPTY_VAULT_PATH;
    }

    return persisted;
}

/**
 * @function persistVaultPath
 * @description 将当前仓库路径持久化到本地存储。
 * @param vaultPath 当前仓库路径。
 */
function persistVaultPath(vaultPath: string): void {
    if (!isRememberLastVaultEnabled()) {
        return;
    }

    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.setItem(LAST_VAULT_PATH_STORAGE_KEY, vaultPath);
    } catch (error) {
        console.warn("[vault-store] persist vault path failed", {
            vaultPath,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * @interface VaultState
 * @description Vault 全局状态快照。
 */
interface VaultState {
    currentVaultPath: string;
    files: FileTreeItem[];
    isLoadingTree: boolean;
    backendReady: boolean;
    error: string | null;
}

/**
 * @class VaultStore
 * @description 维护 vault 相关前端状态，并提供状态订阅能力。
 *
 * @state
 *  - currentVaultPath - 当前打开目录 (string) [""]
 *  - files - 当前目录下的 Markdown 文件树扁平列表 (FileTreeItem[]) [[]]
 *  - isLoadingTree - 文件树加载中状态 (boolean) [false]
 *  - backendReady - 当前 vault 是否已成功同步到后端 (boolean) [false]
 *  - error - 最近一次错误信息 (string | null) [null]
 *
 * @lifecycle
 *  - 初始化时机：模块首次导入
 *  - 数据来源：目录变更后由 Hook 回源后端接口
 *  - 更新触发：setCurrentVaultPath / 文件树回源成功或失败
 *  - 清理时机：页面刷新
 *
 * @sync
 *  - 与后端同步：通过 set_current_vault + get_current_vault_tree 拉取
 *  - 缓存策略：内存态，按目录切换触发刷新
 *  - 与其他Store的关系：独立 store，被资源管理器 UI 消费
 */
class VaultStore {
    private state: VaultState = {
        currentVaultPath: readPersistedVaultPath(),
        files: [],
        isLoadingTree: false,
        backendReady: false,
        error: null,
    };

    private listeners = new Set<() => void>();
    private requestVersion = 0;

    /**
     * @function subscribe
     * @description 订阅状态变化。
     * @param listener 监听器。
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
     * @description 触发状态广播。
     */
    private emit(): void {
        this.listeners.forEach((listener) => listener());
    }

    /**
     * @function getSnapshot
     * @description 获取当前状态快照。
     * @returns 状态快照。
     */
    getSnapshot(): VaultState {
        return this.state;
    }

    /**
     * @function setCurrentVaultPath
     * @description 更新当前目录路径。
     * @param nextPath 新目录路径。
     */
    setCurrentVaultPath(nextPath: string): void {
        if (!nextPath || nextPath.trim().length === 0) {
            console.warn("[vault-store] setCurrentVaultPath skipped: empty path");
            return;
        }

        if (nextPath === this.state.currentVaultPath) {
            return;
        }

        console.info("[vault-store] currentVaultPath changed", {
            from: this.state.currentVaultPath,
            to: nextPath,
        });

        this.state = {
            ...this.state,
            currentVaultPath: nextPath,
            backendReady: false,
            error: null,
        };
        persistVaultPath(nextPath);
        this.emit();
    }

    /**
     * @function setLoading
     * @description 设置文件树加载状态。
     * @param loading 是否加载中。
     */
    private setLoading(loading: boolean): void {
        this.state = {
            ...this.state,
            isLoadingTree: loading,
        };
        this.emit();
    }

    /**
     * @function setError
     * @description 设置错误状态。
     * @param message 错误信息。
     */
    private setError(message: string | null): void {
        this.state = {
            ...this.state,
            error: message,
        };
        this.emit();
    }

    /**
     * @function setFiles
     * @description 更新文件树列表。
     * @param files 文件列表。
     */
    private setFiles(files: FileTreeItem[]): void {
        this.state = {
            ...this.state,
            files,
        };
        this.emit();
    }

    /**
     * @function mapEntriesToTreeItems
     * @description 将后端目录树节点映射为文件树组件可消费结构。
     * @param entries 后端返回的目录树节点。
     * @returns 文件与目录混合列表。
     */
    private mapEntriesToTreeItems(entries: VaultEntry[]): FileTreeItem[] {
        return entries
            .map((entry) => ({
                id: entry.relativePath,
                path: entry.relativePath,
                isDir: entry.isDir,
            }))
            .sort((left, right) => left.path.localeCompare(right.path));
    }

    /**
     * @function syncTreeByCurrentPath
     * @description 根据当前目录回源后端并刷新文件树状态。
     *
     * 用于仓库路径变更时的完整同步流程：先调用 set_current_vault 初始化后端状态，
     * 再获取目录树。仅在仓库路径切换时调用。
     *
     * @returns Promise 完成信号。
     */
    async syncTreeByCurrentPath(): Promise<void> {
        const targetPath = this.state.currentVaultPath;
        if (!targetPath || targetPath.trim().length === 0) {
            this.state = {
                ...this.state,
                files: [],
                isLoadingTree: false,
                backendReady: false,
                error: null,
            };
            this.emit();
            console.info("[vault-store] syncTreeByCurrentPath skipped: no vault selected");
            return;
        }

        const requestId = ++this.requestVersion;

        this.setLoading(true);
        this.setError(null);
        console.info("[vault-store] syncTreeByCurrentPath:start", { targetPath, requestId });

        try {
            await setCurrentVault(targetPath);
            const tree = await getCurrentVaultTree();
            const files = this.mapEntriesToTreeItems(tree.entries);

            if (requestId !== this.requestVersion) {
                console.warn("[vault-store] syncTreeByCurrentPath skipped outdated response", { requestId });
                return;
            }

            this.setFiles(files);
            this.state = {
                ...this.state,
                backendReady: true,
                error: null,
            };
            this.emit();
            console.info("[vault-store] syncTreeByCurrentPath:success", {
                targetPath,
                count: files.length,
            });
        } catch (error) {
            if (requestId !== this.requestVersion) {
                return;
            }

            const message = error instanceof Error ? error.message : i18n.t("vault.loadTreeFailed");
            this.state = {
                ...this.state,
                files: [],
                backendReady: false,
                error: message,
            };
            this.emit();
            console.error("[vault-store] syncTreeByCurrentPath:failed", { targetPath, message });
        } finally {
            if (requestId === this.requestVersion) {
                this.setLoading(false);
            }
        }
    }

    /**
     * @function refreshTreeOnly
     * @description 仅刷新文件树，不重新初始化后端仓库状态。
     *
     * 用于文件系统事件（创建/删除/移动）触发的增量刷新场景。
     * 不调用 set_current_vault，避免与后台索引重建线程竞争 SQLite 写锁。
     * 刷新失败时保留现有文件树数据，仅记录警告日志，不清空 UI。
     *
     * @returns Promise 完成信号。
     */
    async refreshTreeOnly(): Promise<void> {
        const targetPath = this.state.currentVaultPath;
        const requestId = ++this.requestVersion;

        console.info("[vault-store] refreshTreeOnly:start", { targetPath, requestId });

        try {
            const tree = await getCurrentVaultTree();
            const files = this.mapEntriesToTreeItems(tree.entries);

            if (requestId !== this.requestVersion) {
                console.warn("[vault-store] refreshTreeOnly skipped outdated response", { requestId });
                return;
            }

            this.setFiles(files);
            this.state = {
                ...this.state,
                backendReady: true,
                error: null,
            };
            this.emit();
            console.info("[vault-store] refreshTreeOnly:success", {
                targetPath,
                count: files.length,
            });
        } catch (error) {
            if (requestId !== this.requestVersion) {
                return;
            }

            /* 刷新失败时保留现有文件树，不清空 UI——
             * 后台索引重建期间 get_current_vault_tree 本身不依赖索引，
             * 通常不会失败。若确实失败则保留旧数据并记录警告。 */
            const message = error instanceof Error ? error.message : i18n.t("vault.loadTreeFailed");
            console.warn("[vault-store] refreshTreeOnly:failed, keeping existing tree", {
                targetPath,
                message,
            });
        }
    }
}

const vaultStore = new VaultStore();

/**
 * @function setCurrentVaultPath
 * @description 对外更新当前目录路径。
 * @param nextPath 新路径。
 */
export function setCurrentVaultPath(nextPath: string): void {
    vaultStore.setCurrentVaultPath(nextPath);
}

/**
 * @function useVaultState
 * @description 订阅并获取 vault 全局状态。
 * @returns vault 状态。
 */
export function useVaultState(): VaultState {
    return useSyncExternalStore(
        (listener) => vaultStore.subscribe(listener),
        () => vaultStore.getSnapshot(),
        () => vaultStore.getSnapshot(),
    );
}

/**
 * @function subscribeVaultState
 * @description 对外暴露 vault store 的订阅接口，供状态治理中心注册使用。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeVaultState(listener: () => void): () => void {
    return vaultStore.subscribe(listener);
}

/**
 * @function getVaultStateSnapshot
 * @description 非响应式读取当前 vault 状态，供状态治理中心注册使用。
 * @returns vault 状态快照。
 */
export function getVaultStateSnapshot(): VaultState {
    return vaultStore.getSnapshot();
}

/**
 * @function useVaultTreeSync
 * @description Hook 回调：订阅当前目录状态，在目录变化后自动请求后端刷新文件树。
 *
 * 初始加载 / 路径切换时使用 `syncTreeByCurrentPath`（含 set_current_vault）。
 * 文件系统事件触发的增量刷新使用 `refreshTreeOnly`（仅 get_current_vault_tree），
 * 避免与后台索引重建线程竞争 SQLite 写锁导致 "database is locked" 错误。
 */
export function useVaultTreeSync(): void {
    const state = useVaultState();
    const currentPath = state.currentVaultPath;

    useEffect(() => {
        void vaultStore.syncTreeByCurrentPath();
    }, [currentPath]);

    useEffect(() => {
        if (!currentPath || currentPath.trim().length === 0) {
            return;
        }

        let refreshTimer: number | null = null;

        const scheduleTreeRefresh = (): void => {
            if (refreshTimer !== null) {
                window.clearTimeout(refreshTimer);
            }

            refreshTimer = window.setTimeout(() => {
                void vaultStore.refreshTreeOnly();
            }, 120);
        };

        const unlisten = subscribeVaultFsBusEvent((payload) => {
            if (!TREE_REFRESH_EVENT_TYPES.includes(payload.eventType)) {
                return;
            }

            console.info("[vault-store] fs event trigger tree refresh", {
                eventId: payload.eventId,
                eventType: payload.eventType,
                relativePath: payload.relativePath,
                oldRelativePath: payload.oldRelativePath,
            });

            scheduleTreeRefresh();
        });

        return () => {
            if (refreshTimer !== null) {
                window.clearTimeout(refreshTimer);
            }

            unlisten();
        };
    }, [currentPath]);
}
