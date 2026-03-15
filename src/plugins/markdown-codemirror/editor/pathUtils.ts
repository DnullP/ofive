/**
 * @module plugins/markdown-codemirror/editor/pathUtils
 * @description 编辑器路径工具：提供文档路径与目录计算能力。
 */

/**
 * @function resolveParentDirectory
 * @description 计算文档路径所在目录。
 * @param filePath 文档路径。
 * @returns 目录路径；根目录下文件返回空字符串。
 */
export function resolveParentDirectory(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const index = normalized.lastIndexOf("/");
    if (index <= 0) {
        return "";
    }
    return normalized.slice(0, index);
}
