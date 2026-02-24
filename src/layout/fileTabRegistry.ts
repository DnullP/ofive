/**
 * @module layout/fileTabRegistry
 * @description 文件打开注册表：按文件类型匹配并返回对应 Tab 定义。
 * @dependencies
 *  - ./DockviewLayout
 *  - ./FileTree
 *  - ../api/vaultApi
 */

import type { TabInstanceDefinition } from "./DockviewLayout";
import type { FileTreeItem } from "./FileTree";
import { readVaultMarkdownFile } from "../api/vaultApi";

/**
 * @interface FileTabResolveContext
 * @description 文件打开解析上下文。
 */
export interface FileTabResolveContext {
    item: FileTreeItem;
    currentVaultPath: string;
}

/**
 * @interface FileTabRegistration
 * @description 文件类型到 Tab 的注册项。
 */
interface FileTabRegistration {
    matches: (path: string) => boolean;
    resolveTab: (context: FileTabResolveContext) => Promise<TabInstanceDefinition>;
}

/**
 * @function isMarkdownPath
 * @description 判断路径是否为 Markdown 文件。
 * @param path 文件相对路径。
 * @returns 若为 Markdown 返回 true。
 */
function isMarkdownPath(path: string): boolean {
    return path.endsWith(".md") || path.endsWith(".markdown");
}

/**
 * @function isImagePath
 * @description 判断路径是否为常见图片文件。
 * @param path 文件相对路径。
 * @returns 若为图片返回 true。
 */
function isImagePath(path: string): boolean {
    return /\.(png|jpg|jpeg|gif|webp|bmp|svg|ico)$/i.test(path);
}

/**
 * @function joinVaultAbsolutePath
 * @description 将仓库绝对路径与相对路径拼接为绝对文件路径。
 * @param vaultPath 仓库绝对路径。
 * @param relativePath 文件相对路径。
 * @returns 文件绝对路径。
 */
function joinVaultAbsolutePath(vaultPath: string, relativePath: string): string {
    const normalizedVaultPath = vaultPath.replace(/[\\/]+$/, "");
    const normalizedRelativePath = relativePath.replace(/^[/\\]+/, "");
    return `${normalizedVaultPath}/${normalizedRelativePath}`;
}

/**
 * @constant FILE_TAB_REGISTRATIONS
 * @description 文件类型注册列表，按顺序匹配。
 */
const FILE_TAB_REGISTRATIONS: FileTabRegistration[] = [
    {
        matches: isMarkdownPath,
        async resolveTab({ item }) {
            const fileName = item.path.split("/").pop() ?? item.path;
            const result = await readVaultMarkdownFile(item.path);
            return {
                id: `file:${item.path}`,
                title: fileName,
                component: "codemirror",
                params: {
                    path: item.path,
                    content: result.content,
                },
            };
        },
    },
    {
        matches: isImagePath,
        async resolveTab({ item, currentVaultPath }) {
            const fileName = item.path.split("/").pop() ?? item.path;
            const absolutePath = joinVaultAbsolutePath(currentVaultPath, item.path);
            return {
                id: `file:${item.path}`,
                title: fileName,
                component: "imageviewer",
                params: {
                    path: item.path,
                    absolutePath,
                },
            };
        },
    },
];

/**
 * @function resolveFileTabByRegistration
 * @description 使用注册表解析文件应打开的 Tab。
 * @param context 文件打开上下文。
 * @returns 匹配到的 Tab 定义，未匹配返回 null。
 */
export async function resolveFileTabByRegistration(
    context: FileTabResolveContext,
): Promise<TabInstanceDefinition | null> {
    const registration = FILE_TAB_REGISTRATIONS.find((item) => item.matches(context.item.path));
    if (!registration) {
        return null;
    }

    return registration.resolveTab(context);
}
