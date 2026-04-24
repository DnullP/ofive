/**
 * @module layout/VaultPanel
 * @description 资源管理器面板：订阅 vault 全局状态，提供仓库打开与文件树展示能力。
 * @dependencies
 *  - react
 *  - @tauri-apps/plugin-dialog
 *  - ./FileTree
 *  - ../../../host/vault/vaultStore
 *  - ../api/vaultApi
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { FileTree, type FileTreeItem } from "./FileTree";
import type { TabInstanceDefinition } from "../../../host/layout/workbenchContracts";
import { openFileWithResolver } from "../../../host/layout/openFileService";
import { MoveFileDirectoryModal } from "../../../host/layout/MoveFileDirectoryModal";
import {
    createVaultCanvasFile,
    createVaultDirectory,
    createVaultMarkdownFile,
    deleteVaultCanvasFile,
    deleteVaultDirectory,
    deleteVaultMarkdownFile,
    moveVaultCanvasFileToDirectory,
    moveVaultDirectoryToDirectory,
    moveVaultMarkdownFileToDirectory,
    readVaultCanvasFile,
    readVaultMarkdownFile,
    renameVaultCanvasFile,
    renameVaultDirectory,
    renameVaultMarkdownFile,
    saveVaultMarkdownFile,
} from "../../../api/vaultApi";
import {
    buildCreatedCanvasInitialContent,
    isCanvasPath,
    resolveCreatedCanvasPath,
} from "../../../utils/canvasFileSpec";
import { getArticleSnapshotById, useFocusedArticle } from "../../../host/editor/editorContextStore";
import {
    setCurrentVaultPath,
    useVaultState,
} from "../../../host/vault/vaultStore";
import {
    subscribeFileTreeRenameRequestedEvent,
    type FileTreeRenameRequestedBusEvent,
} from "../../../host/events/appEventBus";
import "./VaultPanel.css";

/**
 * @interface VaultPanelProps
 * @description Vault 面板参数。
 */
interface VaultPanelProps {
    openTab: (tab: TabInstanceDefinition) => void;
    closeTab?: (tabId: string) => void;
    requestMoveFileToDirectory?: (relativePath: string) => void;
}

/**
 * @function isMarkdownPath
 * @description 判断是否为 Markdown 文件路径。
 * @param path 相对路径。
 * @returns 命中 Markdown 文件扩展名时返回 true。
 */
function isMarkdownPath(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

/**
 * @function isEditableFilePath
 * @description 判断路径是否属于当前前端支持的文本型文档。
 * @param path 相对路径。
 * @returns 支持 Markdown 或 Canvas 时返回 true。
 */
function isEditableFilePath(path: string): boolean {
    return isMarkdownPath(path) || isCanvasPath(path);
}

/**
 * @function resolveRenamedPath
 * @description 根据输入文件名草稿计算重命名目标路径。
 * @param currentPath 当前文件路径。
 * @param draftName 用户输入的新文件名。
 * @returns 目标路径；无效输入返回 null。
 */
function resolveRenamedPath(currentPath: string, draftName: string): string | null {
    const normalizedCurrentPath = currentPath.replace(/\\/g, "/");
    const trimmedName = draftName.trim();
    if (!trimmedName) {
        return null;
    }

    const currentFileName = normalizedCurrentPath.split("/").pop() ?? normalizedCurrentPath;
    const hasEditableSuffix = /\.(md|markdown|canvas)$/i.test(trimmedName);
    const currentSuffixMatch = currentFileName.match(/(\.md|\.markdown|\.canvas)$/i);
    const currentSuffix = currentSuffixMatch?.[0] ?? ".md";
    const nextFileName = hasEditableSuffix ? trimmedName : `${trimmedName}${currentSuffix}`;

    const splitIndex = normalizedCurrentPath.lastIndexOf("/");
    if (splitIndex < 0) {
        return nextFileName;
    }

    const parentDirectory = normalizedCurrentPath.slice(0, splitIndex);
    return `${parentDirectory}/${nextFileName}`;
}

function resolveCreatedFilePath(directoryPath: string, draftName: string): string | null {
    const trimmedName = draftName.trim();
    if (!trimmedName) {
        return null;
    }

    const hasSuffix = /\.(md|markdown|canvas)$/i.test(trimmedName);
    const fileName = hasSuffix ? trimmedName : `${trimmedName}.md`;
    const normalizedDirectory = directoryPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return normalizedDirectory ? `${normalizedDirectory}/${fileName}` : fileName;
}

function resolveCreatedDirectoryPath(directoryPath: string, draftName: string): string | null {
    const trimmedName = draftName.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmedName) {
        return null;
    }

    const normalizedDirectory = directoryPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return normalizedDirectory ? `${normalizedDirectory}/${trimmedName}` : trimmedName;
}

/**
 * @function buildCreatedMarkdownInitialContent
 * @description 为新建 Markdown 文件生成初始正文，仅保留去后缀的一级标题。
 * @param relativePath 新文件相对路径。
 * @returns 初始正文。
 */
function buildCreatedMarkdownInitialContent(relativePath: string): string {
    const fileName = relativePath.split("/").pop() ?? relativePath;
    const title = fileName.replace(/\.(md|markdown)$/i, "");
    return `# ${title}\n`;
}

/**
 * @function readEditableFileContent
 * @description 读取当前支持的文本型文档内容。
 * @param relativePath 文件相对路径。
 * @returns 文本内容。
 */
async function readEditableFileContent(relativePath: string): Promise<string> {
    if (isCanvasPath(relativePath)) {
        const response = await readVaultCanvasFile(relativePath);
        return response.content;
    }

    const response = await readVaultMarkdownFile(relativePath);
    return response.content;
}

function resolveRenamedDirectoryPath(currentPath: string, draftName: string): string | null {
    const normalizedCurrentPath = currentPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const trimmedName = draftName.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmedName) {
        return null;
    }

    const splitIndex = normalizedCurrentPath.lastIndexOf("/");
    if (splitIndex < 0) {
        return trimmedName;
    }

    const parentDirectory = normalizedCurrentPath.slice(0, splitIndex);
    return `${parentDirectory}/${trimmedName}`;
}

function isDescendantPath(path: string, ancestorPath: string): boolean {
    if (!ancestorPath) {
        return false;
    }

    return path.startsWith(`${ancestorPath}/`);
}

function normalizeBatchItems(items: FileTreeItem[]): FileTreeItem[] {
    const deduped = Array.from(
        new Map(items.map((item) => [item.path, item])).values(),
    ).sort((left, right) => {
        const depthDiff = left.path.split("/").length - right.path.split("/").length;
        if (depthDiff !== 0) {
            return depthDiff;
        }
        if (left.isDir !== right.isDir) {
            return left.isDir ? -1 : 1;
        }
        return left.path.localeCompare(right.path);
    });

    const result: FileTreeItem[] = [];
    deduped.forEach((item) => {
        const hasAncestorDirectory = result.some((candidate) => candidate.isDir && isDescendantPath(item.path, candidate.path));
        if (!hasAncestorDirectory) {
            result.push(item);
        }
    });

    return result;
}

function buildMoveSelectionLabel(items: FileTreeItem[], t: ReturnType<typeof useTranslation>["t"]): string {
    if (items.length === 1) {
        return items[0]?.path ?? "";
    }

    return t("moveFileModal.selectionSummary", { count: items.length });
}


/**
 * @function normalizeSelectedVaultPath
 * @description 规范化系统目录选择结果，兼容 string / string[] / 对象结构。
 * @param selected 系统对话框返回值。
 * @returns 规范化路径，无法识别返回 null。
 */
function normalizeSelectedVaultPath(selected: unknown): string | null {
    if (typeof selected === "string") {
        return selected;
    }

    if (Array.isArray(selected)) {
        const first = selected[0];
        return typeof first === "string" ? first : null;
    }

    if (selected && typeof selected === "object") {
        const selectedObject = selected as { path?: unknown };
        if (typeof selectedObject.path === "string") {
            return selectedObject.path;
        }
    }

    return null;
}

/**
 * @function splitVaultDisplayPath
 * @description 将绝对路径拆分为「可省略前缀」和「仓库根目录名」两段。
 *   当路径过长时，前缀部分由 CSS text-overflow 截断，根目录名始终完整显示。
 * @param fullPath 完整绝对路径。
 * @returns [prefix, rootDirName]，如 ["/Users/kaiqiu/Documents/projects/rust/", "ofive"]。
 *   若路径无斜杠分隔则 prefix 为空。
 */
function splitVaultDisplayPath(fullPath: string): [string, string] {
    if (!fullPath || fullPath.trim().length === 0) {
        return ["", ""];
    }

    const normalized = fullPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash < 0) {
        return ["", normalized];
    }
    // prefix 包含末尾斜杠，如 "/Users/.../rust/"
    return [normalized.slice(0, lastSlash + 1), normalized.slice(lastSlash + 1)];
}

/**
 * @function VaultPanel
 * @description 渲染资源管理器：当前目录展示、系统打开仓库、文件树展示。
 * @param props 面板参数。
 * @returns React 节点。
 */
export function VaultPanel(props: VaultPanelProps): ReactNode {
    const { t } = useTranslation();
    const { openTab, closeTab } = props;
    const { currentVaultPath, files, isLoadingTree, error } = useVaultState();
    const focusedArticle = useFocusedArticle();
    const [moveSelection, setMoveSelection] = useState<FileTreeItem[] | null>(null);
    const [renameRequest, setRenameRequest] = useState<FileTreeRenameRequestedBusEvent | null>(null);
    const [vaultPathPrefix, vaultPathRootName] = splitVaultDisplayPath(currentVaultPath);

    useEffect(() => {
        return subscribeFileTreeRenameRequestedEvent((payload) => {
            setRenameRequest(payload);
        });
    }, []);

    /**
     * @function resolveErrorMessage
     * @description 将未知异常对象转换为可读错误文案，优先保留后端返回的原始信息。
     * @param unknownError 未知异常。
     * @param fallback 默认文案。
     * @returns 错误文案。
     */
    const resolveErrorMessage = (unknownError: unknown, fallback: string): string => {
        if (unknownError instanceof Error) {
            return unknownError.message;
        }

        if (typeof unknownError === "string" && unknownError.trim()) {
            return unknownError;
        }

        return fallback;
    };

    /**
     * @function handleOpenVaultWithSystemFs
     * @description 通过系统文件对话框选择目录并更新全局仓库路径。
     */
    const handleOpenVaultWithSystemFs = async (): Promise<void> => {
        try {
            console.info("[vault-ui] openVault:dialog:open");
            const selected = await open({
                directory: true,
                multiple: false,
                title: t("vault.selectDirectory"),
            });
            const selectedPath = normalizeSelectedVaultPath(selected);

            if (!selectedPath) {
                console.warn("[vault-ui] openVault:dialog:cancelled-or-invalid", { selected });
                return;
            }

            console.info("[vault-ui] openVault:dialog:selected", { selectedPath });
            setCurrentVaultPath(selectedPath);
        } catch (openError) {
            const message = openError instanceof Error ? openError.message : t("vault.openDirectoryFailed");
            console.error("[vault-ui] openVault:dialog:failed", { message });
        }
    };

    /**
     * @function handleOpenFile
     * @description 打开文件树中的文件并根据注册机制创建对应 tab。
     * @param item 文件项。
     */
    const handleOpenFile = async (item: FileTreeItem): Promise<void> => {
        if (item.isDir) {
            return;
        }

        try {
            const tab = await openFileWithResolver({
                relativePath: item.path,
                currentVaultPath,
                openTab,
            });
            if (!tab) {
                console.warn("[vault-ui] openFile skipped: no opener matched", {
                    path: item.path,
                });
            }
        } catch (readError) {
            const message = readError instanceof Error ? readError.message : t("vault.readFileFailed");
            console.error("[vault-ui] openFile:failed", { path: item.path, message });
        }
    };

    /**
     * @function handleRenameItem
     * @description 响应文件树右键 rename 操作。
     * @param item 目标文件项。
     */
    const handleRenameSubmit = async (item: FileTreeItem, draftName: string): Promise<boolean> => {
        if (item.isDir) {
            const targetPath = resolveRenamedDirectoryPath(item.path, draftName);
            if (!targetPath || targetPath === item.path) {
                return true;
            }

            try {
                await renameVaultDirectory(item.path, targetPath);
                console.info("[vault-ui] rename directory success", {
                    from: item.path,
                    to: targetPath,
                });
                return true;
            } catch (renameError) {
                const message = renameError instanceof Error ? renameError.message : t("vault.renameDirFailed");
                console.error("[vault-ui] rename directory failed", {
                    from: item.path,
                    to: targetPath,
                    message,
                });
                return false;
            }
        }

        if (!isEditableFilePath(item.path)) {
            console.warn("[vault-ui] rename skipped: unsupported file type", {
                path: item.path,
                isDir: item.isDir,
            });
            return false;
        }

        const targetPath = resolveRenamedPath(item.path, draftName);
        if (!targetPath || targetPath === item.path) {
            return true;
        }

        try {
            const sourceTabId = `file:${item.path}`;
            const sourceSnapshot = getArticleSnapshotById(sourceTabId);

            if (isCanvasPath(item.path)) {
                await renameVaultCanvasFile(item.path, targetPath);
            } else {
                await renameVaultMarkdownFile(item.path, targetPath);
            }

            if (sourceSnapshot && !isCanvasPath(item.path)) {
                await saveVaultMarkdownFile(targetPath, sourceSnapshot.content);
            }

            closeTab?.(sourceTabId);

            const latestContent = sourceSnapshot
                ? sourceSnapshot.content
                : await readEditableFileContent(targetPath);

            await openFileWithResolver({
                relativePath: targetPath,
                currentVaultPath,
                contentOverride: latestContent,
                openTab,
            });

            console.info("[vault-ui] rename success", {
                from: item.path,
                to: targetPath,
            });
            return true;
        } catch (renameError) {
            const message = renameError instanceof Error ? renameError.message : t("vault.renameFileFailed");
            console.error("[vault-ui] rename failed", {
                from: item.path,
                to: targetPath,
                message,
            });
            return false;
        }
    };

    /**
     * @function handleDeleteItem
     * @description 响应文件树右键删除操作。
     * @param item 目标文件项。
     */
    const handleDeleteItem = async (item: FileTreeItem): Promise<void> => {
        if (item.isDir) {
            const confirmed = await confirm(t("vault.confirmDeleteDir", { name: item.path }), {
                title: t("common.confirm"),
                kind: "warning",
            });
            if (!confirmed) {
                return;
            }

            try {
                await deleteVaultDirectory(item.path);
                console.info("[vault-ui] delete directory success", {
                    path: item.path,
                });
            } catch (deleteError) {
                const message = resolveErrorMessage(deleteError, t("vault.deleteDirFailed"));
                console.error("[vault-ui] delete directory failed", {
                    path: item.path,
                    message,
                });
            }
            return;
        }

        if (!isEditableFilePath(item.path)) {
            console.warn("[vault-ui] delete skipped: unsupported file type", {
                path: item.path,
                isDir: item.isDir,
            });
            return;
        }

        const confirmed = await confirm(t("vault.confirmDeleteFile", { name: item.path }), {
            title: t("common.confirm"),
            kind: "warning",
        });
        if (!confirmed) {
            return;
        }

        try {
            if (isCanvasPath(item.path)) {
                await deleteVaultCanvasFile(item.path);
            } else {
                await deleteVaultMarkdownFile(item.path);
            }
            closeTab?.(`file:${item.path}`);
            console.info("[vault-ui] delete success", {
                path: item.path,
            });
        } catch (deleteError) {
            const message = resolveErrorMessage(deleteError, t("vault.deleteFileFailed"));
            console.error("[vault-ui] delete failed", {
                path: item.path,
                message,
            });
        }
    };

    /**
     * @function handleMoveByDrop
     * @description 响应文件树拖拽落点移动。
     * @param sourceRelativePath 源文件路径。
     * @param targetDirectoryRelativePath 目标目录路径。
     */
    const handleMoveByDrop = async (
        sourceRelativePath: string,
        targetDirectoryRelativePath: string,
        sourceIsDir: boolean,
    ): Promise<void> => {
        if (sourceIsDir) {
            try {
                const result = await moveVaultDirectoryToDirectory(sourceRelativePath, targetDirectoryRelativePath);
                console.info("[vault-ui] drop-move directory success", {
                    from: sourceRelativePath,
                    to: result.relativePath,
                });
            } catch (moveError) {
                const message = resolveErrorMessage(moveError, t("vault.dragMoveDirFailed"));
                console.error("[vault-ui] drop-move directory failed", {
                    sourceRelativePath,
                    targetDirectoryRelativePath,
                    message,
                });
            }
            return;
        }

        if (!isEditableFilePath(sourceRelativePath)) {
            console.warn("[vault-ui] drop-move skipped: unsupported file type", {
                sourceRelativePath,
                targetDirectoryRelativePath,
            });
            return;
        }

        try {
            const result = isCanvasPath(sourceRelativePath)
                ? await moveVaultCanvasFileToDirectory(sourceRelativePath, targetDirectoryRelativePath)
                : await moveVaultMarkdownFileToDirectory(sourceRelativePath, targetDirectoryRelativePath);
            closeTab?.(`file:${sourceRelativePath}`);

            const latestContent = await readEditableFileContent(result.relativePath);
            await openFileWithResolver({
                relativePath: result.relativePath,
                currentVaultPath,
                contentOverride: latestContent,
                openTab,
            });

            console.info("[vault-ui] drop-move success", {
                from: sourceRelativePath,
                to: result.relativePath,
            });
        } catch (moveError) {
            const message = resolveErrorMessage(moveError, t("vault.dragMoveFileFailed"));
            console.error("[vault-ui] drop-move failed", {
                sourceRelativePath,
                targetDirectoryRelativePath,
                message,
            });
        }
    };

    const moveItemToDirectory = async (
        item: FileTreeItem,
        targetDirectoryRelativePath: string,
    ): Promise<void> => {
        if (item.isDir) {
            const result = await moveVaultDirectoryToDirectory(item.path, targetDirectoryRelativePath);
            console.info("[vault-ui] batch move directory success", {
                from: item.path,
                to: result.relativePath,
            });
            return;
        }

        if (!isEditableFilePath(item.path)) {
            console.warn("[vault-ui] batch move skipped: unsupported file type", {
                path: item.path,
                targetDirectoryRelativePath,
            });
            return;
        }

        const sourceTabId = `file:${item.path}`;
        const sourceSnapshot = getArticleSnapshotById(sourceTabId);
        const result = isCanvasPath(item.path)
            ? await moveVaultCanvasFileToDirectory(item.path, targetDirectoryRelativePath)
            : await moveVaultMarkdownFileToDirectory(item.path, targetDirectoryRelativePath);
        const targetPath = result.relativePath.replace(/\\/g, "/");

        if (sourceSnapshot && !isCanvasPath(item.path)) {
            await saveVaultMarkdownFile(targetPath, sourceSnapshot.content);
            closeTab?.(sourceTabId);
            await openFileWithResolver({
                relativePath: targetPath,
                currentVaultPath,
                contentOverride: sourceSnapshot.content,
                openTab,
            });
        } else {
            closeTab?.(sourceTabId);
            const latestContent = await readEditableFileContent(targetPath);
            await openFileWithResolver({
                relativePath: targetPath,
                currentVaultPath,
                contentOverride: latestContent,
                openTab,
            });
        }

        console.info("[vault-ui] batch move file success", {
            from: item.path,
            to: targetPath,
        });
    };

    const moveItemsToDirectory = async (
        items: FileTreeItem[],
        targetDirectoryRelativePath: string,
    ): Promise<void> => {
        const normalizedItems = normalizeBatchItems(items);
        for (const item of normalizedItems) {
            try {
                await moveItemToDirectory(item, targetDirectoryRelativePath);
            } catch (moveError) {
                const message = resolveErrorMessage(moveError, t("vault.dragMoveFileFailed"));
                console.error("[vault-ui] batch move item failed", {
                    path: item.path,
                    targetDirectoryRelativePath,
                    message,
                });
            }
        }
    };

    const handleDeleteItems = async (items: FileTreeItem[]): Promise<void> => {
        const normalizedItems = normalizeBatchItems(items);
        if (normalizedItems.length <= 1) {
            const onlyItem = normalizedItems[0];
            if (onlyItem) {
                await handleDeleteItem(onlyItem);
            }
            return;
        }

        const confirmed = await confirm(t("vault.confirmDeleteSelection", { count: normalizedItems.length }), {
            title: t("common.confirm"),
            kind: "warning",
        });
        if (!confirmed) {
            return;
        }

        for (const item of normalizedItems) {
            try {
                if (item.isDir) {
                    await deleteVaultDirectory(item.path);
                    console.info("[vault-ui] batch delete directory success", {
                        path: item.path,
                    });
                } else if (isCanvasPath(item.path)) {
                    await deleteVaultCanvasFile(item.path);
                    closeTab?.(`file:${item.path}`);
                    console.info("[vault-ui] batch delete file success", {
                        path: item.path,
                    });
                } else if (isMarkdownPath(item.path)) {
                    await deleteVaultMarkdownFile(item.path);
                    closeTab?.(`file:${item.path}`);
                    console.info("[vault-ui] batch delete file success", {
                        path: item.path,
                    });
                }
            } catch (deleteError) {
                const message = resolveErrorMessage(deleteError, t("vault.deleteFileFailed"));
                console.error("[vault-ui] batch delete item failed", {
                    path: item.path,
                    message,
                });
            }
        }
    };

    const moveDirectoryOptions = useMemo(
        () =>
            files
                .filter((entry) => entry.isDir)
                .map((entry) => entry.path.replace(/\\/g, "/"))
                .sort((left, right) => left.localeCompare(right)),
        [files],
    );

    const handleMoveSelectionConfirmed = async (targetDirectoryRelativePath: string): Promise<void> => {
        const currentSelection = moveSelection;
        if (!currentSelection || currentSelection.length === 0) {
            return;
        }

        await moveItemsToDirectory(currentSelection, targetDirectoryRelativePath);
        setMoveSelection(null);
    };

    const handleCreateFileInDirectory = async (
        targetDirectoryRelativePath: string,
        draftName: string,
    ): Promise<void> => {
        console.info("[vault-ui] create file request", {
            targetDirectoryRelativePath,
            draftName,
        });

        const relativePath = resolveCreatedFilePath(targetDirectoryRelativePath, draftName);

        if (!relativePath) {
            return;
        }

        const initialContent = isCanvasPath(relativePath)
            ? buildCreatedCanvasInitialContent(relativePath)
            : buildCreatedMarkdownInitialContent(relativePath);

        try {
            if (isCanvasPath(relativePath)) {
                await createVaultCanvasFile(relativePath, initialContent);
            } else {
                await createVaultMarkdownFile(relativePath, initialContent);
            }
            await openFileWithResolver({
                relativePath,
                currentVaultPath,
                contentOverride: initialContent,
                openTab,
            });
            console.info("[vault-ui] create file success", {
                relativePath,
                targetDirectoryRelativePath,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t("vault.createFileFailed");
            console.error("[vault-ui] create file failed", {
                relativePath,
                targetDirectoryRelativePath,
                message,
            });
        }
    };

    const handleCreateCanvasInDirectory = async (
        targetDirectoryRelativePath: string,
        draftName: string,
    ): Promise<void> => {
        console.info("[vault-ui] create canvas request", {
            targetDirectoryRelativePath,
            draftName,
        });

        const relativePath = resolveCreatedCanvasPath(targetDirectoryRelativePath, draftName);
        if (!relativePath) {
            return;
        }

        const initialContent = buildCreatedCanvasInitialContent(relativePath);

        try {
            await createVaultCanvasFile(relativePath, initialContent);
            await openFileWithResolver({
                relativePath,
                currentVaultPath,
                contentOverride: initialContent,
                openTab,
            });
            console.info("[vault-ui] create canvas success", {
                relativePath,
                targetDirectoryRelativePath,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t("vault.createFileFailed");
            console.error("[vault-ui] create canvas failed", {
                relativePath,
                targetDirectoryRelativePath,
                message,
            });
        }
    };

    const handleCreateFolderInDirectory = async (
        targetDirectoryRelativePath: string,
        draftName: string,
    ): Promise<void> => {
        console.info("[vault-ui] create folder request", {
            targetDirectoryRelativePath,
            draftName,
        });

        const relativeDirectoryPath = resolveCreatedDirectoryPath(targetDirectoryRelativePath, draftName);

        if (!relativeDirectoryPath) {
            return;
        }

        try {
            await createVaultDirectory(relativeDirectoryPath);
            console.info("[vault-ui] create folder success", {
                relativeDirectoryPath,
                targetDirectoryRelativePath,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t("vault.createFolderFailed");
            console.error("[vault-ui] create folder failed", {
                relativeDirectoryPath,
                targetDirectoryRelativePath,
                message,
            });
        }
    };

    return (
        <div className="vault-panel-root">
            {error ? <p className="vault-toolbar-error">{error}</p> : null}
            {!error && !isLoadingTree && !currentVaultPath ? (
                <p className="vault-toolbar-error">{t("vault.noVault")}</p>
            ) : null}

            <FileTree
                items={files}
                activePath={focusedArticle?.path ?? null}
                renameRequest={renameRequest}
                onOpenFile={(item) => {
                    void handleOpenFile(item);
                }}
                onRenameSubmit={(item, draftName) => {
                    return handleRenameSubmit(item, draftName);
                }}
                onDeleteItem={(item) => {
                    void handleDeleteItem(item);
                }}
                onDeleteItems={(items) => {
                    void handleDeleteItems(items);
                }}
                onMoveToItem={(item) => {
                    setMoveSelection([item]);
                }}
                onMoveItemsToDirectory={(items) => {
                    setMoveSelection(normalizeBatchItems(items));
                }}
                onMoveFileByDrop={(sourceRelativePath, targetDirectoryRelativePath, sourceIsDir) => {
                    void handleMoveByDrop(sourceRelativePath, targetDirectoryRelativePath, sourceIsDir);
                }}
                onMoveItemsByDrop={(items, targetDirectoryRelativePath) => {
                    void moveItemsToDirectory(items, targetDirectoryRelativePath);
                }}
                onCreateFileInDirectory={(targetDirectoryRelativePath, draftName) => {
                    void handleCreateFileInDirectory(targetDirectoryRelativePath, draftName);
                }}
                onCreateCanvasInDirectory={(targetDirectoryRelativePath, draftName) => {
                    void handleCreateCanvasInDirectory(targetDirectoryRelativePath, draftName);
                }}
                onCreateFolderInDirectory={(targetDirectoryRelativePath, draftName) => {
                    void handleCreateFolderInDirectory(targetDirectoryRelativePath, draftName);
                }}
            />

            <MoveFileDirectoryModal
                isOpen={Boolean(moveSelection && moveSelection.length > 0)}
                title={moveSelection && moveSelection.length > 1 ? t("moveFileModal.titleSelection", { count: moveSelection.length }) : undefined}
                ariaLabel={moveSelection && moveSelection.length > 1 ? t("moveFileModal.ariaLabelSelection", { count: moveSelection.length }) : undefined}
                sourceFilePath={buildMoveSelectionLabel(moveSelection ?? [], t)}
                directories={moveDirectoryOptions}
                onClose={() => {
                    setMoveSelection(null);
                }}
                onConfirmDirectory={(directoryRelativePath) => {
                    void handleMoveSelectionConfirmed(directoryRelativePath);
                }}
            />

            {/* 底部仓库路径分隔栏：hover 变色，点击触发打开仓库 */}
            <div
                className="vault-separator"
                title={currentVaultPath}
                role="button"
                tabIndex={0}
                onClick={() => {
                    if (!isLoadingTree) {
                        void handleOpenVaultWithSystemFs();
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && !isLoadingTree) {
                        void handleOpenVaultWithSystemFs();
                    }
                }}
            >
                {currentVaultPath ? (
                    <>
                        {/* 前缀：可被 CSS 省略截断 */}
                        <span className="vault-separator-prefix">
                            {vaultPathPrefix}
                        </span>
                        {/* 仓库根目录名：始终完整显示 */}
                        <span className="vault-separator-root">
                            {vaultPathRootName}
                        </span>
                    </>
                ) : (
                    <span className="vault-separator-root">
                        {t("vault.openVault")}
                    </span>
                )}
            </div>
        </div>
    );
}
