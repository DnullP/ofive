/**
 * @module commands/fileTreeClipboard
 * @description 文件树剪贴板模块：管理文件树中"复制"操作的临时状态。
 *   当用户在文件树中按 Cmd+C 复制文件或目录时，路径信息存储在此模块中；
 *   按 Cmd+V 粘贴时，从此模块读取源路径并调用后端复制 API。
 *
 * @dependencies 无
 *
 * @example
 *   import { setFileTreeClipboardEntry, getFileTreeClipboardEntry } from "./fileTreeClipboard";
 *
 *   setFileTreeClipboardEntry({ path: "notes/test.md", isDir: false });
 *   const entry = getFileTreeClipboardEntry(); // { path: "notes/test.md", isDir: false }
 *
 * 导出：
 *  - FileTreeClipboardEntry 接口 — 剪贴板条目结构
 *  - setFileTreeClipboardEntry 函数 — 写入剪贴板
 *  - getFileTreeClipboardEntry 函数 — 读取剪贴板
 *  - clearFileTreeClipboard 函数 — 清空剪贴板
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

/** 内部剪贴板状态，模块级单例 */
let clipboardEntry: FileTreeClipboardEntry | null = null;

/**
 * @function setFileTreeClipboardEntry
 * @description 设置文件树剪贴板内容（覆盖写入）。
 * @param entry 复制的条目信息。
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
 */
export function clearFileTreeClipboard(): void {
    clipboardEntry = null;
    console.debug("[file-tree-clipboard] cleared");
}
