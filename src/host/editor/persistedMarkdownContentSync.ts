/**
 * @module host/editor/persistedMarkdownContentSync
 * @description 将非编辑器入口完成的 Markdown 保存同步回已打开编辑器和读型组件。
 * @dependencies
 *  - ../../api/vaultApi
 *  - ./autoSaveService
 *  - ./editorContextStore
 *  - ../events/appEventBus
 *  - ../layout/workbenchContracts
 *
 * @exports
 *  - savePersistedMarkdownContent
 *  - savePersistedCanvasContent
 *  - notifyPersistedContentSaved
 *  - syncPersistedMarkdownContentToOpenEditors
 */

import {
    saveVaultCanvasFile,
    saveVaultMarkdownFile,
    type WriteCanvasFileResponse,
    type WriteMarkdownResponse,
} from "../../api/vaultApi";
import { emitPersistedContentUpdatedEvent } from "../events/appEventBus";
import type { WorkbenchContainerApi, WorkbenchPanelHandle } from "../layout/workbenchContracts";
import { markContentAsSaved } from "./autoSaveService";
import { reportArticleContentByPath } from "./editorContextStore";

export interface SyncPersistedMarkdownContentOptions {
    /** Workbench 容器实例，用于刷新已打开 tab 的运行时 params。 */
    containerApi: WorkbenchContainerApi;
    /** 被保存的 Markdown 相对路径。 */
    relativePath: string;
    /** 已成功写入持久层的最新内容。 */
    content: string;
}

export interface SyncPersistedMarkdownContentResult {
    /** 本次刷新过 params 的已打开面板数量。 */
    updatedPanelCount: number;
}

export interface SavePersistedMarkdownContentOptions {
    /** Workbench 容器实例；提供时会刷新已打开 tab 的运行时 params。 */
    containerApi?: WorkbenchContainerApi;
    /** 被保存的 Markdown 相对路径。 */
    relativePath: string;
    /** 已成功写入持久层的最新内容。 */
    content: string;
    /** 保存后是否跳过 open editor 同步；默认不跳过。 */
    skipOpenEditorSync?: boolean;
}

export interface SavePersistedCanvasContentOptions {
    /** 被保存的 Canvas 相对路径。 */
    relativePath: string;
    /** 已成功写入持久层的最新内容。 */
    content: string;
}

function normalizeRelativePath(path: string): string {
    return path.replace(/\\/g, "/");
}

function isMarkdownPath(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

function getPanelPath(panel: WorkbenchPanelHandle): string | null {
    const path = panel.params?.path;
    return typeof path === "string" ? normalizeRelativePath(path) : null;
}

/**
 * @function notifyPersistedContentSaved
 * @description 通知读型组件某个持久内容单元已由本地保存入口变更。
 * @param relativePath 变更的 vault 相对路径。
 */
export function notifyPersistedContentSaved(relativePath: string): void {
    emitPersistedContentUpdatedEvent({
        relativePath: normalizeRelativePath(relativePath),
        source: "save",
    });
}

/**
 * @function savePersistedMarkdownContent
 * @description 保存 Markdown，并统一执行保存后的前端同步副作用。
 * @param options 保存选项。
 * @returns 后端保存响应。
 */
export async function savePersistedMarkdownContent(
    options: SavePersistedMarkdownContentOptions,
): Promise<WriteMarkdownResponse> {
    const relativePath = normalizeRelativePath(options.relativePath);
    const response = await saveVaultMarkdownFile(relativePath, options.content);

    if (options.skipOpenEditorSync || !options.containerApi) {
        markContentAsSaved(relativePath, options.content);
        reportArticleContentByPath(relativePath, options.content);
        notifyPersistedContentSaved(relativePath);
        return response;
    }

    syncPersistedMarkdownContentToOpenEditors({
        containerApi: options.containerApi,
        relativePath,
        content: options.content,
    });
    return response;
}

/**
 * @function savePersistedCanvasContent
 * @description 保存 Canvas，并统一发出持久内容更新事件。
 * @param options 保存选项。
 * @returns 后端保存响应。
 */
export async function savePersistedCanvasContent(
    options: SavePersistedCanvasContentOptions,
): Promise<WriteCanvasFileResponse> {
    const relativePath = normalizeRelativePath(options.relativePath);
    const response = await saveVaultCanvasFile(relativePath, options.content);
    notifyPersistedContentSaved(relativePath);
    return response;
}

/**
 * @function syncPersistedMarkdownContentToOpenEditors
 * @description 外部入口保存 Markdown 后，同步 editor context、已打开 tab params 和持久态事件。
 * @param options 同步选项。
 * @returns 被刷新 params 的面板数量。
 */
export function syncPersistedMarkdownContentToOpenEditors(
    options: SyncPersistedMarkdownContentOptions,
): SyncPersistedMarkdownContentResult {
    const relativePath = normalizeRelativePath(options.relativePath);
    if (!isMarkdownPath(relativePath)) {
        return { updatedPanelCount: 0 };
    }

    markContentAsSaved(relativePath, options.content);
    reportArticleContentByPath(relativePath, options.content);

    let updatedPanelCount = 0;
    const panels = options.containerApi.panels ?? [];
    panels.forEach((panel) => {
        if (getPanelPath(panel) !== relativePath || !panel.api.updateParameters) {
            return;
        }

        const currentParams = panel.params ?? {};
        if (currentParams.path === relativePath && currentParams.content === options.content) {
            return;
        }

        panel.api.updateParameters({
            ...currentParams,
            path: relativePath,
            content: options.content,
        });
        updatedPanelCount += 1;
    });

    notifyPersistedContentSaved(relativePath);

    return { updatedPanelCount };
}
