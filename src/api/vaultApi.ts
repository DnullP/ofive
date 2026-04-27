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
import YAML from "yaml";
import i18n from "../i18n";
import { detectExcludedLineRanges, isLineExcluded } from "../utils/markdownBlockDetector";
import { scorePinyinMatch } from "../utils/pinyinMatch";
import { parseTaskBoardLine } from "../utils/taskSyntax";
import { loadBrowserMockMarkdownContents } from "./vaultBrowserMockFixtures";

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
 * @interface ReadCanvasFileResponse
 * @description 读取 Canvas 接口响应。
 */
export interface ReadCanvasFileResponse {
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
 * @interface WriteCanvasFileResponse
 * @description Canvas 文件写入接口响应。
 */
export interface WriteCanvasFileResponse {
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
 * @interface BrowserMockRuntimeWindow
 * @description 浏览器 mock 运行时测试注入窗口扩展。
 */
interface BrowserMockRuntimeWindow extends Window {
    /** 图谱性能测试注入的 mock 图谱响应。 */
    __OFIVE_BROWSER_MOCK_GRAPH_RESPONSE__?: VaultMarkdownGraphResponse;
}

/**
 * @interface FrontmatterQueryMatchItem
 * @description frontmatter 查询命中项。
 */
export interface FrontmatterQueryMatchItem {
    /** 命中文件相对路径 */
    relativePath: string;
    /** 展示标题 */
    title: string;
    /** 命中的字段名 */
    matchedFieldName: string;
    /** 命中的字段值列表 */
    matchedFieldValues: string[];
    /** 解析后的 frontmatter 对象 */
    frontmatter: Record<string, unknown>;
}

/**
 * @interface FrontmatterQueryResponse
 * @description frontmatter 查询响应。
 */
export interface FrontmatterQueryResponse {
    /** 查询字段名 */
    fieldName: string;
    /** 命中项列表 */
    matches: FrontmatterQueryMatchItem[];
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
 * @type VaultSearchScope
 * @description 搜索范围类型。
 */
export type VaultSearchScope = "all" | "content" | "fileName";

/**
 * @interface VaultSearchMatchItem
 * @description Markdown 搜索命中项。
 */
export interface VaultSearchMatchItem {
    /** 命中文件相对路径 */
    relativePath: string;
    /** 展示标题 */
    title: string;
    /** 综合评分 */
    score: number;
    /** 内容摘要 */
    snippet?: string;
    /** 摘要所在行号 */
    snippetLine?: number;
    /** 当前文件提取出的标签 */
    tags: string[];
    /** 是否命中文件名 */
    matchedFileName: boolean;
    /** 是否命中正文 */
    matchedContent: boolean;
    /** 是否命中标签过滤器 */
    matchedTag: boolean;
}

/**
 * @function normalizeVaultSearchMatchItem
 * @description 将后端或回退模式返回的搜索命中项归一化为稳定前端结构。
 * @param item 原始搜索命中项。
 * @returns 归一化后的搜索命中项。
 */
function normalizeVaultSearchMatchItem(item: Partial<VaultSearchMatchItem> & {
    relativePath: string;
    title: string;
    score: number;
}): VaultSearchMatchItem {
    return {
        relativePath: item.relativePath,
        title: item.title,
        score: item.score,
        tags: Array.isArray(item.tags) ? item.tags : [],
        matchedFileName: Boolean(item.matchedFileName),
        matchedContent: Boolean(item.matchedContent),
        matchedTag: Boolean(item.matchedTag),
        ...(item.snippet ? { snippet: item.snippet } : {}),
        ...(typeof item.snippetLine === "number" ? { snippetLine: item.snippetLine } : {}),
    };
}

/**
 * @interface WikiLinkSuggestionItem
 * @description WikiLink 自动补全建议条目。
 */
export interface WikiLinkSuggestionItem {
    /** 文件相对路径 */
    relativePath: string;
    /** 展示标题（文件名，不含扩展名） */
    title: string;
    /** 综合评分（越高越相关） */
    score: number;
    /** 被引用次数（入链权重和） */
    referenceCount: number;
}

/**
 * @interface BacklinkItem
 * @description 反向链接条目。
 */
export interface BacklinkItem {
    /** 引用源文件相对路径 */
    sourcePath: string;
    /** 引用源文件标题 */
    title: string;
    /** 引用权重（次数） */
    weight: number;
}

/**
 * @interface OutlineHeading
 * @description Markdown 大纲标题条目。
 */
export interface OutlineHeading {
    /** 标题级别（1–6） */
    level: number;
    /** 标题纯文本 */
    text: string;
    /** 所在行号（1-based） */
    line: number;
}

/**
 * @interface OutlineResponse
 * @description Markdown 大纲接口响应。
 */
export interface OutlineResponse {
    /** 文件相对路径 */
    relativePath: string;
    /** 标题列表 */
    headings: OutlineHeading[];
}

/**
 * @interface VaultTaskItem
 * @description 任务看板查询返回的单条任务结构。
 */
export interface VaultTaskItem {
    /** 任务所在文件相对路径 */
    relativePath: string;
    /** 文件标题 */
    title: string;
    /** 任务所在行号（1-based） */
    line: number;
    /** 原始任务行文本 */
    rawLine: string;
    /** 是否已完成 */
    checked: boolean;
    /** 去除元数据后的任务内容 */
    content: string;
    /** 截止时间元数据 */
    due?: string | null;
    /** 优先级元数据 */
    priority?: string | null;
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
const BROWSER_FALLBACK_VAULT_CONFIG_STORAGE_KEY_PREFIX = "ofive:browser-fallback:vault-config:";
let browserMockMarkdownContentsPromise: Promise<Record<string, string>> | null = null;

function getBrowserFallbackConfigReadDelayMs(): number {
    if (typeof window === "undefined") {
        return 0;
    }

    const raw = new URLSearchParams(window.location.search).get("mockConfigReadDelayMs");
    const delayMs = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

/**
 * @function getBrowserMockMarkdownContents
 * @description 按需加载浏览器 mock Markdown 内容，避免在非浏览器运行时导入 Vite 专属原始资源。
 * @returns Markdown 相对路径到内容的映射。
 */
async function getBrowserMockMarkdownContents(): Promise<Record<string, string>> {
    if (!browserMockMarkdownContentsPromise) {
        browserMockMarkdownContentsPromise = loadBrowserMockMarkdownContents();
    }

    return browserMockMarkdownContentsPromise;
}

function getBrowserFallbackVaultConfigStorageKey(vaultPath: string): string {
    return `${BROWSER_FALLBACK_VAULT_CONFIG_STORAGE_KEY_PREFIX}${vaultPath}`;
}

function readBrowserFallbackVaultConfig(): VaultConfig {
    if (typeof window === "undefined" || !browserFallbackVaultPath) {
        return {
            schemaVersion: 1,
            entries: {},
        };
    }

    try {
        const raw = window.localStorage.getItem(
            getBrowserFallbackVaultConfigStorageKey(browserFallbackVaultPath),
        );
        if (!raw) {
            return {
                schemaVersion: 1,
                entries: {},
            };
        }

        const parsed = JSON.parse(raw) as VaultConfig;
        if (
            typeof parsed !== "object"
            || parsed === null
            || typeof parsed.schemaVersion !== "number"
            || typeof parsed.entries !== "object"
            || parsed.entries === null
            || Array.isArray(parsed.entries)
        ) {
            return {
                schemaVersion: 1,
                entries: {},
            };
        }

        return parsed;
    } catch (error) {
        console.warn("[vaultApi] failed to read browser fallback config", {
            vaultPath: browserFallbackVaultPath,
            error,
        });
        return {
            schemaVersion: 1,
            entries: {},
        };
    }
}

function writeBrowserFallbackVaultConfig(config: VaultConfig): VaultConfig {
    if (typeof window === "undefined" || !browserFallbackVaultPath) {
        return config;
    }

    try {
        window.localStorage.setItem(
            getBrowserFallbackVaultConfigStorageKey(browserFallbackVaultPath),
            JSON.stringify(config),
        );
    } catch (error) {
        console.warn("[vaultApi] failed to persist browser fallback config", {
            vaultPath: browserFallbackVaultPath,
            error,
        });
    }

    return config;
}

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
 * @function buildBrowserFallbackTreeEntries
 * @description 基于浏览器回退 mock Markdown 路径集合构建文件树条目。
 * @param markdownContents 浏览器 mock Markdown 内容映射。
 * @returns 浏览器回退目录树条目。
 */
function buildBrowserFallbackTreeEntries(markdownContents: Record<string, string>): VaultEntry[] {
    const markdownPaths = Object.keys(markdownContents)
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
 * @function extractBrowserFallbackFrontmatterText
 * @description 从浏览器回退模式的 Markdown 内容中提取文档开头的 frontmatter YAML 文本。
 * @param content Markdown 原文。
 * @returns frontmatter YAML 文本；不存在时返回 null。
 */
function extractBrowserFallbackFrontmatterText(content: string): string | null {
    const lines = content.split("\n");
    if ((lines[0] ?? "").trimEnd() !== "---") {
        return null;
    }

    for (let index = 1; index < lines.length; index += 1) {
        if ((lines[index] ?? "").trimEnd() === "---") {
            return lines.slice(1, index).join("\n");
        }
    }

    return null;
}

/**
 * @function toBrowserFallbackFrontmatterMatchValues
 * @description 将浏览器回退模式下的 frontmatter 字段值规范化为字符串数组。
 * @param value frontmatter 字段值。
 * @returns 规范化后的字符串数组。
 */
function toBrowserFallbackFrontmatterMatchValues(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.flatMap((item) => toBrowserFallbackFrontmatterMatchValues(item));
    }

    if (value instanceof Date) {
        return [value.toISOString().slice(0, 10)];
    }

    if (value === null) {
        return ["null"];
    }

    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized ? [normalized] : [];
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return [String(value)];
    }

    return [];
}

/**
 * @function buildBrowserFallbackFrontmatterQuery
 * @description 在浏览器回退模式下查询具有指定 frontmatter 字段的 Markdown 笔记。
 * @param markdownContents 浏览器 mock Markdown 内容映射。
 * @param fieldName 查询字段名。
 * @param fieldValue 可选字段值过滤。
 * @returns 查询响应。
 */
function buildBrowserFallbackFrontmatterQuery(
    markdownContents: Record<string, string>,
    fieldName: string,
    fieldValue?: string,
): FrontmatterQueryResponse {
    const normalizedFieldName = fieldName.trim();
    const normalizedFieldValue = fieldValue?.trim();
    const matches: FrontmatterQueryMatchItem[] = [];

    Object.entries(markdownContents).forEach(([relativePath, content]) => {
        const frontmatterText = extractBrowserFallbackFrontmatterText(content);
        if (!frontmatterText) {
            return;
        }

        try {
            const parsed = YAML.parse(frontmatterText);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return;
            }

            const frontmatterRecord = parsed as Record<string, unknown>;
            const matchedValue = frontmatterRecord[normalizedFieldName];
            if (matchedValue === undefined) {
                return;
            }

            const matchedFieldValues = toBrowserFallbackFrontmatterMatchValues(matchedValue);
            if (matchedFieldValues.length === 0) {
                console.warn("[vault-api] browser fallback frontmatter field resolved empty", {
                    relativePath,
                    fieldName: normalizedFieldName,
                });
                return;
            }

            if (normalizedFieldValue && !matchedFieldValues.includes(normalizedFieldValue)) {
                return;
            }

            const titleFromFrontmatter =
                typeof frontmatterRecord.title === "string" && frontmatterRecord.title.trim()
                    ? frontmatterRecord.title.trim()
                    : null;

            matches.push({
                relativePath,
                title:
                    titleFromFrontmatter ??
                    relativePath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ??
                    relativePath,
                matchedFieldName: normalizedFieldName,
                matchedFieldValues,
                frontmatter: frontmatterRecord,
            });
        } catch (error) {
            console.warn("[vault-api] browser fallback frontmatter parse failed", {
                relativePath,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    });

    return {
        fieldName: normalizedFieldName,
        matches,
    };
}

/**
 * @function buildBrowserMockMarkdownGraph
 * @description 浏览器回退模式下从 mock Markdown 文本构造图谱结构。
 * @param markdownContents 浏览器 mock Markdown 内容映射。
 * @returns mock 图谱结构。
 */
function buildBrowserMockMarkdownGraph(markdownContents: Record<string, string>): VaultMarkdownGraphResponse {
    const paths = Object.keys(markdownContents);
    const nodes: VaultMarkdownGraphNode[] = paths.map((path) => ({
        path,
        title: path.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? path,
    }));

    const nodePathSet = new Set(paths);
    const edgeWeightByKey = new Map<string, number>();

    for (const sourcePath of paths) {
        const content = markdownContents[sourcePath] ?? "";

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
 * @function getBrowserMockMarkdownGraphOverride
 * @description 读取浏览器 mock 运行时注入的图谱覆盖数据。
 * @returns 覆盖图谱；未注入时返回 null。
 */
function getBrowserMockMarkdownGraphOverride(): VaultMarkdownGraphResponse | null {
    if (typeof window === "undefined") {
        return null;
    }

    const runtimeWindow = window as BrowserMockRuntimeWindow;
    const response = runtimeWindow.__OFIVE_BROWSER_MOCK_GRAPH_RESPONSE__;
    if (!response) {
        return null;
    }

    if (!Array.isArray(response.nodes) || !Array.isArray(response.edges)) {
        console.warn("[vault-api] browser mock graph override ignored: invalid shape");
        return null;
    }

    return response;
}

/**
 * @function extractBrowserFallbackOutline
 * @description 从浏览器回退模式的 Markdown 内容中提取标题列表。
 *   语义与后端 outline 接口保持一致：跳过 frontmatter、代码块、LaTeX 块中的伪标题。
 * @param markdownContents 浏览器 mock Markdown 内容映射。
 * @param relativePath 目标文件相对路径。
 * @returns 大纲响应。
 */
function extractBrowserFallbackOutline(
    markdownContents: Record<string, string>,
    relativePath: string,
): OutlineResponse {
    const content = markdownContents[relativePath] ?? "";
    const lines = content.split("\n");
    const excludedRanges = detectExcludedLineRanges(content);
    const headings: OutlineHeading[] = [];

    lines.forEach((line, index) => {
        const lineNumber = index + 1;
        if (isLineExcluded(lineNumber, excludedRanges)) {
            return;
        }

        const matched = line.match(/^(#{1,6})\s+(.+)$/);
        if (!matched) {
            return;
        }

        const hashes = matched[1] ?? "#";
        const headingText = (matched[2] ?? "").trim();
        if (!headingText) {
            return;
        }

        headings.push({
            level: Math.min(6, Math.max(1, hashes.length)),
            text: headingText,
            line: lineNumber,
        });
    });

    return {
        relativePath,
        headings,
    };
}

/**
 * @function buildBrowserFallbackBacklinks
 * @description 在浏览器回退模式下，根据 mock Markdown 文本构建指定文件的反向链接列表。
 * @param markdownContents 浏览器 mock Markdown 内容映射。
 * @param relativePath 目标文件相对路径。
 * @returns 反向链接列表。
 */
function buildBrowserFallbackBacklinks(
    markdownContents: Record<string, string>,
    relativePath: string,
): BacklinkItem[] {
    const normalizedTargetPath = normalizeSlashPath(relativePath);
    const results: BacklinkItem[] = [];

    for (const [sourcePath, content] of Object.entries(markdownContents)) {
        if (normalizeSlashPath(sourcePath) === normalizedTargetPath) {
            continue;
        }

        let weight = 0;

        const wikiMatches = Array.from(content.matchAll(/\[\[([^\]]+)\]\]/g));
        for (const match of wikiMatches) {
            const normalized = normalizeWikiTarget((match[1] ?? "").trim());
            if (!normalized) {
                continue;
            }

            const targetPath = normalized.endsWith(".md") || normalized.endsWith(".markdown")
                ? normalized
                : `${normalized}.md`;
            if (targetPath === normalizedTargetPath) {
                weight += 1;
            }
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
            if (targetPath === normalizedTargetPath) {
                weight += 1;
            }
        }

        if (weight <= 0) {
            continue;
        }

        results.push({
            sourcePath,
            title: sourcePath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? sourcePath,
            weight,
        });
    }

    return results.sort(
        (left, right) => right.weight - left.weight || left.sourcePath.localeCompare(right.sourcePath),
    );
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

        const pinyinScore = scorePinyinMatch(fileName, token);
        if (pinyinScore !== null) {
            score += pinyinScore;
            continue;
        }

        return null;
    }

    return score;
}

/**
 * @function buildBrowserFallbackTaskItems
 * @description 浏览器 mock 环境下，从内置 Markdown 内容提取任务条目。
 * @param markdownContents 浏览器 mock Markdown 内容映射。
 * @returns mock 任务列表。
 */
function buildBrowserFallbackTaskItems(markdownContents: Record<string, string>): VaultTaskItem[] {
    const items: VaultTaskItem[] = [];

    Object.entries(markdownContents).forEach(([relativePath, content]) => {
        const excludedRanges = detectExcludedLineRanges(content);
        const lines = content.split(/\r?\n/);
        const title = relativePath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? relativePath;

        lines.forEach((line, index) => {
            const lineNumber = index + 1;
            if (isLineExcluded(lineNumber, excludedRanges)) {
                return;
            }

            const parsed = parseTaskBoardLine(line);
            if (!parsed) {
                return;
            }

            items.push({
                relativePath,
                title,
                line: lineNumber,
                rawLine: line,
                checked: parsed.checked,
                content: parsed.content,
                ...(parsed.due ? { due: parsed.due } : {}),
                ...(parsed.priority ? { priority: parsed.priority } : {}),
            });
        });
    });

    return items.sort((left, right) => {
        return left.relativePath.localeCompare(right.relativePath)
            || left.line - right.line;
    });
}

/**
 * @function normalizeBrowserFallbackTag
 * @description 规范化标签输入，统一移除 # 前缀并转为小写。
 * @param raw 原始标签文本。
 * @returns 规范化后的标签；为空时返回 null。
 */
function normalizeBrowserFallbackTag(raw: string): string | null {
    const normalized = raw.trim().replace(/^#+/, "").trim().toLowerCase();
    return normalized ? normalized : null;
}

/**
 * @function extractBrowserFallbackFrontmatterYaml
 * @description 从 Markdown 文本开头提取 frontmatter YAML。
 * @param content Markdown 原文。
 * @returns frontmatter YAML 文本；不存在时返回 null。
 */
function extractBrowserFallbackFrontmatterYaml(content: string): string | null {
    const ranges = detectExcludedLineRanges(content);
    const firstRange = ranges[0];
    if (!firstRange || firstRange.type !== "frontmatter" || firstRange.fromLine !== 1) {
        return null;
    }

    const lines = content.split("\n").slice(firstRange.fromLine - 1, firstRange.toLine);
    if (lines.length < 2) {
        return null;
    }

    return lines.slice(1, -1).join("\n");
}

/**
 * @function collectBrowserFallbackTagsFromYaml
 * @description 从 frontmatter tags 字段提取标签列表。
 * @param value YAML 节点值。
 * @returns 规范化后的标签数组。
 */
function collectBrowserFallbackTagsFromYaml(value: unknown): string[] {
    if (typeof value === "string") {
        const normalized = normalizeBrowserFallbackTag(value);
        return normalized ? [normalized] : [];
    }

    if (Array.isArray(value)) {
        return value.flatMap((item) => collectBrowserFallbackTagsFromYaml(item));
    }

    if (value === null || value === undefined) {
        return [];
    }

    return [];
}

/**
 * @function isBrowserFallbackTagBoundary
 * @description 判断字符是否可作为标签边界。
 * @param value 待判断字符。
 * @returns 是边界时返回 true。
 */
function isBrowserFallbackTagBoundary(value: string | undefined): boolean {
    return !value || !/[\p{L}\p{N}_\-/]/u.test(value);
}

/**
 * @function isBrowserFallbackTagCharacter
 * @description 判断字符是否可以出现在标签内部。
 * @param value 待判断字符。
 * @returns 可作为标签字符时返回 true。
 */
function isBrowserFallbackTagCharacter(value: string): boolean {
    return /[\p{L}\p{N}_\-/]/u.test(value);
}

/**
 * @function extractBrowserFallbackInlineTags
 * @description 从 Markdown 正文提取 inline hashtag，并跳过块级排斥区域。
 * @param content Markdown 原文。
 * @returns 标签数组。
 */
function extractBrowserFallbackInlineTags(content: string): string[] {
    const lines = content.split("\n");
    const excludedRanges = detectExcludedLineRanges(content);
    const tags: string[] = [];

    lines.forEach((line, index) => {
        const lineNumber = index + 1;
        if (isLineExcluded(lineNumber, excludedRanges)) {
            return;
        }

        for (let cursor = 0; cursor < line.length; cursor += 1) {
            if (line[cursor] !== "#") {
                continue;
            }

            const previous = cursor > 0 ? line[cursor - 1] : undefined;
            if (!isBrowserFallbackTagBoundary(previous)) {
                continue;
            }

            let lookahead = cursor + 1;
            let rawTag = "";
            while (lookahead < line.length && isBrowserFallbackTagCharacter(line[lookahead] ?? "")) {
                rawTag += line[lookahead] ?? "";
                lookahead += 1;
            }

            const normalized = normalizeBrowserFallbackTag(rawTag);
            if (normalized) {
                tags.push(normalized);
            }

            cursor = Math.max(cursor, lookahead - 1);
        }
    });

    return tags;
}

/**
 * @function extractBrowserFallbackSearchTags
 * @description 合并 frontmatter 与 inline hashtag，得到文件标签集合。
 * @param content Markdown 原文。
 * @returns 去重后的标签列表。
 */
function extractBrowserFallbackSearchTags(content: string): string[] {
    const tags = new Set<string>();
    const frontmatterYaml = extractBrowserFallbackFrontmatterYaml(content);
    if (frontmatterYaml) {
        try {
            const parsed = YAML.parse(frontmatterYaml) as Record<string, unknown> | null;
            const frontmatterTags = collectBrowserFallbackTagsFromYaml(parsed?.tags);
            frontmatterTags.forEach((tag) => {
                tags.add(tag);
            });
        } catch (error) {
            console.warn("[vault-api] browser fallback tag parse failed", { error });
        }
    }

    extractBrowserFallbackInlineTags(content).forEach((tag) => {
        tags.add(tag);
    });

    return Array.from(tags).sort((left, right) => left.localeCompare(right));
}

/**
 * @function clipBrowserFallbackSnippet
 * @description 将文本行裁剪为摘要片段。
 * @param line 原始文本行。
 * @returns 摘要文本。
 */
function clipBrowserFallbackSnippet(line: string): string {
    const collapsed = line.trim().replace(/\s+/g, " ");
    if (collapsed.length <= 140) {
        return collapsed;
    }

    return `${collapsed.slice(0, 140)}…`;
}

/**
 * @function scoreBrowserFallbackContentMatch
 * @description 浏览器回退模式下计算正文匹配分值与摘要。
 * @param content Markdown 原文。
 * @param query 搜索关键字。
 * @returns 匹配分值与摘要；未命中返回 null。
 */
function scoreBrowserFallbackContentMatch(
    content: string,
    query: string,
): { score: number; snippet?: string; snippetLine?: number } | null {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
        return null;
    }

    const excludedRanges = detectExcludedLineRanges(content);
    const searchableLines = content
        .split("\n")
        .map((line, index) => ({
            line,
            lineNumber: index + 1,
        }))
        .filter(({ lineNumber }) => !isLineExcluded(lineNumber, excludedRanges));

    const normalizedLines = searchableLines.map(({ line }) => line.toLowerCase());
    let score = 0;
    for (const token of tokens) {
        const matched = normalizedLines.some((line) => line.includes(token));
        if (!matched) {
            return null;
        }
        score += 36 + token.length;
    }

    let bestSnippet:
        | { snippet: string; snippetLine: number; matchedTokenCount: number }
        | null = null;
    for (const [index, { line, lineNumber }] of searchableLines.entries()) {
        const normalizedLine = normalizedLines[index] ?? "";
        const matchedTokenCount = tokens.filter((token) => normalizedLine.includes(token)).length;
        if (matchedTokenCount <= 0) {
            continue;
        }

        const snippet = clipBrowserFallbackSnippet(line);
        if (!snippet) {
            continue;
        }

        if (!bestSnippet
            || matchedTokenCount > bestSnippet.matchedTokenCount
            || (matchedTokenCount === bestSnippet.matchedTokenCount && lineNumber < bestSnippet.snippetLine)) {
            bestSnippet = {
                snippet,
                snippetLine: lineNumber,
                matchedTokenCount,
            };
        }
    }

    let snippet: string | undefined;
    let snippetLine: number | undefined;
    if (bestSnippet) {
        score += bestSnippet.matchedTokenCount * 24;
        snippet = bestSnippet.snippet;
        snippetLine = bestSnippet.snippetLine;
    }

    return {
        score,
        snippet,
        snippetLine,
    };
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
        const markdownContents = await getBrowserMockMarkdownContents();
        return {
            vaultPath: browserFallbackVaultPath,
            entries: buildBrowserFallbackTreeEntries(markdownContents),
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
        const markdownContents = await getBrowserMockMarkdownContents();
        const mockContent = markdownContents[relativePath] ?? "";

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
 * @function readVaultCanvasFile
 * @description 以相对路径读取仓库中的 Canvas 文件。
 * @param relativePath 文件相对路径。
 * @returns 文件内容。
 */
export async function readVaultCanvasFile(relativePath: string): Promise<ReadCanvasFileResponse> {
    if (!isTauriRuntime()) {
        const textContents = await getBrowserMockMarkdownContents();
        return {
            relativePath,
            content: textContents[relativePath] ?? "{\n  \"nodes\": [],\n  \"edges\": []\n}\n",
        };
    }

    return invoke<ReadCanvasFileResponse>("read_vault_canvas_file", {
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
        throw new Error(i18n.t("editor.noLocalBinaryRead"));
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
        const markdownContents = await getBrowserMockMarkdownContents();
        const normalizedTarget = normalizeSlashPath(target.trim());
        if (!normalizedTarget) {
            return null;
        }

        const allMockPaths = Object.keys(markdownContents);
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
        const overrideResponse = getBrowserMockMarkdownGraphOverride();
        if (overrideResponse) {
            console.info("[vault-api] getCurrentVaultMarkdownGraph fallback to injected browser mock graph", {
                nodeCount: overrideResponse.nodes.length,
                edgeCount: overrideResponse.edges.length,
            });
            return overrideResponse;
        }

        console.info("[vault-api] getCurrentVaultMarkdownGraph fallback to browser mock data");
        const markdownContents = await getBrowserMockMarkdownContents();
        return buildBrowserMockMarkdownGraph(markdownContents);
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
        const markdownContents = await getBrowserMockMarkdownContents();
        const fallbackItems = Object.keys(markdownContents)
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

    /* ── Pinyin augmentation: re-score with pinyin when backend yields few results ── */
    const trimmedQuery = query.trim();
    if (trimmedQuery && /^[a-zA-Z\s]+$/.test(trimmedQuery)) {
        const allFiles = await invoke<VaultQuickSwitchItem[]>("search_vault_markdown_files", {
            query: "",
            limit: 200,
        });

        const existingPaths = new Set(response.map((item) => item.relativePath));
        const pinyinMatches: VaultQuickSwitchItem[] = [];

        for (const item of allFiles) {
            if (existingPaths.has(item.relativePath)) {
                continue;
            }
            const pinyinScore = scorePinyinMatch(item.title, trimmedQuery);
            if (pinyinScore !== null) {
                pinyinMatches.push({ ...item, score: pinyinScore });
            }
        }

        if (pinyinMatches.length > 0) {
            const merged = [...response, ...pinyinMatches]
                .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
                .slice(0, normalizedLimit);
            console.info("[vault-api] pinyin augmentation added", { extra: pinyinMatches.length });
            return merged;
        }
    }

    return response;
}

/**
 * @function searchVaultMarkdown
 * @description 在当前 vault 中执行文件名、正文与标签联合搜索。
 * @param query 搜索关键字。
 * @param options 搜索配置。
 * @returns 搜索命中列表。
 */
export async function searchVaultMarkdown(
    query: string,
    options?: {
        tag?: string;
        scope?: VaultSearchScope;
        limit?: number;
    },
): Promise<VaultSearchMatchItem[]> {
    const normalizedScope = options?.scope ?? "all";
    const normalizedLimit = Math.max(1, Math.min(200, Number.isFinite(options?.limit) ? Math.floor(options?.limit ?? 80) : 80));
    const normalizedTag = options?.tag?.trim() ? options.tag.trim() : undefined;

    if (!isTauriRuntime()) {
        const markdownContents = await getBrowserMockMarkdownContents();
        const fallbackItems: VaultSearchMatchItem[] = [];
        const expectedTag = normalizedTag ? normalizeBrowserFallbackTag(normalizedTag) : null;

        Object.entries(markdownContents).forEach(([relativePath, content]) => {
            const tags = extractBrowserFallbackSearchTags(content);
            const matchedTag = expectedTag ? tags.includes(expectedTag) : false;
            if (expectedTag && !matchedTag) {
                return;
            }

            const matchedFileName = query.trim().length > 0
                && normalizedScope !== "content"
                && scoreBrowserFallbackQuickSwitch(relativePath, query) !== null;
            const contentMatch = query.trim().length > 0 && normalizedScope !== "fileName"
                ? scoreBrowserFallbackContentMatch(content, query)
                : null;
            const matchedContent = Boolean(contentMatch);

            const include = query.trim().length === 0
                ? Boolean(expectedTag)
                : normalizedScope === "all"
                    ? matchedFileName || matchedContent
                    : normalizedScope === "content"
                        ? matchedContent
                        : matchedFileName;

            if (!include) {
                return;
            }

            const fileScore = matchedFileName
                ? scoreBrowserFallbackQuickSwitch(relativePath, query) ?? 0
                : 0;
            const item = normalizeVaultSearchMatchItem({
                relativePath,
                title: relativePath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? relativePath,
                score: fileScore + (contentMatch?.score ?? 0) + (expectedTag ? 12 : 0),
                tags,
                matchedFileName,
                matchedContent,
                matchedTag: Boolean(expectedTag),
            });

            if (contentMatch?.snippet) {
                item.snippet = contentMatch.snippet;
            }
            if (contentMatch?.snippetLine) {
                item.snippetLine = contentMatch.snippetLine;
            }

            fallbackItems.push(item);
        });

        return fallbackItems
            .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
            .slice(0, normalizedLimit);
    }

    console.info("[vault-api] searchVaultMarkdown invoke start", {
        query,
        tag: normalizedTag ?? null,
        scope: normalizedScope,
        limit: normalizedLimit,
    });

    const response = await invoke<Array<Partial<VaultSearchMatchItem> & {
        relativePath: string;
        title: string;
        score: number;
    }>>("search_vault_markdown", {
        query,
        tag: normalizedTag ?? null,
        scope: normalizedScope,
        limit: normalizedLimit,
    });

    console.info("[vault-api] searchVaultMarkdown invoke success", {
        query,
        tag: normalizedTag ?? null,
        scope: normalizedScope,
        resultCount: response.length,
    });

    return response.map((item) => normalizeVaultSearchMatchItem(item));
}

/**
 * @function suggestWikiLinkTargets
 * @description 为 WikiLink 自动补全提供建议列表。
 *   排序同时考虑关键字匹配度与笔记被引用次数（热度）。
 * @param query 搜索关键字（可为空）。
 * @param limit 最大返回条数，默认 20。
 * @returns 建议列表。
 */
export async function suggestWikiLinkTargets(
    query: string,
    limit = 20,
): Promise<WikiLinkSuggestionItem[]> {
    const normalizedLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 20));

    if (!isTauriRuntime()) {
        const markdownContents = await getBrowserMockMarkdownContents();
        // 浏览器回退：复用 mock 数据
        const fallbackItems = Object.keys(markdownContents)
            .map((relativePath) => {
                const score = query.trim()
                    ? scoreBrowserFallbackQuickSwitch(relativePath, query) ?? undefined
                    : 0;
                if (score === undefined) {
                    return null;
                }
                return {
                    relativePath,
                    title: relativePath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? relativePath,
                    score,
                    referenceCount: 0,
                };
            })
            .filter((item): item is WikiLinkSuggestionItem => item !== null)
            .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
            .slice(0, normalizedLimit);

        return fallbackItems;
    }

    console.debug("[vault-api] suggestWikiLinkTargets invoke start", {
        query,
        limit: normalizedLimit,
    });

    const response = await invoke<WikiLinkSuggestionItem[]>("suggest_wikilink_targets", {
        query,
        limit: normalizedLimit,
    });

    console.debug("[vault-api] suggestWikiLinkTargets invoke success", {
        query,
        resultCount: response.length,
    });

    return response;
}

/**
 * @function getBacklinksForFile
 * @description 获取指定文件的反向链接列表。
 * @param relativePath 目标文件相对路径。
 * @returns 反向链接列表。
 */
export async function getBacklinksForFile(relativePath: string): Promise<BacklinkItem[]> {
    if (!isTauriRuntime()) {
        const markdownContents = await getBrowserMockMarkdownContents();
        return buildBrowserFallbackBacklinks(markdownContents, relativePath);
    }

    return invoke<BacklinkItem[]>("get_backlinks_for_file", {
        relativePath,
    });
}

/**
 * @function getVaultMarkdownOutline
 * @description 获取指定 Markdown 文件的大纲标题列表。
 * @param relativePath 目标文件相对路径。
 * @returns 大纲响应。
 */
export async function getVaultMarkdownOutline(relativePath: string): Promise<OutlineResponse> {
    if (!isTauriRuntime()) {
        const markdownContents = await getBrowserMockMarkdownContents();
        return extractBrowserFallbackOutline(markdownContents, relativePath);
    }

    return invoke<OutlineResponse>("get_vault_markdown_outline", {
        relativePath,
    });
}

/**
 * @function queryVaultMarkdownFrontmatter
 * @description 查询当前 vault 中具有指定 frontmatter 字段的 Markdown 笔记。
 * @param fieldName frontmatter 字段名，如 `date`。
 * @param fieldValue 可选字段值；为空时匹配所有包含该字段的笔记。
 * @returns 查询响应。
 */
export async function queryVaultMarkdownFrontmatter(
    fieldName: string,
    fieldValue?: string,
): Promise<FrontmatterQueryResponse> {
    if (!isTauriRuntime()) {
        const markdownContents = await getBrowserMockMarkdownContents();
        return buildBrowserFallbackFrontmatterQuery(markdownContents, fieldName, fieldValue);
    }

    console.info("[vault-api] queryVaultMarkdownFrontmatter invoke start", {
        fieldName,
        fieldValue: fieldValue ?? null,
    });

    const response = await invoke<FrontmatterQueryResponse>("query_vault_markdown_frontmatter", {
        fieldName,
        fieldValue: fieldValue ?? null,
    });

    console.info("[vault-api] queryVaultMarkdownFrontmatter invoke success", {
        fieldName,
        matchCount: response.matches.length,
    });

    return response;
}

/**
 * @function queryVaultTasks
 * @description 查询当前 vault 中所有符合任务看板语法的任务条目。
 * @returns 任务列表。
 */
export async function queryVaultTasks(): Promise<VaultTaskItem[]> {
    if (!isTauriRuntime()) {
        const markdownContents = await getBrowserMockMarkdownContents();
        return buildBrowserFallbackTaskItems(markdownContents);
    }

    console.info("[vault-api] queryVaultTasks invoke start");
    const response = await invoke<VaultTaskItem[]>("query_vault_tasks");
    console.info("[vault-api] queryVaultTasks invoke success", {
        taskCount: response.length,
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
        const markdownContents = await getBrowserMockMarkdownContents();
        markdownContents[normalizeSlashPath(relativePath)] = content ?? "";
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
 * @function createVaultCanvasFile
 * @description 在当前仓库创建 Canvas 文件。
 * @param relativePath 目标文件相对路径。
 * @param content 可选初始内容。
 * @returns 创建结果。
 */
export async function createVaultCanvasFile(
    relativePath: string,
    content?: string,
): Promise<WriteCanvasFileResponse> {
    if (!isTauriRuntime()) {
        const textContents = await getBrowserMockMarkdownContents();
        textContents[normalizeSlashPath(relativePath)] = content ?? "{\n  \"nodes\": [],\n  \"edges\": []\n}\n";
        return {
            relativePath,
            created: true,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<WriteCanvasFileResponse>("create_vault_canvas_file", {
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
        const markdownContents = await getBrowserMockMarkdownContents();
        markdownContents[normalizeSlashPath(relativePath)] = content;
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
 * @function saveVaultCanvasFile
 * @description 保存当前仓库中的 Canvas 文件。
 * @param relativePath 目标文件相对路径。
 * @param content 文件内容。
 * @returns 保存结果。
 */
export async function saveVaultCanvasFile(
    relativePath: string,
    content: string,
): Promise<WriteCanvasFileResponse> {
    if (!isTauriRuntime()) {
        const textContents = await getBrowserMockMarkdownContents();
        textContents[normalizeSlashPath(relativePath)] = content;
        return {
            relativePath,
            created: false,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<WriteCanvasFileResponse>("save_vault_canvas_file", {
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
 * @function renameVaultCanvasFile
 * @description 重命名当前仓库中的 Canvas 文件。
 * @param fromRelativePath 原文件相对路径。
 * @param toRelativePath 目标文件相对路径。
 * @returns 重命名结果。
 */
export async function renameVaultCanvasFile(
    fromRelativePath: string,
    toRelativePath: string,
): Promise<WriteCanvasFileResponse> {
    const normalizedFromPath = normalizeSlashPath(fromRelativePath).trim();
    const normalizedToPath = normalizeSlashPath(toRelativePath).trim();

    if (!isTauriRuntime()) {
        const textContents = await getBrowserMockMarkdownContents();
        const sourceContent = textContents[normalizedFromPath];
        if (typeof sourceContent !== "string") {
            throw new Error(i18n.t("editor.sourceNotExist"));
        }

        if (
            typeof textContents[normalizedToPath] === "string"
            && normalizedToPath !== normalizedFromPath
        ) {
            throw new Error(i18n.t("editor.targetExists"));
        }

        if (normalizedToPath !== normalizedFromPath) {
            delete textContents[normalizedFromPath];
            textContents[normalizedToPath] = sourceContent;
        }

        return {
            relativePath: normalizedToPath,
            created: false,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<WriteCanvasFileResponse>("rename_vault_canvas_file", {
        fromRelativePath: normalizedFromPath,
        toRelativePath: normalizedToPath,
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
        throw new Error(i18n.t("editor.invalidSourcePath"));
    }

    const targetRelativePath = normalizedTargetDirectory
        ? `${normalizedTargetDirectory}/${sourceFileName}`
        : sourceFileName;

    if (!isTauriRuntime()) {
        const markdownContents = await getBrowserMockMarkdownContents();
        const sourceContent = markdownContents[normalizedFromPath];
        if (typeof sourceContent !== "string") {
            throw new Error(i18n.t("editor.sourceNotExist"));
        }

        const existedTarget = markdownContents[targetRelativePath];
        if (typeof existedTarget === "string" && targetRelativePath !== normalizedFromPath) {
            throw new Error(i18n.t("editor.targetExists"));
        }

        if (targetRelativePath !== normalizedFromPath) {
            delete markdownContents[normalizedFromPath];
            markdownContents[targetRelativePath] = sourceContent;
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
 * @function moveVaultCanvasFileToDirectory
 * @description 将 Canvas 文件移动到指定目录（文件名保持不变）。
 * @param fromRelativePath 源文件相对路径。
 * @param targetDirectoryRelativePath 目标目录相对路径；空字符串表示仓库根目录。
 * @returns 移动结果。
 */
export async function moveVaultCanvasFileToDirectory(
    fromRelativePath: string,
    targetDirectoryRelativePath: string,
): Promise<WriteCanvasFileResponse> {
    const normalizedFromPath = normalizeSlashPath(fromRelativePath).trim();
    const normalizedTargetDirectory = normalizeSlashPath(targetDirectoryRelativePath).trim().replace(/^\/+|\/+$/g, "");
    const sourceFileName = normalizedFromPath.split("/").pop() ?? "";

    if (!sourceFileName) {
        throw new Error(i18n.t("editor.invalidSourcePath"));
    }

    const targetRelativePath = normalizedTargetDirectory
        ? `${normalizedTargetDirectory}/${sourceFileName}`
        : sourceFileName;

    if (!isTauriRuntime()) {
        const textContents = await getBrowserMockMarkdownContents();
        const sourceContent = textContents[normalizedFromPath];
        if (typeof sourceContent !== "string") {
            throw new Error(i18n.t("editor.sourceNotExist"));
        }

        const existedTarget = textContents[targetRelativePath];
        if (typeof existedTarget === "string" && targetRelativePath !== normalizedFromPath) {
            throw new Error(i18n.t("editor.targetExists"));
        }

        if (targetRelativePath !== normalizedFromPath) {
            delete textContents[normalizedFromPath];
            textContents[targetRelativePath] = sourceContent;
        }

        return {
            relativePath: targetRelativePath,
            created: false,
        };
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    return invoke<WriteCanvasFileResponse>("move_vault_canvas_file_to_directory", {
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
        throw new Error(i18n.t("editor.directoryPathEmpty"));
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
 * @function deleteVaultCanvasFile
 * @description 删除当前仓库中的 Canvas 文件。
 * @param relativePath 目标文件相对路径。
 */
export async function deleteVaultCanvasFile(relativePath: string): Promise<void> {
    const normalizedPath = normalizeSlashPath(relativePath).trim();

    if (!isTauriRuntime()) {
        const textContents = await getBrowserMockMarkdownContents();
        delete textContents[normalizedPath];
        return;
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    await invoke<void>("delete_vault_canvas_file", {
        relativePath: normalizedPath,
        sourceTraceId,
    });
}

/**
 * @function deleteVaultBinaryFile
 * @description 删除当前仓库中的二进制文件（图片等非 Markdown 文件）。
 * @param relativePath 目标文件相对路径。
 * @throws 路径为空、绝对路径、目录逃逸、文件不存在时抛出错误。
 */
export async function deleteVaultBinaryFile(relativePath: string): Promise<void> {
    if (!isTauriRuntime()) {
        return;
    }

    const sourceTraceId = createWriteTraceId();
    registerLocalWriteTrace(sourceTraceId);

    await invoke<void>("delete_vault_binary_file", {
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
        const delayMs = getBrowserFallbackConfigReadDelayMs();
        if (delayMs > 0 && typeof window !== "undefined") {
            await sleep(delayMs);
        }
        return readBrowserFallbackVaultConfig();
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
        return writeBrowserFallbackVaultConfig(config);
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
