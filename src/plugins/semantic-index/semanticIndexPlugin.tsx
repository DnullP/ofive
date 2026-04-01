/**
 * @module plugins/semantic-index/semanticIndexPlugin
 * @description 语义索引用户功能插件：负责把 semantic-index 后端能力接入设置页与命令系统，
 *   让用户可以显式开启功能、安装 embedding 模型，并主动触发全量索引。
 * @dependencies
 *  - react
 *  - react-i18next
 *  - ../../api/semanticIndexApi
 *  - ../../host/commands/commandSystem
 *  - ../../host/settings/settingsRegistry
 *  - ../../host/vault/vaultStore
 *
 * @example
 *   由插件运行时自动发现并激活，无需手工在宿主中导入。
 *
 * @exports
 *  - activatePlugin 注册 semantic-index 设置入口与主动全量同步命令，并返回清理函数。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import i18n from "../../i18n";
import {
    getSemanticIndexModelCatalog,
    getSemanticIndexSettings,
    getSemanticIndexStatus,
    installSemanticIndexModel,
    saveSemanticIndexSettings,
    startSemanticIndexFullSync,
    type SemanticIndexModelCatalog,
    type SemanticIndexModelCatalogItem,
    type SemanticIndexModelInstallStatus,
    type SemanticIndexSettings,
    type SemanticIndexStatus,
} from "../../api/semanticIndexApi";
import {
    publishNotification,
    publishProgressNotification,
} from "../../host/notifications/notificationCenter";
import { registerCommand } from "../../host/commands/commandSystem";
import { registerSettingsItem } from "../../host/settings/settingsRegistry";
import { useVaultState } from "../../host/vault/vaultStore";

import "./semanticIndexPlugin.css";

const AI_CHAT_SETTINGS_SECTION_ID = "ai-chat";
const SEMANTIC_INDEX_INITIAL_FULL_SYNC_NOTIFICATION_ID = "semantic-index-initial-full-sync";
const SEMANTIC_INDEX_MANUAL_FULL_SYNC_NOTIFICATION_ID = "semantic-index-manual-full-sync";
const SEMANTIC_INDEX_FULL_SYNC_COMMAND_ID = "semanticIndex.fullSyncRepository";
const SEMANTIC_INDEX_FULL_SYNC_POLL_MS = 1200;
const semanticIndexSyncPollTimerMap = new Map<string, number>();

interface SemanticIndexSyncNotificationCopy {
    titleKey: string;
    preparingKey: string;
    runningKey: string;
    currentFileKey: string;
    completedKey: string;
    completedWithFailuresKey: string;
    failedKey: string;
}

const INITIAL_SEMANTIC_INDEX_SYNC_COPY: SemanticIndexSyncNotificationCopy = {
    titleKey: "semanticIndexPlugin.syncProgressTitle",
    preparingKey: "semanticIndexPlugin.syncProgressPreparing",
    runningKey: "semanticIndexPlugin.syncProgressRunning",
    currentFileKey: "semanticIndexPlugin.syncProgressCurrentFile",
    completedKey: "semanticIndexPlugin.syncProgressCompleted",
    completedWithFailuresKey: "semanticIndexPlugin.syncProgressCompletedWithFailures",
    failedKey: "semanticIndexPlugin.syncProgressFailed",
};

const MANUAL_SEMANTIC_INDEX_SYNC_COPY: SemanticIndexSyncNotificationCopy = {
    titleKey: "semanticIndexPlugin.manualSyncProgressTitle",
    preparingKey: "semanticIndexPlugin.manualSyncProgressPreparing",
    runningKey: "semanticIndexPlugin.manualSyncProgressRunning",
    currentFileKey: "semanticIndexPlugin.syncProgressCurrentFile",
    completedKey: "semanticIndexPlugin.manualSyncProgressCompleted",
    completedWithFailuresKey: "semanticIndexPlugin.manualSyncProgressCompletedWithFailures",
    failedKey: "semanticIndexPlugin.manualSyncProgressFailed",
};

/**
 * @function translateSemanticIndexStatus
 * @description 将后端语义索引状态标签映射为用户可读文案。
 * @param status 状态标签。
 * @param t i18n 翻译函数。
 * @returns 本地化状态文案。
 */
function translateSemanticIndexStatus(
    status: string,
    t: (key: string) => string,
): string {
    switch (status) {
        case "ready":
            return t("semanticIndexPlugin.statusReady");
        case "building":
            return t("semanticIndexPlugin.statusBuilding");
        case "empty":
            return t("semanticIndexPlugin.statusEmpty");
        case "disabled":
            return t("semanticIndexPlugin.statusDisabled");
        default:
            return status;
    }
}

/**
 * @function translateSemanticIndexWorkerStatus
 * @description 将后台 worker 状态映射为用户可读文案。
 * @param status worker 状态。
 * @param t i18n 翻译函数。
 * @returns 本地化 worker 文案。
 */
function translateSemanticIndexWorkerStatus(
    status: string,
    t: (key: string) => string,
): string {
    switch (status) {
        case "idle":
            return t("semanticIndexPlugin.workerIdle");
        case "running":
            return t("semanticIndexPlugin.workerRunning");
        case "paused":
            return t("semanticIndexPlugin.workerPaused");
        case "error":
            return t("semanticIndexPlugin.workerError");
        default:
            return status;
    }
}

/**
 * @function translateModelInstallStatus
 * @description 将模型安装状态映射为用户可读文案。
 * @param status 模型安装状态。
 * @param t i18n 翻译函数。
 * @returns 本地化模型安装状态文案。
 */
function translateModelInstallStatus(
    status: SemanticIndexModelInstallStatus,
    t: (key: string) => string,
): string {
    switch (status) {
        case "installed":
            return t("semanticIndexPlugin.modelInstalled");
        case "installing":
            return t("semanticIndexPlugin.modelInstalling");
        case "failed":
            return t("semanticIndexPlugin.modelFailed");
        case "not-installed":
        default:
            return t("semanticIndexPlugin.modelNotInstalled");
    }
}

/**
 * @function isModelInstalled
 * @description 判断模型是否已可被选为当前活跃模型。
 * @param item 模型条目。
 * @returns 若模型可选则返回 true。
 */
function isModelInstalled(item: SemanticIndexModelCatalogItem | null | undefined): boolean {
    return item?.installStatus === "installed";
}

/**
 * @function areSemanticIndexSettingsEqual
 * @description 比较两份设置草稿是否一致，用于判定保存按钮状态。
 * @param left 左侧设置。
 * @param right 右侧设置。
 * @returns 设置一致时返回 true。
 */
function areSemanticIndexSettingsEqual(
    left: SemanticIndexSettings | null,
    right: SemanticIndexSettings | null,
): boolean {
    if (left === right) {
        return true;
    }

    if (left === null || right === null) {
        return false;
    }

    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * @function buildSemanticIndexSyncProgressMessage
 * @description 基于当前同步状态与文案配置拼接用户可读的进度消息。
 * @param nextStatus 当前语义索引状态。
 * @param t i18n 翻译函数。
 * @param copy 同步通知文案配置。
 * @returns 进度消息。
 */
function buildSemanticIndexSyncProgressMessage(
    nextStatus: SemanticIndexStatus,
    t: (key: string, options?: Record<string, string | number>) => string,
    copy: SemanticIndexSyncNotificationCopy,
): string {
    const completedCount =
        nextStatus.queueStatus.processedFileCount + nextStatus.queueStatus.failedFileCount;
    const totalFileCount = nextStatus.queueStatus.totalFileCount;
    const summary = totalFileCount > 0
        ? t(copy.runningKey, {
            completed: completedCount,
            total: totalFileCount,
        })
        : t(copy.preparingKey);

    if (!nextStatus.queueStatus.currentFilePath) {
        return summary;
    }

    return `${summary} · ${t(copy.currentFileKey, {
        path: nextStatus.queueStatus.currentFilePath,
    })}`;
}

/**
 * @function computeFullSyncProgress
 * @description 将同步状态归一化为通知中心需要的百分比。
 * @param nextStatus 当前语义索引状态。
 * @returns 0-100 的进度值。
 */
function computeFullSyncProgress(nextStatus: SemanticIndexStatus): number {
    const totalFileCount = nextStatus.queueStatus.totalFileCount;
    if (totalFileCount <= 0) {
        return nextStatus.queueStatus.workerStatus === "running" ? 0 : 100;
    }

    const completedCount =
        nextStatus.queueStatus.processedFileCount + nextStatus.queueStatus.failedFileCount;
    return Math.round((completedCount / totalFileCount) * 100);
}

/**
 * @function clearSemanticIndexSyncPolling
 * @description 清理指定通知通道对应的语义索引同步轮询定时器。
 * @param notificationId 通知通道 id。
 */
function clearSemanticIndexSyncPolling(notificationId: string): void {
    const timerId = semanticIndexSyncPollTimerMap.get(notificationId);
    if (timerId === undefined) {
        return;
    }

    globalThis.clearInterval(timerId);
    semanticIndexSyncPollTimerMap.delete(notificationId);
}

/**
 * @function publishSemanticIndexSyncCompletionNotification
 * @description 在语义索引同步结束后向通知中心发送最终结果。
 * @param nextStatus 当前语义索引状态。
 * @param notificationId 通知通道 id。
 * @param copy 同步通知文案配置。
 * @param t i18n 翻译函数。
 */
function publishSemanticIndexSyncCompletionNotification(
    nextStatus: SemanticIndexStatus,
    notificationId: string,
    copy: SemanticIndexSyncNotificationCopy,
    t: (key: string, options?: Record<string, string | number>) => string,
): void {
    const failedFileCount = nextStatus.queueStatus.failedFileCount;
    const lastError = nextStatus.queueStatus.lastError ?? nextStatus.lastError;

    if (nextStatus.queueStatus.workerStatus === "error") {
        publishNotification({
            notificationId,
            level: "error",
            title: t(copy.titleKey),
            message: t(copy.failedKey, {
                message: lastError ?? t("common.error"),
            }),
            autoCloseMs: 6000,
        });
        return;
    }

    if (failedFileCount > 0) {
        publishNotification({
            notificationId,
            level: "warn",
            title: t(copy.titleKey),
            message: t(copy.completedWithFailuresKey, {
                failed: failedFileCount,
            }),
            autoCloseMs: 5000,
        });
        return;
    }

    if (lastError) {
        publishNotification({
            notificationId,
            level: "error",
            title: t(copy.titleKey),
            message: t(copy.failedKey, {
                message: lastError,
            }),
            autoCloseMs: 6000,
        });
        return;
    }

    publishNotification({
        notificationId,
        level: "info",
        title: t(copy.titleKey),
        message: t(copy.completedKey),
        autoCloseMs: 4000,
    });
}

/**
 * @function pollSemanticIndexSyncProgress
 * @description 拉取一次后端同步状态，并更新对应通知通道。
 * @param notificationId 通知通道 id。
 * @param copy 同步通知文案配置。
 * @param onStatus 状态回调。
 * @param onError 轮询失败回调。
 */
async function pollSemanticIndexSyncProgress(
    notificationId: string,
    copy: SemanticIndexSyncNotificationCopy,
    onStatus?: (nextStatus: SemanticIndexStatus) => void,
    onError?: (message: string) => void,
): Promise<void> {
    try {
        const nextStatus = await getSemanticIndexStatus();
        onStatus?.(nextStatus);

        if (nextStatus.queueStatus.workerStatus === "running") {
            publishProgressNotification({
                notificationId,
                title: i18n.t(copy.titleKey),
                message: buildSemanticIndexSyncProgressMessage(nextStatus, i18n.t.bind(i18n), copy),
                progress: computeFullSyncProgress(nextStatus),
            });
            return;
        }

        clearSemanticIndexSyncPolling(notificationId);
        publishSemanticIndexSyncCompletionNotification(
            nextStatus,
            notificationId,
            copy,
            i18n.t.bind(i18n),
        );
    } catch (error) {
        clearSemanticIndexSyncPolling(notificationId);
        const message = error instanceof Error ? error.message : String(error);
        console.error("[semanticIndexPlugin] sync progress polling failed", {
            notificationId,
            message,
        });
        onError?.(message);
        publishNotification({
            notificationId,
            level: "error",
            title: i18n.t(copy.titleKey),
            message: i18n.t(copy.failedKey, { message }),
            autoCloseMs: 6000,
        });
    }
}

/**
 * @function startSemanticIndexSyncPolling
 * @description 为指定通知通道启动语义索引同步轮询；若已启动则直接复用。
 * @param notificationId 通知通道 id。
 * @param copy 同步通知文案配置。
 * @param onStatus 状态回调。
 * @param onError 轮询失败回调。
 */
function startSemanticIndexSyncPolling(
    notificationId: string,
    copy: SemanticIndexSyncNotificationCopy,
    onStatus?: (nextStatus: SemanticIndexStatus) => void,
    onError?: (message: string) => void,
): void {
    if (semanticIndexSyncPollTimerMap.has(notificationId)) {
        return;
    }

    const timerId = globalThis.setInterval(() => {
        void pollSemanticIndexSyncProgress(notificationId, copy, onStatus, onError);
    }, SEMANTIC_INDEX_FULL_SYNC_POLL_MS);
    semanticIndexSyncPollTimerMap.set(notificationId, timerId);
    void pollSemanticIndexSyncProgress(notificationId, copy, onStatus, onError);
}

/**
 * @function executeSemanticIndexFullSyncCommand
 * @description 主动触发一次当前 Vault 的全量语义索引同步，并开始推送进度通知。
 * @returns 无返回值。
 */
async function executeSemanticIndexFullSyncCommand(): Promise<void> {
    console.info("[semanticIndexPlugin] manual semantic-index full sync requested");

    try {
        await startSemanticIndexFullSync();
        startSemanticIndexSyncPolling(
            SEMANTIC_INDEX_MANUAL_FULL_SYNC_NOTIFICATION_ID,
            MANUAL_SEMANTIC_INDEX_SYNC_COPY,
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[semanticIndexPlugin] manual semantic-index full sync failed", {
            message,
        });
        publishNotification({
            notificationId: SEMANTIC_INDEX_MANUAL_FULL_SYNC_NOTIFICATION_ID,
            level: "error",
            title: i18n.t(MANUAL_SEMANTIC_INDEX_SYNC_COPY.titleKey),
            message: i18n.t(MANUAL_SEMANTIC_INDEX_SYNC_COPY.failedKey, { message }),
            autoCloseMs: 6000,
        });
    }
}

/**
 * @function SemanticIndexSettingsSection
 * @description 渲染 semantic-index 设置分区内容。
 * @returns React 节点。
 */
function SemanticIndexSettingsSection(): ReactNode {
    const { t } = useTranslation();
    const { currentVaultPath } = useVaultState();
    const [persistedSettings, setPersistedSettings] = useState<SemanticIndexSettings | null>(null);
    const [draftSettings, setDraftSettings] = useState<SemanticIndexSettings | null>(null);
    const [status, setStatus] = useState<SemanticIndexStatus | null>(null);
    const [modelCatalog, setModelCatalog] = useState<SemanticIndexModelCatalog | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [installingModelId, setInstallingModelId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [feedbackIsError, setFeedbackIsError] = useState(false);
    const syncPollTimerRef = useRef(SEMANTIC_INDEX_INITIAL_FULL_SYNC_NOTIFICATION_ID);

    /**
     * @function clearSyncProgressPolling
     * @description 清理当前设置页复用的初次全量同步轮询。
     */
    const clearSyncProgressPolling = (): void => {
        clearSemanticIndexSyncPolling(syncPollTimerRef.current);
    };

    /**
     * @function startSyncProgressPolling
     * @description 启动设置页对应的初次全量同步轮询，并同步本地状态。
     */
    const startSyncProgressPolling = (): void => {
        startSemanticIndexSyncPolling(
            syncPollTimerRef.current,
            INITIAL_SEMANTIC_INDEX_SYNC_COPY,
            (nextStatus) => {
                setStatus(nextStatus);
            },
            (message) => {
                console.error("[semanticIndexPlugin] sync progress polling failed", {
                    currentVaultPath,
                    message,
                });
                setFeedback(message);
                setFeedbackIsError(true);
            },
        );
    };

    useEffect(() => {
        return () => {
            clearSyncProgressPolling();
        };
    }, []);

    useEffect(() => {
        let disposed = false;

        if (!currentVaultPath) {
            console.warn("[semanticIndexPlugin] settings skipped: no active vault");
            clearSyncProgressPolling();
            setPersistedSettings(null);
            setDraftSettings(null);
            setStatus(null);
            setModelCatalog(null);
            setFeedback(null);
            setFeedbackIsError(false);
            return () => {
                disposed = true;
            };
        }

        console.info("[semanticIndexPlugin] loading semantic-index settings", {
            currentVaultPath,
        });
        setIsLoading(true);
        Promise.all([
            getSemanticIndexSettings(),
            getSemanticIndexStatus(),
            getSemanticIndexModelCatalog(),
        ])
            .then(([nextSettings, nextStatus, nextCatalog]) => {
                if (disposed) {
                    return;
                }

                console.info("[semanticIndexPlugin] semantic-index settings loaded", {
                    enabled: nextSettings.enabled,
                    modelId: nextSettings.modelId,
                    status: nextStatus.status,
                    models: nextCatalog.models.length,
                });
                setPersistedSettings(nextSettings);
                setDraftSettings(nextSettings);
                setStatus(nextStatus);
                setModelCatalog(nextCatalog);
                setFeedback(null);
                setFeedbackIsError(false);
                if (nextStatus.queueStatus.workerStatus === "running") {
                    startSyncProgressPolling();
                }
            })
            .catch((error) => {
                if (disposed) {
                    return;
                }

                const message = error instanceof Error ? error.message : String(error);
                console.error("[semanticIndexPlugin] failed to load semantic-index settings", {
                    currentVaultPath,
                    message,
                });
                setFeedback(message);
                setFeedbackIsError(true);
            })
            .finally(() => {
                if (!disposed) {
                    setIsLoading(false);
                }
            });

        return () => {
            disposed = true;
        };
    }, [currentVaultPath]);

    const selectedModel = useMemo(() => {
        if (!draftSettings || !modelCatalog) {
            return null;
        }

        return modelCatalog.models.find((item) => item.modelId === draftSettings.modelId) ?? null;
    }, [draftSettings, modelCatalog]);

    const installedModelCount = useMemo(() => {
        return modelCatalog?.models.filter((item) => isModelInstalled(item)).length ?? 0;
    }, [modelCatalog]);

    const canSave = useMemo(() => {
        if (!draftSettings || !persistedSettings) {
            return false;
        }

        if (!draftSettings.enabled) {
            return !areSemanticIndexSettingsEqual(draftSettings, persistedSettings);
        }

        return isModelInstalled(selectedModel)
            && !areSemanticIndexSettingsEqual(draftSettings, persistedSettings);
    }, [draftSettings, persistedSettings, selectedModel]);

    const handleRefresh = async (): Promise<void> => {
        if (!currentVaultPath) {
            console.warn("[semanticIndexPlugin] refresh skipped: no active vault");
            return;
        }

        console.info("[semanticIndexPlugin] refreshing semantic-index status and model catalog", {
            currentVaultPath,
        });
        setIsLoading(true);
        try {
            const [nextStatus, nextCatalog] = await Promise.all([
                getSemanticIndexStatus(),
                getSemanticIndexModelCatalog(),
            ]);
            setStatus(nextStatus);
            setModelCatalog(nextCatalog);
            setFeedback(null);
            setFeedbackIsError(false);
            if (nextStatus.queueStatus.workerStatus === "running") {
                startSyncProgressPolling();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[semanticIndexPlugin] refresh failed", {
                currentVaultPath,
                message,
            });
            setFeedback(message);
            setFeedbackIsError(true);
        } finally {
            setIsLoading(false);
        }
    };

    const handleInstallModel = async (modelId: string): Promise<void> => {
        if (!draftSettings || !currentVaultPath) {
            console.warn("[semanticIndexPlugin] install skipped: missing draft settings or vault", {
                modelId,
                currentVaultPath,
            });
            return;
        }

        console.info("[semanticIndexPlugin] installing semantic-index model", {
            currentVaultPath,
            modelId,
        });
        setInstallingModelId(modelId);
        setFeedback(null);
        setFeedbackIsError(false);

        try {
            const installedItem = await installSemanticIndexModel(modelId);
            const [nextStatus, nextCatalog] = await Promise.all([
                getSemanticIndexStatus(),
                getSemanticIndexModelCatalog(),
            ]);

            setStatus(nextStatus);
            setModelCatalog(nextCatalog);
            setDraftSettings((currentSettings) => {
                if (!currentSettings) {
                    return currentSettings;
                }

                const currentSelection = nextCatalog.models.find((item) => {
                    return item.modelId === currentSettings.modelId;
                });
                if (isModelInstalled(currentSelection)) {
                    return currentSettings;
                }

                return {
                    ...currentSettings,
                    modelId: installedItem.modelId,
                };
            });
            setFeedback(t("semanticIndexPlugin.installSuccess", { model: installedItem.displayName }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[semanticIndexPlugin] install failed", {
                currentVaultPath,
                modelId,
                message,
            });
            setFeedback(message);
            setFeedbackIsError(true);
        } finally {
            setInstallingModelId(null);
        }
    };

    const handleSave = async (): Promise<void> => {
        if (!draftSettings || !currentVaultPath) {
            console.warn("[semanticIndexPlugin] save skipped: missing draft settings or vault", {
                currentVaultPath,
            });
            return;
        }

        console.info("[semanticIndexPlugin] saving semantic-index settings", {
            currentVaultPath,
            enabled: draftSettings.enabled,
            modelId: draftSettings.modelId,
        });
        setIsSaving(true);
        setFeedback(null);
        setFeedbackIsError(false);
        try {
            const shouldStartInitialSync = !persistedSettings?.enabled && draftSettings.enabled;
            const savedSettings = await saveSemanticIndexSettings(draftSettings);
            const [nextStatus, nextCatalog] = await Promise.all([
                getSemanticIndexStatus(),
                getSemanticIndexModelCatalog(),
            ]);
            setPersistedSettings(savedSettings);
            setDraftSettings(savedSettings);
            setStatus(nextStatus);
            setModelCatalog(nextCatalog);
            setFeedback(t("semanticIndexPlugin.saveSuccess"));

            if (shouldStartInitialSync) {
                console.info("[semanticIndexPlugin] starting initial semantic-index full sync", {
                    currentVaultPath,
                    modelId: savedSettings.modelId,
                });
                await startSemanticIndexFullSync();
                startSyncProgressPolling();
            } else if (nextStatus.queueStatus.workerStatus === "running") {
                startSyncProgressPolling();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[semanticIndexPlugin] save failed", {
                currentVaultPath,
                message,
            });
            setFeedback(message);
            setFeedbackIsError(true);
        } finally {
            setIsSaving(false);
        }
    };

    if (!currentVaultPath) {
        return (
            <div className="settings-item-group semantic-index-settings-form">
                <div className="settings-compact-row">
                    <div className="settings-compact-info">
                        <span className="settings-compact-title">{t("semanticIndexPlugin.settingsTitle")}</span>
                        <span className="settings-compact-desc">{t("semanticIndexPlugin.noVault")}</span>
                    </div>
                </div>
            </div>
        );
    }

    if (isLoading || !draftSettings || !status || !modelCatalog) {
        return (
            <div className="settings-item-group semantic-index-settings-form">
                <div className="settings-compact-row">
                    <div className="settings-compact-info">
                        <span className="settings-compact-title">{t("semanticIndexPlugin.settingsTitle")}</span>
                        <span className="settings-compact-desc">{t("semanticIndexPlugin.loadingSettings")}</span>
                    </div>
                </div>
            </div>
        );
    }

    const queueSummary = t("semanticIndexPlugin.queueSummary", {
        worker: translateSemanticIndexWorkerStatus(status.queueStatus.workerStatus, t),
        pending: status.queueStatus.pendingFileCount,
    });
    const modelSummary = t("semanticIndexPlugin.modelSummary", {
        installed: installedModelCount,
        total: modelCatalog.models.length,
    });
    const needsInstalledModel = draftSettings.enabled && !isModelInstalled(selectedModel);

    return (
        <div className="settings-item-group semantic-index-settings-form">
            <div className="settings-compact-row">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("semanticIndexPlugin.settingsTitle")}</span>
                    <span className="settings-compact-desc">{t("semanticIndexPlugin.settingsSubtitle")}</span>
                </div>
                <button
                    type="button"
                    className="settings-shortcut-action-btn"
                    disabled={isLoading || isSaving || installingModelId !== null}
                    onClick={() => {
                        void handleRefresh();
                    }}
                >
                    {t("semanticIndexPlugin.refresh")}
                </button>
            </div>

            <label className="settings-compact-row" htmlFor="semantic-index-enabled-toggle">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("semanticIndexPlugin.enableTitle")}</span>
                    <span className="settings-compact-desc">{t("semanticIndexPlugin.enableDescription")}</span>
                </div>
                <input
                    id="semantic-index-enabled-toggle"
                    type="checkbox"
                    checked={draftSettings.enabled}
                    onChange={(event) => {
                        const nextEnabled = event.target.checked;
                        console.info("[semanticIndexPlugin] semantic-index enabled draft changed", {
                            currentVaultPath,
                            nextEnabled,
                        });
                        setDraftSettings((currentSettings) => currentSettings ? {
                            ...currentSettings,
                            enabled: nextEnabled,
                        } : currentSettings);
                    }}
                />
            </label>

            <div className="settings-compact-row">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("semanticIndexPlugin.runtimeTitle")}</span>
                    <span className="settings-compact-desc">{t("semanticIndexPlugin.runtimeDescription")}</span>
                </div>
                <span className="semantic-index-settings-meta">
                    {draftSettings.embeddingProvider} / {draftSettings.vectorStore} / {draftSettings.chunkingStrategy}
                </span>
            </div>

            <div className="settings-compact-row">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("semanticIndexPlugin.statusTitle")}</span>
                    <span className="settings-compact-desc">{queueSummary}</span>
                </div>
                <span className="semantic-index-settings-meta">
                    {translateSemanticIndexStatus(status.status, t)}
                </span>
            </div>

            {draftSettings.enabled ? (
                <>
                    <div className="settings-compact-row">
                        <div className="settings-compact-info">
                            <span className="settings-compact-title">{t("semanticIndexPlugin.modelsTitle")}</span>
                            <span className="settings-compact-desc">{t("semanticIndexPlugin.modelsDescription")}</span>
                        </div>
                        <span className="semantic-index-settings-meta">{modelSummary}</span>
                    </div>

                    {modelCatalog.models.map((item) => {
                        const isInstalled = isModelInstalled(item);
                        const isInstalling = installingModelId === item.modelId;
                        const isSelected = draftSettings.modelId === item.modelId;

                        return (
                            <div key={item.modelId} className="settings-compact-row semantic-index-settings-model-row">
                                <div className="semantic-index-settings-model-top">
                                    <div className="semantic-index-settings-model-main">
                                        <button
                                            type="button"
                                            className="settings-shortcut-action-btn semantic-index-settings-install-btn"
                                            disabled={isInstalled || isInstalling || installingModelId !== null || isSaving}
                                            onClick={() => {
                                                void handleInstallModel(item.modelId);
                                            }}
                                        >
                                            {isInstalled
                                                ? t("semanticIndexPlugin.modelInstalled")
                                                : isInstalling
                                                    ? t("semanticIndexPlugin.modelInstalling")
                                                    : t("semanticIndexPlugin.install")}
                                        </button>
                                        <div className="settings-compact-info">
                                            <span className="settings-compact-title">{item.displayName}</span>
                                            <span className="settings-compact-desc">{item.modelId}</span>
                                        </div>
                                    </div>

                                    <label className="semantic-index-settings-select" htmlFor={`semantic-index-model-${item.modelId}`}>
                                        <input
                                            id={`semantic-index-model-${item.modelId}`}
                                            type="radio"
                                            name="semantic-index-selected-model"
                                            checked={isSelected}
                                            disabled={!isInstalled || isSaving}
                                            onChange={() => {
                                                console.info("[semanticIndexPlugin] selected semantic-index model draft changed", {
                                                    currentVaultPath,
                                                    modelId: item.modelId,
                                                });
                                                setDraftSettings((currentSettings) => currentSettings ? {
                                                    ...currentSettings,
                                                    modelId: item.modelId,
                                                } : currentSettings);
                                            }}
                                        />
                                        <span>{t("semanticIndexPlugin.selectModel")}</span>
                                    </label>
                                </div>
                                <div className="semantic-index-settings-detail">
                                    {translateModelInstallStatus(item.installStatus, t)}
                                    {item.dimensions ? ` · ${item.dimensions}d` : ""}
                                    {item.isDefault ? ` · ${t("semanticIndexPlugin.defaultModel")}` : ""}
                                    {item.lastError ? ` · ${item.lastError}` : ""}
                                </div>
                            </div>
                        );
                    })}
                </>
            ) : null}

            <div className="settings-compact-row semantic-index-settings-feedback-row">
                <div className={`semantic-index-settings-feedback ${feedbackIsError ? "error" : ""}`}>
                    {feedback
                        ?? status.lastError
                        ?? (needsInstalledModel
                            ? t("semanticIndexPlugin.needInstalledModel")
                            : status.activeModelReady
                                ? t("semanticIndexPlugin.activeModelReady")
                                : t("semanticIndexPlugin.activeModelPending"))}
                </div>
                <div className="semantic-index-settings-actions">
                    <button
                        type="button"
                        className="semantic-index-settings-primary-action"
                        disabled={!canSave || isSaving || installingModelId !== null}
                        onClick={() => {
                            void handleSave();
                        }}
                    >
                        {isSaving ? t("common.loading") : t("common.save")}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * @function registerSemanticIndexSettingsItem
 * @description 将 semantic-index 设置项注册到 AI 对话设置分区。
 * @returns 清理函数。
 */
function registerSemanticIndexSettingsItem(): () => void {
    const unregisterItem = registerSettingsItem({
        id: "semantic-index-settings-panel",
        sectionId: AI_CHAT_SETTINGS_SECTION_ID,
        order: 20,
        kind: "custom",
        title: "settings.semanticIndexSection",
        description: "settings.semanticIndexSectionDesc",
        searchTerms: ["semantic", "vector", "embedding", "retrieval", "ai", "检索", "向量", "嵌入"],
        render: () => <SemanticIndexSettingsSection />,
    });

    return () => {
        unregisterItem();
    };
}

/**
 * @function registerSemanticIndexCommand
 * @description 注册主动触发当前 Vault 全量语义索引的前端命令。
 * @returns 清理函数。
 */
function registerSemanticIndexCommand(): () => void {
    return registerCommand({
        id: SEMANTIC_INDEX_FULL_SYNC_COMMAND_ID,
        title: "semanticIndexPlugin.fullSyncCommand",
        execute: async () => {
            await executeSemanticIndexFullSyncCommand();
        },
    });
}

/**
 * @function activatePlugin
 * @description 激活 semantic-index 插件，向设置中心与命令系统注册用户功能入口。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterSettings = registerSemanticIndexSettingsItem();
    const unregisterCommand = registerSemanticIndexCommand();

    console.info("[semanticIndexPlugin] registered semantic-index plugin");

    return () => {
        clearSemanticIndexSyncPolling(SEMANTIC_INDEX_INITIAL_FULL_SYNC_NOTIFICATION_ID);
        clearSemanticIndexSyncPolling(SEMANTIC_INDEX_MANUAL_FULL_SYNC_NOTIFICATION_ID);
        unregisterCommand();
        unregisterSettings();
        console.info("[semanticIndexPlugin] unregistered semantic-index plugin");
    };
}