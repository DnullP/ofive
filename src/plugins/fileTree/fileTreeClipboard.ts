/**
 * @module plugins/fileTree/fileTreeClipboard
 * @description 文件树插件剪贴板模块：管理资源管理器复制操作的临时状态。
 *
 *   该模块属于文件树插件领域逻辑，不再挂在核心命令基础设施下：
 *   - Cmd+C 时记录当前选中的文件/目录
 *   - Cmd+V 时读取记录并交给文件树插件命令执行复制
 *
 * @dependencies 无
 *
 * @example
 *   import {
 *       setFileTreeClipboardEntry,
 *       getFileTreeClipboardEntry,
 *   } from "./fileTreeClipboard";
 *
 *   setFileTreeClipboardEntry({ path: "notes/test.md", isDir: false });
 *   const entry = getFileTreeClipboardEntry();
 *
 * @exports
 *   - FileTreeClipboardEntry 剪贴板条目结构
 *   - setFileTreeClipboardEntry 写入剪贴板
 *   - getFileTreeClipboardEntry 读取剪贴板
 *   - clearFileTreeClipboard 清空剪贴板
 */

/**
 * @interface FileTreeClipboardEntry
 * @description 文件树剪贴板条目，描述一个被复制的文件或目录。
 */
export interface FileTreeClipboardEntry {
    /** 被复制条目的相对路径（相对于 vault 根目录） */
    path: string;
    /** 是否为目录 */
    isDir: boolean;
}

/** 文件树插件内部剪贴板状态。 */
let clipboardEntry: FileTreeClipboardEntry | null = null;

/**
 * @function setFileTreeClipboardEntry
 * @description 设置文件树剪贴板内容。
 * @param entry 复制的条目信息。
 * @returns 无返回值。
 */
export function setFileTreeClipboardEntry(entry: FileTreeClipboardEntry): void {
    clipboardEntry = { ...entry };
    console.info("[file-tree-clipboard] copied", {
        path: entry.path,
        isDir: entry.isDir,
    });
}

/**
 * @function getFileTreeClipboardEntry
 * @description 获取文件树剪贴板当前内容。
 * @returns 剪贴板条目；为空时返回 null。
 */
export function getFileTreeClipboardEntry(): FileTreeClipboardEntry | null {
    return clipboardEntry;
}

/**
 * @function clearFileTreeClipboard
 * @description 清空文件树剪贴板。
 * @returns 无返回值。
 */
export function clearFileTreeClipboard(): void {
    clipboardEntry = null;
    console.debug("[file-tree-clipboard] cleared");
}