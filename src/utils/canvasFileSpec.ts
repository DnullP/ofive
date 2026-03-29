/**
 * @module utils/canvasFileSpec
 * @description Canvas 文件规则的单一事实源。
 *   该模块统一管理：
 *   - Canvas 文件扩展名判断
 *   - 新建 Canvas 文件路径推导
 *   - 新建 Canvas 文件初始内容模板
 *
 * @example
 *   const relativePath = resolveCreatedCanvasPath("boards", "roadmap");
 *   const content = buildCreatedCanvasInitialContent(relativePath ?? "roadmap.canvas");
 */

/**
 * @function isCanvasPath
 * @description 判断给定路径是否为 Canvas 文件。
 * @param path 相对路径或文件名。
 * @returns 命中 `.canvas` 扩展名时返回 true。
 */
export function isCanvasPath(path: string): boolean {
    return path.toLowerCase().endsWith(".canvas");
}

/**
 * @function resolveCreatedCanvasPath
 * @description 根据目标目录和草稿名称推导新建 Canvas 的相对路径。
 * @param directoryPath 目标目录相对路径；空字符串表示仓库根目录。
 * @param draftName 用户输入的草稿名称。
 * @returns 规范化后的 Canvas 相对路径；无效输入返回 null。
 */
export function resolveCreatedCanvasPath(directoryPath: string, draftName: string): string | null {
    const trimmedName = draftName.trim();
    if (!trimmedName) {
        return null;
    }

    const fileName = isCanvasPath(trimmedName) ? trimmedName : `${trimmedName}.canvas`;
    const normalizedDirectory = directoryPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return normalizedDirectory ? `${normalizedDirectory}/${fileName}` : fileName;
}

/**
 * @function buildCreatedCanvasInitialContent
 * @description 为新建 Canvas 文件生成初始 JSON 内容。
 * @param relativePath 新文件相对路径。
 * @returns 初始 JSON 文本。
 */
export function buildCreatedCanvasInitialContent(relativePath: string): string {
    const fileName = relativePath.split("/").pop() ?? relativePath;
    const title = fileName.replace(/\.canvas$/i, "");
    return JSON.stringify({
        nodes: [],
        edges: [],
        metadata: {
            title,
        },
    }, null, 2) + "\n";
}