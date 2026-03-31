/**
 * @module plugins/markdown-codemirror/editor/markdownReadTransform
 * @description 阅读态 Markdown 预处理模块：负责剥离 frontmatter、将增强语法
 *   转换为 React Markdown 可消费的协议链接，并暴露阅读态结构化 frontmatter 数据。
 * @dependencies
 *  - yaml
 *  - ../../../utils/markdownBlockDetector
 *  - ./syntaxPlugins/wikiLinkParser
 *
 * @example
 *   const prepared = prepareMarkdownForReadMode("---\ntitle: Demo\n---\nSee [[Note|Alias]] and ==mark==");
 *   prepared.frontmatter[0]?.key // => "title"
 *   prepared.renderedMarkdown // => "See [Alias](/__ofive_wikilink__/Note) and [mark](/__ofive_highlight__/mark)"
 *
 * @exports
 *   - prepareMarkdownForReadMode 预处理阅读态 Markdown 与 frontmatter
 *   - transformMarkdownForReadMode 将增强语法转换为标准 Markdown 协议链接
 *   - decodeReadMode*Href 解析阅读态协议链接
 */

import YAML from "yaml";
import { detectExcludedLineRanges } from "../../../utils/markdownBlockDetector";
import { parseWikiLinkParts } from "./syntaxPlugins/wikiLinkParser";

/** 阅读态 WikiLink href 路径前缀。 */
export const READ_MODE_WIKILINK_PROTOCOL = "/__ofive_wikilink__/";
/** 阅读态图片嵌入 href 路径前缀。 */
export const READ_MODE_MEDIA_EMBED_PROTOCOL = "/__ofive_media_embed__/";
/** 阅读态高亮 href 路径前缀。 */
export const READ_MODE_INLINE_HIGHLIGHT_PROTOCOL = "/__ofive_highlight__/";
/** 阅读态标签 href 路径前缀。 */
export const READ_MODE_INLINE_TAG_PROTOCOL = "/__ofive_tag__/";
/** 阅读态行内 LaTeX href 路径前缀。 */
export const READ_MODE_INLINE_LATEX_PROTOCOL = "/__ofive_inline_latex__/";
/** 阅读态块级 LaTeX href 路径前缀。 */
export const READ_MODE_BLOCK_LATEX_PROTOCOL = "/__ofive_block_latex__/";

const LEGACY_READ_MODE_WIKILINK_PROTOCOL = "ofive-wikilink://";
const WIKILINK_PATTERN = /(!)?\[\[([^\]\n]+?)\]\]/g;
const IMAGE_EMBED_PATTERN = /!\[\[([^\]\n]+?)\]\]/g;
const HIGHLIGHT_INLINE_PATTERN = /(==)(?=\S)(.+?)(?<=\S)\1/g;
const TAG_PATTERN = /(^|[\s([{])(#(?!\s)[\p{L}\p{N}_-]+)/gu;
const INLINE_LATEX_PATTERN = /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g;
const BLOCK_LATEX_SINGLE_LINE_PATTERN = /^\s*\$\$(.+?)\$\$\s*$/;

/**
 * @interface ReadModeFrontmatterField
 * @description 阅读态 frontmatter 字段视图模型。
 */
export interface ReadModeFrontmatterField {
    /** frontmatter 字段名。 */
    key: string;
    /** frontmatter 字段值的阅读态文本。 */
    value: string;
}

/**
 * @interface PreparedReadModeMarkdown
 * @description 阅读态预处理结果。
 */
export interface PreparedReadModeMarkdown {
    /** 去除 frontmatter 且完成增强语法转换后的 Markdown。 */
    renderedMarkdown: string;
    /** frontmatter 是否存在。 */
    hasFrontmatter: boolean;
    /** frontmatter 字段列表。 */
    frontmatter: ReadModeFrontmatterField[];
}

/**
 * @function prepareMarkdownForReadMode
 * @description 预处理阅读态 Markdown，提取 frontmatter 并转换增强语法。
 * @param markdown 原始 Markdown 文本。
 * @returns 预处理结果。
 */
export function prepareMarkdownForReadMode(markdown: string): PreparedReadModeMarkdown {
    const ranges = detectExcludedLineRanges(markdown);
    const lines = markdown.split("\n");
    const rangeByStartLine = new Map(ranges.map((range) => [range.fromLine, range]));
    const { frontmatter, hasFrontmatter } = extractFrontmatterFields(markdown, ranges);
    const outputLines: string[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const lineNumber = lineIndex + 1;
        const range = rangeByStartLine.get(lineNumber);

        if (range?.type === "frontmatter") {
            lineIndex = range.toLine - 1;
            continue;
        }

        if (range?.type === "latex-block") {
            const latexSource = extractLatexBlockSource(lines, range.fromLine, range.toLine);
            appendReadModeBlockLatex(outputLines, lines, range.toLine, latexSource);
            lineIndex = range.toLine - 1;
            continue;
        }

        if (range?.type === "code-fence") {
            outputLines.push(...lines.slice(range.fromLine - 1, range.toLine));
            lineIndex = range.toLine - 1;
            continue;
        }

        outputLines.push(transformInlineReadModeSyntax(lines[lineIndex] ?? ""));
    }

    return {
        renderedMarkdown: outputLines.join("\n"),
        hasFrontmatter,
        frontmatter,
    };
}

/**
 * @function extractLatexBlockSource
 * @description 从单行或多行块级 LaTeX 范围中提取公式源码。
 * @param lines 原始 Markdown 行数组。
 * @param fromLine 块起始行号（1-based，含）。
 * @param toLine 块结束行号（1-based，含）。
 * @returns 去掉外围 `$$` 后的公式源码。
 */
function extractLatexBlockSource(lines: string[], fromLine: number, toLine: number): string {
    if (fromLine === toLine) {
        const singleLineText = lines[fromLine - 1] ?? "";
        const singleLineMatch = singleLineText.match(BLOCK_LATEX_SINGLE_LINE_PATTERN);
        return (singleLineMatch?.[1] ?? "").trim();
    }

    return lines
        .slice(fromLine, Math.max(fromLine, toLine - 1))
        .join("\n")
        .trim();
}

/**
 * @function appendReadModeBlockLatex
 * @description 以独立 Markdown block 的形式追加阅读态块级 LaTeX 协议，避免与相邻段落合并为普通链接。
 * @param outputLines 当前输出行数组。
 * @param sourceLines 原始 Markdown 行数组。
 * @param toLine 块级 LaTeX 结束行号（1-based，含）。
 * @param latexSource 公式源码。
 * @returns 无返回值。
 */
function appendReadModeBlockLatex(
    outputLines: string[],
    sourceLines: string[],
    toLine: number,
    latexSource: string,
): void {
    if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== "") {
        outputLines.push("");
    }

    outputLines.push(buildProtocolMarkdown(
        READ_MODE_BLOCK_LATEX_PROTOCOL,
        latexSource,
        "LaTeX",
    ));

    const nextLineText = sourceLines[toLine] ?? "";
    if (nextLineText.trim() !== "") {
        outputLines.push("");
    }
}

/**
 * @function transformMarkdownForReadMode
 * @description 将原始 Markdown 转换为阅读态渲染用的 Markdown 文本。
 * @param markdown 原始 Markdown 文本。
 * @returns 转换后的 Markdown 文本。
 */
export function transformMarkdownForReadMode(markdown: string): string {
    return prepareMarkdownForReadMode(markdown).renderedMarkdown;
}

/**
 * @function decodeReadModeWikiLinkHref
 * @description 从阅读态 WikiLink href 中解析出原始目标。
 * @param href 阅读态链接 href。
 * @returns 解析成功时返回目标文本，否则返回 null。
 */
export function decodeReadModeWikiLinkHref(href: string | undefined): string | null {
    return decodeProtocolHref(href, READ_MODE_WIKILINK_PROTOCOL, LEGACY_READ_MODE_WIKILINK_PROTOCOL);
}

/**
 * @function decodeReadModeMediaEmbedHref
 * @description 从阅读态图片嵌入 href 中解析出原始目标。
 * @param href 阅读态链接 href。
 * @returns 图片嵌入目标；解析失败返回 null。
 */
export function decodeReadModeMediaEmbedHref(href: string | undefined): string | null {
    return decodeProtocolHref(href, READ_MODE_MEDIA_EMBED_PROTOCOL);
}

/**
 * @function decodeReadModeHighlightHref
 * @description 从阅读态高亮 href 中解析出原始高亮文本。
 * @param href 阅读态链接 href。
 * @returns 高亮文本；解析失败返回 null。
 */
export function decodeReadModeHighlightHref(href: string | undefined): string | null {
    return decodeProtocolHref(href, READ_MODE_INLINE_HIGHLIGHT_PROTOCOL);
}

/**
 * @function decodeReadModeTagHref
 * @description 从阅读态标签 href 中解析出标签文本。
 * @param href 阅读态链接 href。
 * @returns 标签文本；解析失败返回 null。
 */
export function decodeReadModeTagHref(href: string | undefined): string | null {
    return decodeProtocolHref(href, READ_MODE_INLINE_TAG_PROTOCOL);
}

/**
 * @function decodeReadModeInlineLatexHref
 * @description 从阅读态行内 LaTeX href 中解析出公式源码。
 * @param href 阅读态链接 href。
 * @returns LaTeX 源码；解析失败返回 null。
 */
export function decodeReadModeInlineLatexHref(href: string | undefined): string | null {
    return decodeProtocolHref(href, READ_MODE_INLINE_LATEX_PROTOCOL);
}

/**
 * @function decodeReadModeBlockLatexHref
 * @description 从阅读态块级 LaTeX href 中解析出公式源码。
 * @param href 阅读态链接 href。
 * @returns LaTeX 源码；解析失败返回 null。
 */
export function decodeReadModeBlockLatexHref(href: string | undefined): string | null {
    return decodeProtocolHref(href, READ_MODE_BLOCK_LATEX_PROTOCOL);
}

/**
 * @function transformInlineReadModeSyntax
 * @description 将单行增强语法转换为阅读态协议链接。
 * @param lineText 原始单行文本。
 * @returns 转换后的单行文本。
 */
function transformInlineReadModeSyntax(lineText: string): string {
    const replacements: string[] = [];
    const toToken = (replacement: string): string => {
        const token = `@@OFIVE_READMODE_${String(replacements.length)}@@`;
        replacements.push(replacement);
        return token;
    };

    let transformedText = lineText.replace(IMAGE_EMBED_PATTERN, (_fullMatch, rawTarget: string) => toToken(
        buildProtocolImageMarkdown(
            READ_MODE_MEDIA_EMBED_PROTOCOL,
            rawTarget.trim(),
            buildMediaEmbedLabel(rawTarget),
        ),
    ));

    transformedText = transformedText.replace(WIKILINK_PATTERN, (fullMatch, imagePrefix: string | undefined, rawTarget: string) => {
        if (imagePrefix === "!") {
            return fullMatch;
        }

        const parsed = parseWikiLinkParts(rawTarget.trim());
        if (!parsed) {
            return fullMatch;
        }

        return toToken(buildProtocolMarkdown(
            READ_MODE_WIKILINK_PROTOCOL,
            parsed.target,
            parsed.displayText,
        ));
    });

    transformedText = transformedText.replace(HIGHLIGHT_INLINE_PATTERN, (_fullMatch, _delimiter: string, highlightedText: string) => toToken(
        buildProtocolMarkdown(
            READ_MODE_INLINE_HIGHLIGHT_PROTOCOL,
            highlightedText,
            highlightedText,
        ),
    ));

    transformedText = transformedText.replace(INLINE_LATEX_PATTERN, (_fullMatch, latexSource: string) => toToken(
        buildProtocolMarkdown(
            READ_MODE_INLINE_LATEX_PROTOCOL,
            latexSource,
            `$${latexSource}$`,
        ),
    ));

    transformedText = transformedText.replace(TAG_PATTERN, (_fullMatch, prefix: string, tagText: string) => `${prefix}${toToken(
        buildProtocolMarkdown(
            READ_MODE_INLINE_TAG_PROTOCOL,
            tagText.slice(1),
            tagText,
        ),
    )}`);

    return replacements.reduce(
        (currentText, replacement, index) => currentText.replace(`@@OFIVE_READMODE_${String(index)}@@`, replacement),
        transformedText,
    );
}

/**
 * @function extractFrontmatterFields
 * @description 从 Markdown 文本开头提取结构化 frontmatter 字段。
 * @param markdown 原始 Markdown 文本。
 * @param ranges 预先检测的块级排斥区间。
 * @returns frontmatter 字段与存在标记。
 */
function extractFrontmatterFields(
    markdown: string,
    ranges: ReturnType<typeof detectExcludedLineRanges>,
): Pick<PreparedReadModeMarkdown, "frontmatter" | "hasFrontmatter"> {
    const firstRange = ranges[0];
    if (!firstRange || firstRange.type !== "frontmatter" || firstRange.fromLine !== 1) {
        return {
            hasFrontmatter: false,
            frontmatter: [],
        };
    }

    const yamlLines = markdown.split("\n").slice(1, Math.max(1, firstRange.toLine - 1));
    const yamlText = yamlLines.join("\n");
    if (!yamlText.trim()) {
        return {
            hasFrontmatter: true,
            frontmatter: [],
        };
    }

    try {
        const parsed = YAML.parse(yamlText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {
                hasFrontmatter: true,
                frontmatter: [{ key: "value", value: formatFrontmatterValue(parsed) }],
            };
        }

        return {
            hasFrontmatter: true,
            frontmatter: Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
                key,
                value: formatFrontmatterValue(value),
            })),
        };
    } catch (error) {
        console.warn("[markdown-read-transform] frontmatter parse failed", {
            message: error instanceof Error ? error.message : String(error),
        });

        return {
            hasFrontmatter: true,
            frontmatter: [],
        };
    }
}

/**
 * @function formatFrontmatterValue
 * @description 将 frontmatter 原始值格式化为阅读态可读文本。
 * @param value frontmatter 原始字段值。
 * @returns 格式化文本。
 */
function formatFrontmatterValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => formatFrontmatterValue(item)).join(", ");
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * @function buildProtocolMarkdown
 * @description 生成阅读态协议链接 Markdown。
 * @param protocol 协议前缀。
 * @param target 目标文本。
 * @param label 链接展示文本。
 * @returns Markdown 链接文本。
 */
function buildProtocolMarkdown(protocol: string, target: string, label: string): string {
    return `[${escapeMarkdownLinkText(label)}](${protocol}${encodeURIComponent(target)})`;
}

/**
 * @function buildProtocolImageMarkdown
 * @description 生成阅读态协议图片 Markdown。
 * @param protocol 协议前缀。
 * @param target 目标文本。
 * @param alt 图片替代文本。
 * @returns Markdown 图片文本。
 */
function buildProtocolImageMarkdown(protocol: string, target: string, alt: string): string {
    return `![${escapeMarkdownLinkText(alt)}](${protocol}${encodeURIComponent(target)})`;
}

/**
 * @function escapeMarkdownLinkText
 * @description 转义 Markdown 链接文本中的特殊字符。
 * @param text 原始文本。
 * @returns 转义后的文本。
 */
function escapeMarkdownLinkText(text: string): string {
    return text
        .replace(/\\/g, "\\\\")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");
}

/**
 * @function buildMediaEmbedLabel
 * @description 根据图片嵌入目标生成阅读态标题。
 * @param rawTarget 图片嵌入原始目标。
 * @returns 图片标题。
 */
function buildMediaEmbedLabel(rawTarget: string): string {
    const trimmedTarget = rawTarget.trim();
    const fileName = trimmedTarget.split("/").pop()?.trim();
    return fileName || trimmedTarget || "image";
}

/**
 * @function decodeProtocolHref
 * @description 从指定阅读态协议 href 中解析出原始目标。
 * @param href 阅读态链接 href。
 * @param protocols 支持的协议前缀列表。
 * @returns 解析成功时返回目标文本，否则返回 null。
 */
function decodeProtocolHref(href: string | undefined, ...protocols: string[]): string | null {
    if (!href) {
        return null;
    }

    const matchedProtocol = protocols.find((protocol) => href.startsWith(protocol));
    if (!matchedProtocol) {
        return null;
    }

    const encodedTarget = href.slice(matchedProtocol.length);
    if (!encodedTarget) {
        return null;
    }

    try {
        return decodeURIComponent(encodedTarget);
    } catch {
        return null;
    }
}