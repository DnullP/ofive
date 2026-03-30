/**
 * @module plugins/markdown-codemirror/editor/noteTitleUtils
 * @description Markdown 笔记标题工具：负责在编辑器顶部标题输入栏与真实文件名之间做转换。
 * @dependencies
 *  - 无
 *
 * @example
 *   const title = resolveMarkdownNoteTitle("notes/blockchain.md");
 *   const nextPath = resolveRenamedMarkdownPath("notes/blockchain.md", "Blockchain Basics");
 *
 * @exports
 *  - resolveMarkdownNoteTitle: 从 Markdown 相对路径提取无后缀标题
 *  - resolveRenamedMarkdownPath: 基于当前路径和标题草稿生成新的 Markdown 路径
 */

/**
 * @function resolveMarkdownNoteTitle
 * @description 从 Markdown 相对路径中提取展示给用户的标题，自动去掉 `.md` / `.markdown` 后缀。
 * @param relativePath 当前笔记相对路径。
 * @returns 无后缀的笔记标题。
 */
export function resolveMarkdownNoteTitle(relativePath: string): string {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
    return fileName.replace(/\.(md|markdown)$/i, "");
}

/**
 * @function resolveRenamedMarkdownPath
 * @description 根据当前 Markdown 路径和用户输入的标题草稿生成新的目标路径。
 *   - 若草稿未包含后缀，则沿用当前文件后缀
 *   - 若草稿为空白，则返回 null
 * @param currentPath 当前 Markdown 文件相对路径。
 * @param draftTitle 用户输入的标题草稿。
 * @returns 新的目标路径；输入无效时返回 null。
 */
export function resolveRenamedMarkdownPath(
    currentPath: string,
    draftTitle: string,
): string | null {
    const normalizedCurrentPath = currentPath.replace(/\\/g, "/");
    const trimmedTitle = draftTitle.trim();
    if (!trimmedTitle) {
        return null;
    }

    const currentFileName = normalizedCurrentPath.split("/").pop() ?? normalizedCurrentPath;
    const currentSuffixMatch = currentFileName.match(/(\.md|\.markdown)$/i);
    const currentSuffix = currentSuffixMatch?.[0] ?? ".md";
    const nextFileName = /\.(md|markdown)$/i.test(trimmedTitle)
        ? trimmedTitle
        : `${trimmedTitle}${currentSuffix}`;

    const splitIndex = normalizedCurrentPath.lastIndexOf("/");
    if (splitIndex < 0) {
        return nextFileName;
    }

    const parentDirectory = normalizedCurrentPath.slice(0, splitIndex);
    return `${parentDirectory}/${nextFileName}`;
}