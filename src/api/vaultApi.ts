/**
 * @module api/vaultApi
 * @description Vault 后端接口封装，负责连接 Tauri invoke 命令与前端业务。
 * @dependencies
 *  - @tauri-apps/api/core
 *
 * @example
 *   await setCurrentVault("/Users/name/Notes");
 *   const tree = await getCurrentVaultTree();
 *   const file = await readVaultMarkdownFile("test-resources/notes/guide.md");
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * @constant VAULT_FS_EVENT_NAME
 * @description 后端文件系统变更事件名称。
 */
export const VAULT_FS_EVENT_NAME = "vault://fs-event";
export const VAULT_CONFIG_EVENT_NAME = "vault://config-event";

/**
 * @interface VaultEntry
 * @description 仓库目录树节点。
 */
export interface VaultEntry {
    /** 相对路径（以 vault 根为基准） */
    relativePath: string;
    /** 是否目录 */
    isDir: boolean;
}

/**
 * @interface VaultTreeResponse
 * @description 获取目录树接口响应。
 */
export interface VaultTreeResponse {
    /** 当前生效 vault 绝对路径 */
    vaultPath: string;
    /** 目录树节点集合 */
    entries: VaultEntry[];
}

/**
 * @interface ReadMarkdownResponse
 * @description 读取 Markdown 接口响应。
 */
export interface ReadMarkdownResponse {
    /** 被读取文件相对路径 */
    relativePath: string;
    /** 文件内容 */
    content: string;
}

/**
 * @interface ReadBinaryFileResponse
 * @description 读取二进制文件接口响应。
 */
export interface ReadBinaryFileResponse {
    /** 被读取文件相对路径 */
    relativePath: string;
    /** 文件 MIME 类型 */
    mimeType: string;
    /** Base64 编码后的文件内容 */
    base64Content: string;
}

/**
 * @interface WriteMarkdownResponse
 * @description 写入类文件接口响应。
 */
export interface WriteMarkdownResponse {
    /** 被操作文件相对路径 */
    relativePath: string;
    /** 是否创建了新文件 */
    created: boolean;
}

/**
 * @interface WriteBinaryFileResponse
 * @description 二进制文件写入接口响应。
 */
export interface WriteBinaryFileResponse {
    /** 写入后文件的相对路径 */
    relativePath: string;
    /** 是否创建了新文件 */
    created: boolean;
}

/**
 * @interface ChineseSegmentToken
 * @description 中文分词 token 结构。
 */
export interface ChineseSegmentToken {
    /** token 文本 */
    word: string;
    /** token 起始偏移（UTF-16） */
    start: number;
    /** token 结束偏移（UTF-16） */
    end: number;
}

/**
 * @interface ResolveWikiLinkTargetResponse
 * @description WikiLink 目标解析接口响应。
 */
export interface ResolveWikiLinkTargetResponse {
    /** 命中文件相对路径 */
    relativePath: string;
    /** 命中文件绝对路径 */
    absolutePath: string;
}

/**
 * @interface ResolveMediaEmbedTargetResponse
 * @description 图片嵌入目标解析接口响应。
 */
export interface ResolveMediaEmbedTargetResponse {
    /** 命中文件相对路径 */
    relativePath: string;
    /** 命中文件绝对路径 */
    absolutePath: string;
}

/**
 * @interface VaultMarkdownGraphNode
 * @description Markdown 图谱节点结构。
 */
export interface VaultMarkdownGraphNode {
    /** 节点路径（相对 vault） */
    path: string;
    /** 节点标题 */
    title: string;
}

/**
 * @interface VaultMarkdownGraphEdge
 * @description Markdown 图谱边结构。
 */
export interface VaultMarkdownGraphEdge {
    /** 边起点路径 */
    sourcePath: string;
    /** 边终点路径 */
    targetPath: string;
    /** 边权重 */
    weight: number;
}

/**
 * @interface VaultMarkdownGraphResponse
 * @description Markdown 图谱接口响应。
 */
export interface VaultMarkdownGraphResponse {
    /** 图谱节点 */
    nodes: VaultMarkdownGraphNode[];
    /** 图谱边 */
    edges: VaultMarkdownGraphEdge[];
}

/**
 * @interface VaultQuickSwitchItem
 * @description 快速切换搜索结果条目。
 */
export interface VaultQuickSwitchItem {
    /** 命中文件相对路径 */
    relativePath: string;
    /** 展示标题（通常为文件名） */
    title: string;
    /** 匹配评分（越高越相关） */
    score: number;
}

/**
 * @type VaultFsEventType
 * @description 仓库文件系统事件类型。
 */
export type VaultFsEventType = "created" | "modified" | "deleted" | "moved";

/**
 * @interface VaultFsEventPayload
 * @description 后端文件监听推送到前端的事件负载。
 */
export interface VaultFsEventPayload {
    /** 事件唯一ID（后端生成，贯穿前后端排查链路） */
    eventId: string;
    /** 来源 traceId：由前端保存命令携带，后端 watcher 回填用于过滤“自己触发”的事件 */
    sourceTraceId: string | null;
    /** 事件类型 */
    eventType: VaultFsEventType;
    /** 当前路径（相对 vault） */
    relativePath: string | null;
    /** moved 场景下旧路径（相对 vault） */
    oldRelativePath: string | null;
}

/**
 * @interface VaultConfig
 * @description 仓库级配置对象（当前为预留结构）。
 */
export interface VaultConfig {
    /** 配置结构版本 */
    schemaVersion: number;
    /** 预留配置项集合 */
    entries: Record<string, unknown>;
}

/**
 * @type VaultConfigEventType
 * @description 仓库配置文件事件类型。
 */
export type VaultConfigEventType = "created" | "modified" | "deleted" | "moved";

/**
 * @interface VaultConfigEventPayload
 * @description 后端配置文件变更事件负载。
 */
export interface VaultConfigEventPayload {
    eventId: string;
    sourceTraceId: string | null;
    eventType: VaultConfigEventType;
    relativePath: string | null;
    oldRelativePath: string | null;
}

import {
    createWriteTraceId,
    registerLocalWriteTrace,
    isSelfTriggeredPayload,
} from "./selfTriggerTrace";

let browserFallbackVaultPath = "";

/**
 * @function isSelfTriggeredVaultFsEvent
 * @description 判断 fs 事件是否由当前前端写入触发。
 * @param payload 后端推送的 fs 事件。
 * @returns true 表示应跳过本次 reload。
 */
export function isSelfTriggeredVaultFsEvent(payload: VaultFsEventPayload): boolean {
    return isSelfTriggeredPayload(payload);
}

/**
 * @function isSelfTriggeredVaultConfigEvent
 * @description 判断配置事件是否由当前前端写入触发。
 * @param payload 后端推送的配置事件。
 * @returns true 表示应跳过本次 reload。
 */
export function isSelfTriggeredVaultConfigEvent(payload: VaultConfigEventPayload): boolean {
    return isSelfTriggeredPayload(payload);
}

/**
 * @constant BROWSER_MOCK_NOTES_RAW_MODULES
 * @description 浏览器回退模式下，通过 Vite glob 从测试 notes 目录收集 Markdown 原文。
 */
const BROWSER_MOCK_NOTES_RAW_MODULES = import.meta.glob("../../test-resources/notes/**/*.{md,markdown}", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

/**
 * @constant BROWSER_MOCK_MARKDOWN_CONTENTS
 * @description 浏览器回退模式下的 Markdown 样本：启动时根据 test-resources/notes 自动同步。
 */
const BROWSER_MOCK_MARKDOWN_CONTENTS: Record<string, string> = Object.entries(
    BROWSER_MOCK_NOTES_RAW_MODULES,
).reduce<Record<string, string>>((accumulator, [sourcePath, content]) => {
    const normalizedSourcePath = sourcePath.replace(/\\/g, "/");
    const marker = "/test-resources/notes/";
    const markerIndex = normalizedSourcePath.lastIndexOf(marker);
    if (markerIndex < 0) {
        return accumulator;
    }

    const noteRelativePath = normalizedSourcePath.slice(markerIndex + 1);
    accumulator[noteRelativePath] = content;
    return accumulator;
}, {});

/**
 * @function buildBrowserFallbackTreeEntries
 * @description 基于浏览器回退 mock Markdown 路径集合构建文件树条目。
 * @returns 浏览器回退目录树条目。
 */
function buildBrowserFallbackTreeEntries(): VaultEntry[] {
    const markdownPaths = Object.keys(BROWSER_MOCK_MARKDOWN_CONTENTS)
        .map((path) => normalizeSlashPath(path))
        .sort((left, right) => left.localeCompare(right));

    const folderSet = new Set<string>();
    markdownPaths.forEach((path) => {
        const segments = path.split("/");
        if (segments.length <= 1) {
            return;
        }

        let cursor = "";
        for (let index = 0; index < segments.length - 1; index += 1) {
            const segment = segments[index] ?? "";
            cursor = cursor ? `${cursor}/${segment}` : segment;
            folderSet.add(cursor);
        }
    });

    const folderEntries: VaultEntry[] = Array.from(folderSet)
        .sort((left, right) => left.localeCompare(right))
        .map((relativePath) => ({
            relativePath,
            isDir: true,
        }));

    const markdownEntries: VaultEntry[] = markdownPaths.map((relativePath) => ({
        relativePath,
        isDir: false,
    }));

    return [...folderEntries, ...markdownEntries];
}

/**
 * @function normalizeSlashPath
 * @description 统一路径分隔符为 `/`。
 * @param path 原始路径。
 * @returns 规范化路径。
 */
function normalizeSlashPath(path: string): string {
    return path.replace(/\\/g, "/");
}

/**
 * @function normalizeWikiTarget
 * @description 规范化 WikiLink 目标（去别名/标题后缀）。
 * @param target 原始目标文本。
 * @returns 可解析目标。
 */
function normalizeWikiTarget(target: string): string {
    const withoutAlias = target.split("|")[0] ?? target;
    const withoutHeading = withoutAlias.split("#")[0] ?? withoutAlias;
    return normalizeSlashPath(withoutHeading.trim());
}

/**
 * @function normalizeMarkdownLinkTarget
 * @description 规范化 Markdown 链接目标，过滤外部链接。
 * @param target 原始链接目标。
 * @returns 可解析目标；不可解析时返回 null。
 */
function normalizeMarkdownLinkTarget(target: string): string | null {
    const trimmed = target.trim();
    if (!trimmed) {
        return null;
    }

    const withoutAngle = trimmed.startsWith("<") && trimmed.endsWith(">") && trimmed.length > 2
        ? trimmed.slice(1, -1)
        : trimmed;

    if (
        withoutAngle.startsWith("http://") ||
        withoutAngle.startsWith("https://") ||
        withoutAngle.startsWith("mailto:") ||
        withoutAngle.startsWith("#")
    ) {
        return null;
    }

    const withoutQuery = withoutAngle.split("?")[0] ?? withoutAngle;
    const withoutFragment = withoutQuery.split("#")[0] ?? withoutQuery;
    const normalized = normalizeSlashPath(withoutFragment.trim());
    if (!normalized) {
        return null;
    }

    return normalized;
}

/**
 * @function buildBrowserMockMarkdownGraph
 * @description 浏览器回退模式下从 mock Markdown 文本构造图谱结构。
 * @returns mock 图谱结构。
 */
function buildBrowserMockMarkdownGraph(): VaultMarkdownGraphResponse {
    const paths = Object.keys(BROWSER_MOCK_MARKDOWN_CONTENTS);
    const nodes: VaultMarkdownGraphNode[] = paths.map((path) => ({
        path,
        title: path.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? path,
    }));

    const nodePathSet = new Set(paths);
    const edgeWeightByKey = new Map<string, number>();

    for (const sourcePath of paths) {
        const content = BROWSER_MOCK_MARKDOWN_CONTENTS[sourcePath] ?? "";

        const wikiMatches = Array.from(content.matchAll(/\[\[([^\]]+)\]\]/g));
        for (const match of wikiMatches) {
            const raw = (match[1] ?? "").trim();
            const normalized = normalizeWikiTarget(raw);
            if (!normalized) {
                continue;
            }

            const targetPath = normalized.endsWith(".md") || normalized.endsWith(".markdown")
                ? normalized
                : `${normalized}.md`;
            if (!nodePathSet.has(targetPath) || targetPath === sourcePath) {
                continue;
            }

            const key = `${sourcePath}=>${targetPath}`;
            const previous = edgeWeightByKey.get(key) ?? 0;
            edgeWeightByKey.set(key, previous + 1);
        }

        const markdownMatches = Array.from(content.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g));
        for (const match of markdownMatches) {
            const raw = (match[1] ?? "").split(/\s+/)[0] ?? "";
            const normalized = normalizeMarkdownLinkTarget(raw);
            if (!normalized) {
                continue;
            }

            const targetPath = normalized.endsWith(".md") || normalized.endsWith(".markdown")
                ? normalized
                : `${normalized}.md`;
            if (!nodePathSet.has(targetPath) || targetPath === sourcePath) {
                continue;
            }

            const key = `${sourcePath}=>${targetPath}`;
            const previous = edgeWeightByKey.get(key) ?? 0;
            edgeWeightByKey.set(key, previous + 1);
        }
    }

    const edges: VaultMarkdownGraphEdge[] = Array.from(edgeWeightByKey.entries()).map(([key, weight]) => {
        const [sourcePath, targetPath] = key.split("=>") as [string, string];
        return {
            sourcePath,
            targetPath,
            weight,
        };
    });

    return {
        nodes,
        edges,
    };
}

/**
 * @function scoreBrowserFallbackQuickSwitch
 * @description 浏览器回退模式下计算单条路径的快速切换匹配分值。
 * @param relativePath 待匹配路径。
 * @param query 用户输入关键字。
 * @returns 匹配分值；未命中返回 null。
 */
function scoreBrowserFallbackQuickSwitch(relativePath: string, query: string): number | null {
    const normalizedPath = normalizeSlashPath(relativePath).toLowerCase();
    const fileName = normalizedPath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? normalizedPath;
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
        return 0;
    }

    let score = 0;
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
        if (fileName === token) {
            score += 120;
            continue;
        }

        if (fileName.startsWith(token)) {
            score += 90;
            continue;
        }

        if (fileName.includes(token)) {
            score += 70;
            continue;
        }

        if (normalizedPath.includes(token)) {
            score += 50;
            continue;
        }

        return null;
    }

    return score;
}

/**
 * @function isTauriRuntime
 * @description 判断当前是否在 Tauri runtime 中。
 * @returns 在 Tauri 中返回 true。
 */
function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };

    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

/**
 * @function setCurrentVault
 * @description 指定 vault 目录并设为当前仓库。
 * @param vaultPath 目标 vault 目录绝对路径。
 * @returns 后端返回的生效路径。
 */
export async function setCurrentVault(vaultPath: string): Promise<{ vaultPath: string }> {
    if (!isTauriRuntime()) {
        browserFallbackVaultPath = vaultPath;
        return { vaultPath };
    }

    return invoke<{ vaultPath: string }>("set_current_vault", {
        vaultPath,
    });
}

/**
 * @function getCurrentVaultTree
 * @description 获取当前仓库目录树。
 * @returns 扁平目录树。
 */
export async function getCurrentVaultTree(): Promise<VaultTreeResponse> {
    if (!isTauriRuntime()) {
        return {
            vaultPath: browserFallbackVaultPath,
            entries: buildBrowserFallbackTreeEntries(),
        };
    }

    return invoke<VaultTreeResponse>("get_current_vault_tree");
}

/**
 * @function readVaultMarkdownFile
 * @description 以相对路径读取仓库中的 Markdown 文件。
 * @param relativePath 文件相对路径。
 * @returns 文件内容。
 */
export async function readVaultMarkdownFile(relativePath: string): Promise<ReadMarkdownResponse> {
    if (!isTauriRuntime()) {
        const mockContent =
            BROWSER_MOCK_MARKDOWN_CONTENTS[relativePath] ??
            `# ${relativePath.split("/").pop() ?? relativePath}\n\n浏览器回退模式下的示例内容。`;

        return {
            relativePath,
            content: mockContent,
        };
    }

    return invoke<ReadMarkdownResponse>("read_vault_markdown_file", {
        relativePath,
    });
}

/**
 * @function readVaultBinaryFile
 * @description 以相对路径读取仓库中的二进制文件（Base64 返回）。
 * @param relativePath 文件相对路径。
 * @returns 二进制内容与 MIME 类型。
 */
export async function readVaultBinaryFile(relativePath: string): Promise<ReadBinaryFileResponse> {
    if (!isTauriRuntime()) {
        throw new Error("浏览器回退模式不支持读取本地二进制文件");
    }

    return invoke<ReadBinaryFileResponse>("read_vault_binary_file", {
        relativePath,
    });
}

/**
 * @function resolveWikiLinkTarget
 * @description 解析 WikiLink 目标路径，返回当前 vault 内最佳命中文件。
 * @param currentDir 当前文档目录（相对于 vault，或 vault 内绝对路径）。
 * @param target WikiLink 目标文本。
 * @returns 命中文件路径，未命中返回 null。
 */
export async function resolveWikiLinkTarget(
    currentDir: string,
    target: string,
): Promise<ResolveWikiLinkTargetResponse | null> {
    if (!isTauriRuntime()) {
        const normalizedTarget = normalizeSlashPath(target.trim());
        if (!normalizedTarget) {
            return null;
        }

        const allMockPaths = Object.keys(BROWSER_MOCK_MARKDOWN_CONTENTS);
        const stem = normalizedTarget
            .split("/")
            .pop()
            ?.replace(/\.(md|markdown)$/i, "")
            .trim();
        const byExactPath = allMockPaths.find((path) => {
            if (normalizeSlashPath(path) === normalizedTarget) {
                return true;
            }
            if (!/\.(md|markdown)$/i.test(normalizedTarget)) {
                return normalizeSlashPath(path) === `${normalizedTarget}.md`;
            }
            return false;
        });

        if (byExactPath) {
            return {
                relativePath: byExactPath,
                absolutePath: `${browserFallbackVaultPath}/${byExactPath}`,
            };
        }

        if (!stem) {
            return null;
        }

        const byStem = allMockPaths.find((path) => {
            const fileName = normalizeSlashPath(path).split("/").pop() ?? "";
            return fileName.replace(/\.(md|markdown)$/i, "") === stem;
        });

        if (!byStem) {
            return null;
        }

        return {
            relativePath: byStem,
            absolutePath: `${browserFallbackVaultPath}/${byStem}`,
        };
    }

    return invoke<ResolveWikiLinkTargetResponse | null>("resolve_wikilink_target", {
        currentDir,
        target,
    });
}

/**
 * @function resolveMediaEmbedTarget
 * @description 解析图片嵌入目标路径，返回当前 vault 内最佳命中文件。
 * @param currentDir 当前文档目录（相对于 vault，或 vault 内绝对路径）。
 * @param target 图片嵌入目标文本（不含 `![[` 与 `]]`）。
 * @returns 命中文件路径，未命中返回 null。
 */
export async function resolveMediaEmbedTarget(
    currentDir: string,
    target: string,
): Promise<ResolveMediaEmbedTargetResponse | null> {
    if (!isTauriRuntime()) {
        return null;
    }

    return invoke<ResolveMediaEmbedTargetResponse | null>("resolve_media_embed_target", {
        currentDir,
        target,
    });
}

/**
 * @function getCurrentVaultMarkdownGraph
 * @description 获取当前 vault 的 Markdown 图谱数据（节点与边）。
 * @returns 图谱结构。
 */
export async function getCurrentVaultMarkdownGraph(): Promise<VaultMarkdownGraphResponse> {
    if (!isTauriRuntime()) {
        console.info("[vault-api] getCurrentVaultMarkdownGraph fallback to browser mock data");
        return buildBrowserMockMarkdownGraph();
    }

    console.info("[vault-api] getCurrentVaultMarkdownGraph invoke start");
    const response = await invoke<VaultMarkdownGraphResponse>("get_current_vault_markdown_graph");
    console.info("[vault-api] getCurrentVaultMarkdownGraph invoke success", {
        nodeCount: response.nodes.length,
        edgeCount: response.edges.length,
    });
    return response;
}

/**
 * @function searchVaultMarkdownFiles
 * @description 按关键字检索当前 vault 中的 Markdown 文件，用于快速切换浮窗。
 * @param query 搜索关键字。
 * @param limit 最大返回条数。
 * @returns 匹配结果列表。
 */
export async function searchVaultMarkdownFiles(
    query: string,
    limit = 80,
): Promise<VaultQuickSwitchItem[]> {
    const normalizedLimit = Math.max(1, Math.min(200, Number.isFinite(limit) ? Math.floor(limit) : 80));

    if (!isTauriRuntime()) {
        const fallbackItems = Object.keys(BROWSER_MOCK_MARKDOWN_CONTENTS)
            .map((relativePath) => {
                const score = scoreBrowserFallbackQuickSwitch(relativePath, query);
                if (score === null) {
                    return null;
                }

                return {
                    relativePath,
                    title: relativePath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? relativePath,
                    score,
                };
            })
            .filter((item): item is VaultQuickSwitchItem => item !== null)
            .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
            .slice(0, normalizedLimit);

        return fallbackItems;
    }

    console.info("[vault-api] searchVaultMarkdownFiles invoke start", {
        query,
        limit: normalizedLimit,
    });

    const response = await invoke<VaultQuickSwitchItem[]>("search_vault_markdown_files", {
        query,
        limit: normalizedLimit,
    });

    console.info("[vault-api] searchVaultMarkdownFiles invoke success", {
        query,
        resultCount: response.length,
    });

    return response;
}

/**
 * @function createVaultMarkdownFile
 * @description 在当前仓库创建 Markdown 文件。
 * @param relativePath 目标文件相对路径。
 * @param content 可选初始内容。
 * @returns 创建结果。
 */
export async function createVaultMarkdownFile(
    relativePath: string,
    content?: string,
): Promise<WriteMarkdownResponse> {
    if (!isTauriRuntime()) {
        return {
            relativePath,
            created: true,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<WriteMarkdownResponse>("create_vault_markdown_file", {
        relativePath,
        content: content ?? null,
        sourceTraceId,
    });
}

/**
 * @function createVaultDirectory
 * @description 在当前仓库创建目录。
 * @param relativeDirectoryPath 目标目录相对路径。
 */
export async function createVaultDirectory(relativeDirectoryPath: string): Promise<void> {
    const normalizedPath = normalizeSlashPath(relativeDirectoryPath).trim().replace(/^\/+|\/+$/g, "");
    if (!normalizedPath) {
        return;
    }

    if (!isTauriRuntime()) {
        return;
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    await invoke<void>("create_vault_directory", {
        relativeDirectoryPath: normalizedPath,
        sourceTraceId,
    });
}

/**
 * @function createVaultBinaryFile
 * @description 在当前仓库创建二进制文件（通常为图片）。
 * @param relativePath 目标文件相对路径（如 Images/pasted-20260224.png）。
 * @param base64Content Base64 编码后的文件内容。
 * @returns 创建结果。
 */
export async function createVaultBinaryFile(
    relativePath: string,
    base64Content: string,
): Promise<WriteBinaryFileResponse> {
    if (!isTauriRuntime()) {
        return {
            relativePath,
            created: true,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    console.info("[vault-api] createVaultBinaryFile", {
        relativePath,
        base64Length: base64Content.length,
    });

    return invoke<WriteBinaryFileResponse>("create_vault_binary_file", {
        relativePath,
        base64Content,
        sourceTraceId,
    });
}

/**
 * @function saveVaultMarkdownFile
 * @description 保存当前仓库中的 Markdown 文件。
 * @param relativePath 目标文件相对路径。
 * @param content 文件内容。
 * @returns 保存结果。
 */
export async function saveVaultMarkdownFile(
    relativePath: string,
    content: string,
): Promise<WriteMarkdownResponse> {
    if (!isTauriRuntime()) {
        return {
            relativePath,
            created: false,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<WriteMarkdownResponse>("save_vault_markdown_file", {
        relativePath,
        content,
        sourceTraceId,
    });
}

/**
 * @function renameVaultMarkdownFile
 * @description 重命名当前仓库中的 Markdown 文件。
 * @param fromRelativePath 原文件相对路径。
 * @param toRelativePath 目标文件相对路径。
 * @returns 重命名结果。
 */
export async function renameVaultMarkdownFile(
    fromRelativePath: string,
    toRelativePath: string,
): Promise<WriteMarkdownResponse> {
    if (!isTauriRuntime()) {
        return {
            relativePath: toRelativePath,
            created: false,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<WriteMarkdownResponse>("rename_vault_markdown_file", {
        fromRelativePath,
        toRelativePath,
        sourceTraceId,
    });
}

/**
 * @function moveVaultMarkdownFileToDirectory
 * @description 将 Markdown 文件移动到指定目录（文件名保持不变）。
 * @param fromRelativePath 源文件相对路径。
 * @param targetDirectoryRelativePath 目标目录相对路径；空字符串表示仓库根目录。
 * @returns 移动结果。
 */
export async function moveVaultMarkdownFileToDirectory(
    fromRelativePath: string,
    targetDirectoryRelativePath: string,
): Promise<WriteMarkdownResponse> {
    const normalizedFromPath = normalizeSlashPath(fromRelativePath).trim();
    const normalizedTargetDirectory = normalizeSlashPath(targetDirectoryRelativePath).trim().replace(/^\/+|\/+$/g, "");
    const sourceFileName = normalizedFromPath.split("/").pop() ?? "";

    if (!sourceFileName) {
        throw new Error("源文件路径无效");
    }

    const targetRelativePath = normalizedTargetDirectory
        ? `${normalizedTargetDirectory}/${sourceFileName}`
        : sourceFileName;

    if (!isTauriRuntime()) {
        const sourceContent = BROWSER_MOCK_MARKDOWN_CONTENTS[normalizedFromPath];
        if (typeof sourceContent !== "string") {
            throw new Error("源文件不存在");
        }

        const existedTarget = BROWSER_MOCK_MARKDOWN_CONTENTS[targetRelativePath];
        if (typeof existedTarget === "string" && targetRelativePath !== normalizedFromPath) {
            throw new Error("目标文件已存在");
        }

        if (targetRelativePath !== normalizedFromPath) {
            delete BROWSER_MOCK_MARKDOWN_CONTENTS[normalizedFromPath];
            BROWSER_MOCK_MARKDOWN_CONTENTS[targetRelativePath] = sourceContent;
        }

        return {
            relativePath: targetRelativePath,
            created: false,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<WriteMarkdownResponse>("move_vault_markdown_file_to_directory", {
        fromRelativePath: normalizedFromPath,
        targetDirectoryRelativePath: normalizedTargetDirectory,
        sourceTraceId,
    });
}

/**
 * @function renameVaultDirectory
 * @description 重命名当前仓库中的目录。
 * @param fromRelativePath 原目录相对路径。
 * @param toRelativePath 目标目录相对路径。
 * @returns 重命名结果。
 */
export async function renameVaultDirectory(
    fromRelativePath: string,
    toRelativePath: string,
): Promise<WriteMarkdownResponse> {
    if (!isTauriRuntime()) {
        return {
            relativePath: toRelativePath,
            created: false,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<WriteMarkdownResponse>("rename_vault_directory", {
        fromRelativePath,
        toRelativePath,
        sourceTraceId,
    });
}

/**
 * @function moveVaultDirectoryToDirectory
 * @description 将目录移动到指定目录（保留目录名）。
 * @param fromRelativePath 源目录相对路径。
 * @param targetDirectoryRelativePath 目标目录相对路径。
 * @returns 移动结果。
 */
export async function moveVaultDirectoryToDirectory(
    fromRelativePath: string,
    targetDirectoryRelativePath: string,
): Promise<WriteMarkdownResponse> {
    const normalizedFromPath = normalizeSlashPath(fromRelativePath).trim();
    const normalizedTargetDirectory = normalizeSlashPath(targetDirectoryRelativePath)
        .trim()
        .replace(/^\/+|\/+$/g, "");

    if (!isTauriRuntime()) {
        return {
            relativePath: normalizedFromPath,
            created: false,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<WriteMarkdownResponse>("move_vault_directory_to_directory", {
        fromRelativePath: normalizedFromPath,
        targetDirectoryRelativePath: normalizedTargetDirectory,
        sourceTraceId,
    });
}

/**
 * @function deleteVaultDirectory
 * @description 删除当前仓库中的目录（递归）。
 * @param relativePath 目标目录相对路径。
 */
export async function deleteVaultDirectory(relativePath: string): Promise<void> {
    const normalizedPath = normalizeSlashPath(relativePath).trim().replace(/^\/+|\/+$/g, "");
    if (!normalizedPath) {
        throw new Error("目录路径不能为空");
    }

    if (!isTauriRuntime()) {
        return;
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    await invoke<void>("delete_vault_directory", {
        relativePath: normalizedPath,
        sourceTraceId,
    });
}

/**
 * @function deleteVaultMarkdownFile
 * @description 删除当前仓库中的 Markdown 文件。
 * @param relativePath 目标文件相对路径。
 */
export async function deleteVaultMarkdownFile(relativePath: string): Promise<void> {
    if (!isTauriRuntime()) {
        return;
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    await invoke<void>("delete_vault_markdown_file", {
        relativePath,
        sourceTraceId,
    });
}

/**
 * @interface CopyEntryResponse
 * @description 文件/目录复制操作的后端响应结构。
 */
export interface CopyEntryResponse {
    /** 复制后新条目的相对路径 */
    relativePath: string;
    /** 原条目的相对路径 */
    sourceRelativePath: string;
}

/**
 * @function copyVaultEntry
 * @description 在当前仓库中复制文件或目录到目标目录。
 *   当目标目录下已存在同名条目时，后端自动添加 "(copy N)" 后缀。
 * @param sourceRelativePath 源文件/目录的相对路径。
 * @param targetDirectoryRelativePath 目标目录的相对路径（空字符串表示 vault 根）。
 * @returns 复制结果，含新路径和原路径。
 * @throws 源不存在、目标无效时抛出错误。
 */
export async function copyVaultEntry(
    sourceRelativePath: string,
    targetDirectoryRelativePath: string,
): Promise<CopyEntryResponse> {
    if (!isTauriRuntime()) {
        console.warn("[vault-api] copyVaultEntry skipped: not tauri runtime");
        return {
            relativePath: sourceRelativePath,
            sourceRelativePath,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    console.info("[vault-api] copyVaultEntry", {
        sourceRelativePath,
        targetDirectoryRelativePath,
        sourceTraceId,
    });

    return invoke<CopyEntryResponse>("copy_vault_entry", {
        sourceRelativePath,
        targetDirectoryRelativePath,
        sourceTraceId,
    });
}

/**
 * @function segmentChineseText
 * @description 调用后端中文分词能力，对文本切分并返回 token 边界。
 * @param text 待分词文本。
 * @returns 分词 token 数组。
 */
export async function segmentChineseText(text: string): Promise<ChineseSegmentToken[]> {
    if (!isTauriRuntime()) {
        type SegmenterLike = {
            segment: (input: string) => Iterable<{ segment: string; index: number }>;
        };

        const intlWithSegmenter = Intl as unknown as {
            Segmenter?: new (
                locales?: string | string[],
                options?: { granularity?: "grapheme" | "word" | "sentence" },
            ) => SegmenterLike;
        };

        if (typeof intlWithSegmenter.Segmenter === "function") {
            const segmenter = new intlWithSegmenter.Segmenter("zh-CN", {
                granularity: "word",
            });

            const tokens = Array.from(segmenter.segment(text))
                .filter((segment: { segment: string; index: number }) => segment.segment.trim().length > 0)
                .map((segment) => ({
                    word: segment.segment,
                    start: segment.index,
                    end: segment.index + segment.segment.length,
                }));

            if (tokens.length > 0) {
                return tokens;
            }
        }

        const chars = Array.from(text);
        let cursor = 0;
        return chars
            .filter((char) => char.trim().length > 0)
            .map((char) => {
                const start = text.indexOf(char, cursor);
                const safeStart = start >= 0 ? start : cursor;
                const end = safeStart + char.length;
                cursor = end;
                return {
                    word: char,
                    start: safeStart,
                    end,
                };
            });
    }

    return invoke<ChineseSegmentToken[]>("segment_chinese_text", {
        text,
    });
}

/**
 * @function subscribeVaultFsEvents
 * @description 订阅后端仓库文件系统事件。
 * @param handler 事件处理函数。
 * @returns 取消订阅函数。
 */
export async function subscribeVaultFsEvents(
    handler: (payload: VaultFsEventPayload) => void,
): Promise<UnlistenFn> {
    if (!isTauriRuntime()) {
        return () => {
            // 浏览器回退模式下无后端事件，返回空取消函数。
        };
    }

    return listen<VaultFsEventPayload>(VAULT_FS_EVENT_NAME, (event) => {
        handler(event.payload);
    });
}

/**
 * @function getCurrentVaultConfig
 * @description 获取当前仓库配置。
 * @returns 仓库配置对象。
 */
export async function getCurrentVaultConfig(): Promise<VaultConfig> {
    if (!isTauriRuntime()) {
        return {
            schemaVersion: 1,
            entries: {},
        };
    }

    return invoke<VaultConfig>("get_current_vault_config");
}

/**
 * @function saveCurrentVaultConfig
 * @description 保存当前仓库配置。
 * @param config 待保存配置对象。
 * @returns 后端回写配置。
 */
export async function saveCurrentVaultConfig(config: VaultConfig): Promise<VaultConfig> {
    if (!isTauriRuntime()) {
        return config;
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<VaultConfig>("save_current_vault_config", {
        config,
        sourceTraceId,
    });
}

/**
 * @function subscribeVaultConfigEvents
 * @description 订阅后端仓库配置文件变更事件。
 * @param handler 事件处理函数。
 * @returns 取消订阅函数。
 */
export async function subscribeVaultConfigEvents(
    handler: (payload: VaultConfigEventPayload) => void,
): Promise<UnlistenFn> {
    if (!isTauriRuntime()) {
        return () => {
            // 浏览器回退模式下无后端事件，返回空取消函数。
        };
    }

    return listen<VaultConfigEventPayload>(VAULT_CONFIG_EVENT_NAME, (event) => {
        handler(event.payload);
    });
}
