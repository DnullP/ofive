/**
 * @module plugins/fileTreePlugin
 * @description 资源管理器插件：自注册活动入口、侧边栏面板与文件树专属命令。
 *
 *   该模块将文件树浏览能力从内置注册链中拆出，作为独立插件存在：
 *   - 注册左侧 activity icon
 *   - 注册 files panel
 *   - 注册“打开资源管理器 / 复制 / 粘贴 / 删除”命令
 *
 * @dependencies
 *   - react
 *   - lucide-react
 *   - ../registry/activityRegistry
 *   - ../registry/panelRegistry
 *   - ../commands/commandSystem
 *   - ../api/vaultApi
 *   - ../layout/VaultPanel
 *   - ../i18n
 *   - ./fileTree/fileTreeClipboard
 *
 * @example
 *   放置于 src/plugins/ 后，应用启动时会被 main.tsx 自动导入并完成注册。
 *
 * @exports 无导出（纯副作用模块）
 */

import React from "react";
import { FolderOpen } from "lucide-react";
import {
    copyVaultEntry,
    deleteVaultBinaryFile,
    deleteVaultDirectory,
    deleteVaultMarkdownFile,
} from "../api/vaultApi";
import { registerCommands } from "../commands/commandSystem";
import i18n from "../i18n";
import { VaultPanel } from "../layout/VaultPanel";
import { registerActivity } from "../registry/activityRegistry";
import { registerPanel } from "../registry/panelRegistry";
import {
    getFileTreeClipboardEntry,
    setFileTreeClipboardEntry,
} from "./fileTree/fileTreeClipboard";

const FILE_TREE_ACTIVITY_ID = "files";
const FILE_TREE_PANEL_ID = "files";
const FILE_TREE_OPEN_COMMAND_ID = "fileTree.openExplorer";

/**
 * @function isMarkdownPath
 * @description 判断文件路径是否为 Markdown 文档。
 * @param path 文件相对路径。
 * @returns 命中 Markdown 扩展名时返回 true。
 */
function isMarkdownPath(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

i18n.addResourceBundle("en", "translation", {
    fileTreePlugin: {
        openCommand: "Open Explorer",
    },
}, true, true);

i18n.addResourceBundle("zh", "translation", {
    fileTreePlugin: {
        openCommand: "打开资源管理器",
    },
}, true, true);

registerActivity({
    type: "panel-container",
    id: FILE_TREE_ACTIVITY_ID,
    title: () => i18n.t("app.explorer"),
    icon: React.createElement(FolderOpen, { size: 18, strokeWidth: 1.8 }),
    defaultSection: "top",
    defaultBar: "left",
    defaultOrder: 1,
});

registerPanel({
    id: FILE_TREE_PANEL_ID,
    title: () => i18n.t("app.explorer"),
    activityId: FILE_TREE_ACTIVITY_ID,
    defaultPosition: "left",
    defaultOrder: 1,
    render: (context) => React.createElement(VaultPanel, {
        openTab: context.openTab,
        closeTab: context.closeTab,
        requestMoveFileToDirectory: context.requestMoveFileToDirectory,
    }),
});

registerCommands([
    {
        id: FILE_TREE_OPEN_COMMAND_ID,
        title: "fileTreePlugin.openCommand",
        execute: (context) => {
            if (!context.activatePanel) {
                console.warn("[fileTreePlugin] open command skipped: activatePanel missing");
                return;
            }

            context.activatePanel(FILE_TREE_PANEL_ID);
        },
    },
    {
        id: "fileTree.copySelected",
        title: "commands.copySelectedFile",
        condition: "fileTreeFocused",
        shortcut: {
            defaultBinding: "Cmd+C",
            editableInSettings: true,
        },
        execute(context) {
            const selected = context.getFileTreeSelectedItem?.();
            if (!selected) {
                console.warn("[fileTreePlugin] fileTree.copySelected skipped: no selection");
                return;
            }

            setFileTreeClipboardEntry(selected);
        },
    },
    {
        id: "fileTree.pasteInDirectory",
        title: "commands.pasteFileToDir",
        condition: "fileTreeFocused",
        shortcut: {
            defaultBinding: "Cmd+V",
            editableInSettings: true,
        },
        async execute(context) {
            const entry = getFileTreeClipboardEntry();
            if (!entry) {
                console.warn("[fileTreePlugin] fileTree.pasteInDirectory skipped: clipboard empty");
                return;
            }

            const targetDirectory = context.getFileTreePasteTargetDirectory?.() ?? "";

            console.info("[fileTreePlugin] fileTree.pasteInDirectory start", {
                sourcePath: entry.path,
                targetDirectory,
                isDir: entry.isDir,
            });

            try {
                const result = await copyVaultEntry(entry.path, targetDirectory);
                console.info("[fileTreePlugin] fileTree.pasteInDirectory success", {
                    newPath: result.relativePath,
                    sourcePath: result.sourceRelativePath,
                });
            } catch (error) {
                console.error("[fileTreePlugin] fileTree.pasteInDirectory failed", {
                    sourcePath: entry.path,
                    targetDirectory,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        },
    },
    {
        id: "fileTree.deleteSelected",
        title: "commands.deleteSelectedFile",
        condition: "fileTreeFocused",
        shortcut: {
            defaultBinding: "Cmd+Backspace",
            editableInSettings: true,
        },
        async execute(context) {
            const selected = context.getFileTreeSelectedItem?.();
            if (!selected) {
                console.warn("[fileTreePlugin] fileTree.deleteSelected skipped: no selection");
                return;
            }

            console.info("[fileTreePlugin] fileTree.deleteSelected start", {
                path: selected.path,
                isDir: selected.isDir,
            });

            try {
                if (selected.isDir) {
                    await deleteVaultDirectory(selected.path);
                } else if (isMarkdownPath(selected.path)) {
                    await deleteVaultMarkdownFile(selected.path);
                } else {
                    await deleteVaultBinaryFile(selected.path);
                }

                console.info("[fileTreePlugin] fileTree.deleteSelected success", {
                    path: selected.path,
                    isDir: selected.isDir,
                });
            } catch (error) {
                console.error("[fileTreePlugin] fileTree.deleteSelected failed", {
                    path: selected.path,
                    isDir: selected.isDir,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        },
    },
]);

console.info("[fileTreePlugin] registered file tree plugin");