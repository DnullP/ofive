/**
 * @module plugins/ai-chat/aiChatSettingsStore
 * @description AI 聊天设置同步 store：负责当前 vault 的设置加载、保存与跨组件广播，替代 ad-hoc window 事件同步。
 * @dependencies
 *   - ../../api/aiApi
 *
 * @example
 *   await ensureAiChatSettingsLoaded(vaultPath);
 *   const unsubscribe = subscribeAiChatSettingsSnapshot(() => {
 *     console.info(getAiChatSettingsSnapshot());
 *   });
 *
 * @exports
 *   - AiChatSettingsStoreSnapshot
 *   - subscribeAiChatSettingsSnapshot
 *   - getAiChatSettingsSnapshot
 *   - ensureAiChatSettingsLoaded
 *   - saveAiChatSettingsToStore
 *   - resetAiChatSettingsStore
 */

import {
    getAiChatSettings,
    saveAiChatSettings,
    type AiChatSettings,
} from "../../api/aiApi";

export interface AiChatSettingsStoreSnapshot {
    vaultPath: string | null;
    settings: AiChatSettings | null;
    isLoading: boolean;
    error: string | null;
}

export interface AiChatSettingsStoreDependencies {
    getAiChatSettings: () => Promise<AiChatSettings>;
    saveAiChatSettings: (settings: AiChatSettings) => Promise<AiChatSettings>;
}

export interface AiChatSettingsStore {
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => AiChatSettingsStoreSnapshot;
    ensureLoaded: (vaultPath: string) => Promise<AiChatSettings>;
    save: (vaultPath: string, settings: AiChatSettings) => Promise<AiChatSettings>;
    reset: (vaultPath?: string | null) => void;
}

const defaultDependencies: AiChatSettingsStoreDependencies = {
    getAiChatSettings,
    saveAiChatSettings,
};

export function createAiChatSettingsStore(
    dependencies: AiChatSettingsStoreDependencies = defaultDependencies,
): AiChatSettingsStore {
    let snapshot: AiChatSettingsStoreSnapshot = {
        vaultPath: null,
        settings: null,
        isLoading: false,
        error: null,
    };
    let loadPromise: Promise<AiChatSettings> | null = null;
    const listeners = new Set<() => void>();

    const emit = (): void => {
        listeners.forEach((listener) => listener());
    };

    const setSnapshot = (nextSnapshot: AiChatSettingsStoreSnapshot): void => {
        snapshot = nextSnapshot;
        emit();
    };

    const loadForVault = async (vaultPath: string): Promise<AiChatSettings> => {
        if (!vaultPath.trim()) {
            throw new Error("vault path is required to load AI chat settings");
        }

        setSnapshot({
            vaultPath,
            settings: snapshot.vaultPath === vaultPath ? snapshot.settings : null,
            isLoading: true,
            error: null,
        });

        try {
            const settings = await dependencies.getAiChatSettings();
            setSnapshot({
                vaultPath,
                settings,
                isLoading: false,
                error: null,
            });
            console.info("[ai-chat-settings-store] loaded", { vaultPath });
            return settings;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setSnapshot({
                vaultPath,
                settings: null,
                isLoading: false,
                error: message,
            });
            console.warn("[ai-chat-settings-store] load failed", {
                vaultPath,
                message,
            });
            throw error instanceof Error ? error : new Error(message);
        }
    };

    return {
        subscribe(listener: () => void): () => void {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getSnapshot(): AiChatSettingsStoreSnapshot {
            return snapshot;
        },
        async ensureLoaded(vaultPath: string): Promise<AiChatSettings> {
            if (!vaultPath.trim()) {
                throw new Error("vault path is required to load AI chat settings");
            }

            if (snapshot.vaultPath === vaultPath && snapshot.settings && !snapshot.error) {
                return snapshot.settings;
            }

            if (snapshot.vaultPath === vaultPath && loadPromise) {
                return loadPromise;
            }

            loadPromise = loadForVault(vaultPath).finally(() => {
                loadPromise = null;
            });
            return loadPromise;
        },
        async save(vaultPath: string, settings: AiChatSettings): Promise<AiChatSettings> {
            if (!vaultPath.trim()) {
                throw new Error("vault path is required to save AI chat settings");
            }

            setSnapshot({
                vaultPath,
                settings: snapshot.settings,
                isLoading: true,
                error: null,
            });

            try {
                const savedSettings = await dependencies.saveAiChatSettings(settings);
                setSnapshot({
                    vaultPath,
                    settings: savedSettings,
                    isLoading: false,
                    error: null,
                });
                console.info("[ai-chat-settings-store] saved", {
                    vaultPath,
                    vendorId: savedSettings.vendorId,
                    model: savedSettings.model,
                });
                return savedSettings;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setSnapshot({
                    vaultPath,
                    settings: snapshot.settings,
                    isLoading: false,
                    error: message,
                });
                console.warn("[ai-chat-settings-store] save failed", {
                    vaultPath,
                    message,
                });
                throw error instanceof Error ? error : new Error(message);
            }
        },
        reset(vaultPath?: string | null): void {
            if (typeof vaultPath === "string" && snapshot.vaultPath !== vaultPath) {
                return;
            }

            snapshot = {
                vaultPath: vaultPath ?? null,
                settings: null,
                isLoading: false,
                error: null,
            };
            loadPromise = null;
            emit();
        },
    };
}

const aiChatSettingsStore = createAiChatSettingsStore();

export function subscribeAiChatSettingsSnapshot(listener: () => void): () => void {
    return aiChatSettingsStore.subscribe(listener);
}

export function getAiChatSettingsSnapshot(): AiChatSettingsStoreSnapshot {
    return aiChatSettingsStore.getSnapshot();
}

export async function ensureAiChatSettingsLoaded(vaultPath: string): Promise<AiChatSettings> {
    return aiChatSettingsStore.ensureLoaded(vaultPath);
}

export async function saveAiChatSettingsToStore(
    vaultPath: string,
    settings: AiChatSettings,
): Promise<AiChatSettings> {
    return aiChatSettingsStore.save(vaultPath, settings);
}

export function resetAiChatSettingsStore(vaultPath?: string | null): void {
    aiChatSettingsStore.reset(vaultPath);
}