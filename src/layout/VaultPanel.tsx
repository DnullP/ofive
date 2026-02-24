/**
 * @module layout/VaultPanel
 * @description 资源管理器面板：订阅 vault 全局状态，提供仓库打开与文件树展示能力。
 * @dependencies
 *  - react
 *  - @tauri-apps/plugin-dialog
 *  - ./FileTree
 *  - ../store/vaultStore
 *  - ../api/vaultApi
 */

import { type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileTree, type FileTreeItem } from "./FileTree";
import type { TabInstanceDefinition } from "./DockviewLayout";
import { resolveFileTabByRegistration } from "./fileTabRegistry";
import {
    createVaultDirectory,
    createVaultMarkdownFile,
    deleteVaultDirectory,
    deleteVaultMarkdownFile,
    moveVaultDirectoryToDirectory,
    moveVaultMarkdownFileToDirectory,
    readVaultMarkdownFile,
    renameVaultDirectory,
    renameVaultMarkdownFile,
    saveVaultMarkdownFile,
} from "../api/vaultApi";
import { getArticleSnapshotById, useFocusedArticle } from "../store/editorContextStore";
import {
    setCurrentVaultPath,
    useVaultState,
} from "../store/vaultStore";
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
    const hasMarkdownSuffix = /\.(md|markdown)$/i.test(trimmedName);
    const currentSuffixMatch = currentFileName.match(/(\.md|\.markdown)$/i);
    const currentSuffix = currentSuffixMatch?.[0] ?? ".md";
    const nextFileName = hasMarkdownSuffix ? trimmedName : `${trimmedName}${currentSuffix}`;

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

    const hasSuffix = /\.(md|markdown)$/i.test(trimmedName);
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
 * @function VaultPanel
 * @description 渲染资源管理器：当前目录展示、系统打开仓库、文件树展示。
 * @param props 面板参数。
 * @returns React 节点。
 */
export function VaultPanel(props: VaultPanelProps): ReactNode {
    const { openTab, closeTab, requestMoveFileToDirectory } = props;
    const { currentVaultPath, files, isLoadingTree, error } = useVaultState();
    const focusedArticle = useFocusedArticle();

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
                title: "选择仓库目录",
            });
            const selectedPath = normalizeSelectedVaultPath(selected);

            if (!selectedPath) {
                console.warn("[vault-ui] openVault:dialog:cancelled-or-invalid", { selected });
                return;
            }

            console.info("[vault-ui] openVault:dialog:selected", { selectedPath });
            setCurrentVaultPath(selectedPath);
        } catch (openError) {
            const message = openError instanceof Error ? openError.message : "打开系统目录选择器失败";
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
            const tab = await resolveFileTabByRegistration({
                item,
                currentVaultPath,
            });
            if (!tab) {
                console.warn("[vault-ui] openFile skipped: no tab registration", {
                    path: item.path,
                });
                return;
            }

            openTab(tab);
        } catch (readError) {
            const message = readError instanceof Error ? readError.message : "读取文件失败";
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
                const message = renameError instanceof Error ? renameError.message : "重命名目录失败";
                console.error("[vault-ui] rename directory failed", {
                    from: item.path,
                    to: targetPath,
                    message,
                });
                return false;
            }
        }

        if (!isMarkdownPath(item.path)) {
            console.warn("[vault-ui] rename skipped: only markdown file is supported", {
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

            await renameVaultMarkdownFile(item.path, targetPath);

            if (sourceSnapshot) {
                await saveVaultMarkdownFile(targetPath, sourceSnapshot.content);
            }

            const newTabId = `file:${targetPath}`;
            closeTab?.(sourceTabId);

            const latestContent = sourceSnapshot
                ? sourceSnapshot.content
                : await readVaultMarkdownFile(targetPath).then((result) => result.content);

            openTab({
                id: newTabId,
                title: targetPath.split("/").pop() ?? targetPath,
                component: "codemirror",
                params: {
                    path: targetPath,
                    content: latestContent,
                },
            });

            console.info("[vault-ui] rename success", {
                from: item.path,
                to: targetPath,
            });
            return true;
        } catch (renameError) {
            const message = renameError instanceof Error ? renameError.message : "重命名文件失败";
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
            const confirmed = window.confirm(`确认删除目录 ${item.path} 及其内容?`);
            if (!confirmed) {
                return;
            }

            try {
                await deleteVaultDirectory(item.path);
                console.info("[vault-ui] delete directory success", {
                    path: item.path,
                });
            } catch (deleteError) {
                const message = resolveErrorMessage(deleteError, "删除目录失败");
                console.error("[vault-ui] delete directory failed", {
                    path: item.path,
                    message,
                });
            }
            return;
        }

        if (!isMarkdownPath(item.path)) {
            console.warn("[vault-ui] delete skipped: only markdown file is supported", {
                path: item.path,
                isDir: item.isDir,
            });
            return;
        }

        const confirmed = window.confirm(`确认删除 ${item.path} ?`);
        if (!confirmed) {
            return;
        }

        try {
            await deleteVaultMarkdownFile(item.path);
            closeTab?.(`file:${item.path}`);
            console.info("[vault-ui] delete success", {
                path: item.path,
            });
        } catch (deleteError) {
            const message = resolveErrorMessage(deleteError, "删除文件失败");
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
                const message = resolveErrorMessage(moveError, "拖拽移动目录失败");
                console.error("[vault-ui] drop-move directory failed", {
                    sourceRelativePath,
                    targetDirectoryRelativePath,
                    message,
                });
            }
            return;
        }

        if (!isMarkdownPath(sourceRelativePath)) {
            console.warn("[vault-ui] drop-move skipped: only markdown file is supported", {
                sourceRelativePath,
                targetDirectoryRelativePath,
            });
            return;
        }

        try {
            const result = await moveVaultMarkdownFileToDirectory(sourceRelativePath, targetDirectoryRelativePath);
            closeTab?.(`file:${sourceRelativePath}`);

            const latest = await readVaultMarkdownFile(result.relativePath);
            openTab({
                id: `file:${result.relativePath}`,
                title: result.relativePath.split("/").pop() ?? result.relativePath,
                component: "codemirror",
                params: {
                    path: result.relativePath,
                    content: latest.content,
                },
            });

            console.info("[vault-ui] drop-move success", {
                from: sourceRelativePath,
                to: result.relativePath,
            });
        } catch (moveError) {
            const message = resolveErrorMessage(moveError, "拖拽移动文件失败");
            console.error("[vault-ui] drop-move failed", {
                sourceRelativePath,
                targetDirectoryRelativePath,
                message,
            });
        }
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

        try {
            await createVaultMarkdownFile(relativePath, "");
            openTab({
                id: `file:${relativePath}`,
                title: relativePath.split("/").pop() ?? relativePath,
                component: "codemirror",
                params: {
                    path: relativePath,
                    content: "",
                },
            });
            console.info("[vault-ui] create file success", {
                relativePath,
                targetDirectoryRelativePath,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "创建文件失败";
            console.error("[vault-ui] create file failed", {
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
            const message = error instanceof Error ? error.message : "创建文件夹失败";
            console.error("[vault-ui] create folder failed", {
                relativeDirectoryPath,
                targetDirectoryRelativePath,
                message,
            });
        }
    };

    return (
        <div className="vault-panel-root">
            <div className="vault-toolbar">
                <div className="vault-toolbar-path" title={currentVaultPath}>
                    <span className="vault-toolbar-label">当前目录：</span>
                    <span className="vault-toolbar-value">{currentVaultPath}</span>
                </div>
                <button
                    type="button"
                    className="vault-toolbar-open-button"
                    onClick={() => {
                        void handleOpenVaultWithSystemFs();
                    }}
                    disabled={isLoadingTree}
                >
                    {isLoadingTree ? "加载中..." : "打开仓库"}
                </button>
            </div>
            {error ? <p className="vault-toolbar-error">{error}</p> : null}

            <FileTree
                items={files}
                activePath={focusedArticle?.path ?? null}
                onOpenFile={(item) => {
                    void handleOpenFile(item);
                }}
                onRenameSubmit={(item, draftName) => {
                    return handleRenameSubmit(item, draftName);
                }}
                onDeleteItem={(item) => {
                    void handleDeleteItem(item);
                }}
                onMoveToItem={(item) => {
                    requestMoveFileToDirectory?.(item.path);
                }}
                onMoveFileByDrop={(sourceRelativePath, targetDirectoryRelativePath, sourceIsDir) => {
                    void handleMoveByDrop(sourceRelativePath, targetDirectoryRelativePath, sourceIsDir);
                }}
                onCreateFileInDirectory={(targetDirectoryRelativePath, draftName) => {
                    void handleCreateFileInDirectory(targetDirectoryRelativePath, draftName);
                }}
                onCreateFolderInDirectory={(targetDirectoryRelativePath, draftName) => {
                    void handleCreateFolderInDirectory(targetDirectoryRelativePath, draftName);
                }}
            />
        </div>
    );
}
