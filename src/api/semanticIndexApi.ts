/**
 * @module api/semanticIndexApi
 * @description Semantic Index 用户接口封装：负责通过 Tauri invoke 读取设置、状态、模型目录，并触发后台模型安装。
 * @dependencies
 *  - @tauri-apps/api/core
 */

import { invoke } from "@tauri-apps/api/core";

export type EmbeddingProviderKind = "fast-embed";
export type VectorStoreKind = "sqlite-vec";
export type ChunkingStrategyKind = "heading-paragraph" | "whole-document";
export type SemanticIndexModelInstallStatus =
    | "not-installed"
    | "installing"
    | "installed"
    | "failed";

/**
 * @interface SemanticIndexSettings
 * @description 当前 Vault 的语义索引设置。
 */
export interface SemanticIndexSettings {
    enabled: boolean;
    embeddingProvider: EmbeddingProviderKind;
    vectorStore: VectorStoreKind;
    chunkingStrategy: ChunkingStrategyKind;
    modelId: string;
    chunkStrategyVersion: number;
}

/**
 * @interface SemanticIndexQueueStatus
 * @description 后台索引队列摘要。
 */
export interface SemanticIndexQueueStatus {
    workerStatus: string;
    pendingFileCount: number;
    hasPendingRebuild: boolean;
    lastEnqueuedAtMs: number | null;
    lastProcessedAtMs: number | null;
    totalFileCount: number;
    processedFileCount: number;
    failedFileCount: number;
    currentFilePath: string | null;
    lastError: string | null;
}

/**
 * @interface SemanticIndexStatus
 * @description 当前语义索引运行状态。
 */
export interface SemanticIndexStatus {
    status: string;
    enabled: boolean;
    embeddingProvider: EmbeddingProviderKind;
    vectorStore: VectorStoreKind;
    chunkingStrategy: ChunkingStrategyKind;
    modelId: string;
    activeModelReady: boolean;
    schemaVersion: number;
    lastError: string | null;
    queueStatus: SemanticIndexQueueStatus;
}

/**
 * @interface SemanticIndexModelCatalogItem
 * @description 单个 embedding 模型的用户态描述。
 */
export interface SemanticIndexModelCatalogItem {
    modelId: string;
    displayName: string;
    embeddingProvider: EmbeddingProviderKind;
    isDefault: boolean;
    isSelected: boolean;
    installStatus: SemanticIndexModelInstallStatus;
    dimensions: number | null;
    installedAtMs: number | null;
    lastError: string | null;
}

/**
 * @interface SemanticIndexModelCatalog
 * @description 当前用户可见的 embedding 模型目录。
 */
export interface SemanticIndexModelCatalog {
    enabled: boolean;
    embeddingProvider: EmbeddingProviderKind;
    selectedModelId: string;
    models: SemanticIndexModelCatalogItem[];
}

function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };

    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

/**
 * @function getSemanticIndexSettings
 * @description 获取当前 Vault 的语义索引设置。
 * @returns 当前设置。
 */
export async function getSemanticIndexSettings(): Promise<SemanticIndexSettings> {
    if (!isTauriRuntime()) {
        throw new Error("semantic-index settings are only available in Tauri runtime");
    }

    return invoke<SemanticIndexSettings>("get_semantic_index_settings");
}

/**
 * @function saveSemanticIndexSettings
 * @description 保存当前 Vault 的语义索引设置。
 * @param settings 待保存设置。
 * @returns 保存后的设置。
 */
export async function saveSemanticIndexSettings(
    settings: SemanticIndexSettings,
): Promise<SemanticIndexSettings> {
    if (!isTauriRuntime()) {
        throw new Error("semantic-index settings are only available in Tauri runtime");
    }

    return invoke<SemanticIndexSettings>("save_semantic_index_settings", { settings });
}

/**
 * @function getSemanticIndexStatus
 * @description 获取当前 Vault 的语义索引状态。
 * @returns 结构化状态。
 */
export async function getSemanticIndexStatus(): Promise<SemanticIndexStatus> {
    if (!isTauriRuntime()) {
        throw new Error("semantic-index status is only available in Tauri runtime");
    }

    return invoke<SemanticIndexStatus>("get_semantic_index_status");
}

/**
 * @function getSemanticIndexModelCatalog
 * @description 获取当前 Vault 的 embedding 模型目录。
 * @returns 模型列表与当前选择状态。
 */
export async function getSemanticIndexModelCatalog(): Promise<SemanticIndexModelCatalog> {
    if (!isTauriRuntime()) {
        throw new Error("semantic-index model catalog is only available in Tauri runtime");
    }

    return invoke<SemanticIndexModelCatalog>("get_semantic_index_model_catalog");
}

/**
 * @function installSemanticIndexModel
 * @description 触发指定 embedding 模型的后台安装。
 * @param modelId 目标模型 ID。
 * @returns 安装后的模型条目。
 */
export async function installSemanticIndexModel(
    modelId: string,
): Promise<SemanticIndexModelCatalogItem> {
    if (!isTauriRuntime()) {
        throw new Error("semantic-index model installation is only available in Tauri runtime");
    }

    return invoke<SemanticIndexModelCatalogItem>("install_semantic_index_model", { modelId });
}

/**
 * @function startSemanticIndexFullSync
 * @description 启动当前 Vault 的后台全量 embedding 同步。
 * @returns 启动后的队列状态。
 */
export async function startSemanticIndexFullSync(): Promise<SemanticIndexQueueStatus> {
    if (!isTauriRuntime()) {
        throw new Error("semantic-index full sync is only available in Tauri runtime");
    }

    return invoke<SemanticIndexQueueStatus>("start_semantic_index_full_sync");
}