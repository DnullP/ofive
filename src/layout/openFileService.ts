/**
 * @module layout/openFileService
 * @description 文件打开服务：基于 fileOpenerRegistry 统一解析并打开文件。
 *   这是宿主层的中心化入口，负责：
 *   - 规范化文件相对路径
 *   - 依据注册的 opener 解析 Tab 定义
 *   - 在 Dockview 中复用既有 Tab 或创建新 Tab
 *
 * @dependencies
 *   - dockview
 *   - ../registry/fileOpenerRegistry
 *   - ./DockviewLayout
 */

import type { DockviewApi } from "dockview";
import type { TabInstanceDefinition } from "./DockviewLayout";
import { resolveFileOpener } from "../registry/fileOpenerRegistry";

/**
 * @interface ResolveFileTabOptions
 * @description 文件打开解析选项。
 */
export interface ResolveFileTabOptions {
    /** 文件相对路径。 */
    relativePath: string;
    /** 当前仓库绝对路径。 */
    currentVaultPath?: string;
    /** 内容覆盖值；常用于内存快照复用。 */
    contentOverride?: string;
    /** 显式 opener id。 */
    preferredOpenerId?: string;
}

/**
 * @interface OpenFileWithResolverOptions
 * @description 基于 openTab 能力的文件打开选项。
 */
export interface OpenFileWithResolverOptions extends ResolveFileTabOptions {
    /** 宿主提供的打开 Tab 能力。 */
    openTab: (tab: TabInstanceDefinition) => void;
}

/**
 * @interface OpenFileInDockviewOptions
 * @description 基于 DockviewApi 的文件打开选项。
 */
export interface OpenFileInDockviewOptions extends ResolveFileTabOptions {
    /** Dockview 容器实例。 */
    containerApi: DockviewApi;
}

/**
 * @function normalizeRelativePath
 * @description 将路径统一为正斜杠格式。
 * @param relativePath 原始相对路径。
 * @returns 归一化后的相对路径。
 */
export function normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, "/");
}

/**
 * @function buildFileTabId
 * @description 根据相对路径生成稳定的文件 Tab id。
 * @param relativePath 文件相对路径。
 * @returns 稳定 Tab id。
 */
export function buildFileTabId(relativePath: string): string {
    return `file:${normalizeRelativePath(relativePath)}`;
}

/**
 * @function joinVaultAbsolutePath
 * @description 将仓库绝对路径与相对路径拼接为绝对文件路径。
 * @param vaultPath 仓库绝对路径。
 * @param relativePath 文件相对路径。
 * @returns 文件绝对路径；缺失仓库路径时返回空字符串。
 */
export function joinVaultAbsolutePath(vaultPath: string | undefined, relativePath: string): string {
    if (!vaultPath) {
        return "";
    }

    const normalizedVaultPath = vaultPath.replace(/[\\/]+$/, "");
    const normalizedRelativePath = normalizeRelativePath(relativePath).replace(/^[/]+/, "");
    return `${normalizedVaultPath}/${normalizedRelativePath}`;
}

/**
 * @function resolveFileTabDefinition
 * @description 依据注册 opener 解析文件对应的 Tab 定义。
 * @param options 文件打开选项。
 * @returns Tab 定义；未命中 opener 时返回 null。
 */
export async function resolveFileTabDefinition(
    options: ResolveFileTabOptions,
): Promise<TabInstanceDefinition | null> {
    const normalizedPath = normalizeRelativePath(options.relativePath);
    const opener = resolveFileOpener({
        relativePath: normalizedPath,
        currentVaultPath: options.currentVaultPath,
        contentOverride: options.contentOverride,
    }, options.preferredOpenerId);

    if (!opener) {
        console.warn("[openFileService] no opener matched", {
            relativePath: normalizedPath,
            preferredOpenerId: options.preferredOpenerId,
        });
        return null;
    }

    console.info("[openFileService] resolving file tab", {
        relativePath: normalizedPath,
        openerId: opener.id,
    });

    return opener.resolveTab({
        relativePath: normalizedPath,
        currentVaultPath: options.currentVaultPath,
        contentOverride: options.contentOverride,
    });
}

/**
 * @function openFileWithResolver
 * @description 基于宿主 openTab 能力打开文件。
 * @param options 文件打开选项。
 * @returns 打开的 Tab 定义；未命中 opener 时返回 null。
 */
export async function openFileWithResolver(
    options: OpenFileWithResolverOptions,
): Promise<TabInstanceDefinition | null> {
    const tab = await resolveFileTabDefinition(options);
    if (!tab) {
        return null;
    }

    options.openTab(tab);
    console.info("[openFileService] opened file via host openTab", {
        relativePath: normalizeRelativePath(options.relativePath),
        tabId: tab.id,
        component: tab.component,
    });
    return tab;
}

/**
 * @function openFileInDockview
 * @description 基于 DockviewApi 打开文件；若已有同 id Tab，则直接激活。
 * @param options 文件打开选项。
 * @returns 打开的 Tab 定义；若复用已有 Tab 或未命中 opener，则返回 null。
 */
export async function openFileInDockview(
    options: OpenFileInDockviewOptions,
): Promise<TabInstanceDefinition | null> {
    const normalizedPath = normalizeRelativePath(options.relativePath);
    const tabId = buildFileTabId(normalizedPath);
    const existingPanel = options.containerApi.getPanel(tabId);

    if (existingPanel) {
        existingPanel.api.setActive();
        console.info("[openFileService] activated existing file tab", {
            relativePath: normalizedPath,
            tabId,
        });
        return null;
    }

    const tab = await resolveFileTabDefinition({
        relativePath: normalizedPath,
        currentVaultPath: options.currentVaultPath,
        contentOverride: options.contentOverride,
        preferredOpenerId: options.preferredOpenerId,
    });

    if (!tab) {
        return null;
    }

    options.containerApi.addPanel({
        id: tab.id,
        title: tab.title,
        component: tab.component,
        params: tab.params,
    });
    console.info("[openFileService] opened file in dockview", {
        relativePath: normalizedPath,
        tabId: tab.id,
        component: tab.component,
    });
    return tab;
}