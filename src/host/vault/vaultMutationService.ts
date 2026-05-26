/**
 * @module host/vault/vaultMutationService
 * @description Vault 内容文件 mutation 协调器：统一 rename/move/delete 后的前端语义事件。
 * @dependencies
 *  - ../../api/vaultApi
 *  - ../events/appEventBus
 *
 * @exports
 *  - renamePersistedMarkdownFile
 *  - renamePersistedCanvasFile
 *  - movePersistedMarkdownFileToDirectory
 *  - movePersistedCanvasFileToDirectory
 *  - movePersistedFileToDirectory
 *  - deletePersistedMarkdownFile
 *  - deletePersistedCanvasFile
 */

import {
    deleteVaultCanvasFile,
    deleteVaultMarkdownFile,
    moveVaultCanvasFileToDirectory,
    moveVaultFileToDirectory,
    moveVaultMarkdownFileToDirectory,
    renameVaultCanvasFile,
    renameVaultMarkdownFile,
    type WriteCanvasFileResponse,
    type WriteMarkdownResponse,
} from "../../api/vaultApi";
import { emitPersistedContentUpdatedEvent } from "../events/appEventBus";

type PersistedContentMutationOperation = "renamed" | "moved" | "deleted";

function normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, "/");
}

function notifyPersistedContentMutation(
    relativePath: string,
    operation: PersistedContentMutationOperation,
    oldRelativePath?: string,
): void {
    emitPersistedContentUpdatedEvent({
        relativePath: normalizeRelativePath(relativePath),
        source: "save",
        operation,
        oldRelativePath: oldRelativePath ? normalizeRelativePath(oldRelativePath) : undefined,
    });
}

/**
 * @function renamePersistedMarkdownFile
 * @description 重命名 Markdown 文件，并发布本地持久内容 mutation 事件。
 * @param options 重命名参数。
 * @returns 后端重命名响应。
 */
export async function renamePersistedMarkdownFile(
    fromRelativePath: string,
    toRelativePath: string,
): Promise<WriteMarkdownResponse> {
    const normalizedFromPath = normalizeRelativePath(fromRelativePath);
    const normalizedToPath = normalizeRelativePath(toRelativePath);
    const response = await renameVaultMarkdownFile(normalizedFromPath, normalizedToPath);
    notifyPersistedContentMutation(response.relativePath, "renamed", normalizedFromPath);
    return response;
}

/**
 * @function renamePersistedCanvasFile
 * @description 重命名 Canvas 文件，并发布本地持久内容 mutation 事件。
 * @param options 重命名参数。
 * @returns 后端重命名响应。
 */
export async function renamePersistedCanvasFile(
    fromRelativePath: string,
    toRelativePath: string,
): Promise<WriteCanvasFileResponse> {
    const normalizedFromPath = normalizeRelativePath(fromRelativePath);
    const normalizedToPath = normalizeRelativePath(toRelativePath);
    const response = await renameVaultCanvasFile(normalizedFromPath, normalizedToPath);
    notifyPersistedContentMutation(response.relativePath, "renamed", normalizedFromPath);
    return response;
}

/**
 * @function movePersistedMarkdownFileToDirectory
 * @description 移动 Markdown 文件，并发布本地持久内容 mutation 事件。
 * @param options 移动参数。
 * @returns 后端移动响应。
 */
export async function movePersistedMarkdownFileToDirectory(
    fromRelativePath: string,
    targetDirectoryRelativePath: string,
): Promise<WriteMarkdownResponse> {
    const normalizedFromPath = normalizeRelativePath(fromRelativePath);
    const normalizedTargetDirectory = normalizeRelativePath(targetDirectoryRelativePath);
    const response = await moveVaultMarkdownFileToDirectory(normalizedFromPath, normalizedTargetDirectory);
    notifyPersistedContentMutation(response.relativePath, "moved", normalizedFromPath);
    return response;
}

/**
 * @function movePersistedCanvasFileToDirectory
 * @description 移动 Canvas 文件，并发布本地持久内容 mutation 事件。
 * @param options 移动参数。
 * @returns 后端移动响应。
 */
export async function movePersistedCanvasFileToDirectory(
    fromRelativePath: string,
    targetDirectoryRelativePath: string,
): Promise<WriteCanvasFileResponse> {
    const normalizedFromPath = normalizeRelativePath(fromRelativePath);
    const normalizedTargetDirectory = normalizeRelativePath(targetDirectoryRelativePath);
    const response = await moveVaultCanvasFileToDirectory(normalizedFromPath, normalizedTargetDirectory);
    notifyPersistedContentMutation(response.relativePath, "moved", normalizedFromPath);
    return response;
}

/**
 * @function movePersistedFileToDirectory
 * @description 移动任意普通文件，并发布本地持久内容 mutation 事件。
 * @param options 移动参数。
 * @returns 后端移动响应。
 */
export async function movePersistedFileToDirectory(
    fromRelativePath: string,
    targetDirectoryRelativePath: string,
): Promise<WriteMarkdownResponse> {
    const normalizedFromPath = normalizeRelativePath(fromRelativePath);
    const normalizedTargetDirectory = normalizeRelativePath(targetDirectoryRelativePath);
    const response = await moveVaultFileToDirectory(normalizedFromPath, normalizedTargetDirectory);
    notifyPersistedContentMutation(response.relativePath, "moved", normalizedFromPath);
    return response;
}

/**
 * @function deletePersistedMarkdownFile
 * @description 删除 Markdown 文件，并发布本地持久内容 mutation 事件。
 * @param options 删除参数。
 * @returns Promise 完成后返回 void。
 */
export async function deletePersistedMarkdownFile(
    relativePath: string,
): Promise<void> {
    const normalizedPath = normalizeRelativePath(relativePath);
    await deleteVaultMarkdownFile(normalizedPath);
    notifyPersistedContentMutation(normalizedPath, "deleted");
}

/**
 * @function deletePersistedCanvasFile
 * @description 删除 Canvas 文件，并发布本地持久内容 mutation 事件。
 * @param options 删除参数。
 * @returns Promise 完成后返回 void。
 */
export async function deletePersistedCanvasFile(
    relativePath: string,
): Promise<void> {
    const normalizedPath = normalizeRelativePath(relativePath);
    await deleteVaultCanvasFile(normalizedPath);
    notifyPersistedContentMutation(normalizedPath, "deleted");
}
