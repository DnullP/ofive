/**
 * @module plugins/markdown-codemirror/editor/markdownReadTransform
 * @description 阅读态 Markdown 预处理模块，负责将 WikiLink 语法转换为可被 React Markdown 渲染的链接。
 * @dependencies
 *  - ./syntaxPlugins/wikiLinkParser
 *
 * @example
 *   const rendered = transformMarkdownForReadMode("See [[Note|Alias]]");
 *
 * @exports
 *   - READ_MODE_WIKILINK_PROTOCOL 阅读态 WikiLink 协议前缀
 *   - transformMarkdownForReadMode 将 WikiLink 转换为标准 Markdown 链接
 *   - decodeReadModeWikiLinkHref 解析阅读态 WikiLink href
 */

import { parseWikiLinkParts } from "./syntaxPlugins/wikiLinkParser";

/** 阅读态 WikiLink href 路径前缀。 */
export const READ_MODE_WIKILINK_PROTOCOL = "/__ofive_wikilink__/";

const LEGACY_READ_MODE_WIKILINK_PROTOCOL = "ofive-wikilink://";

const WIKILINK_PATTERN = /(!)?\[\[([^\]\n]+?)\]\]/g;

/**
 * @function transformMarkdownForReadMode
 * @description 将阅读态文本中的 WikiLink 转换为标准 Markdown 链接。
 * @param markdown 原始 Markdown 文本。
 * @returns 转换后的 Markdown 文本。
 */
export function transformMarkdownForReadMode(markdown: string): string {
    return markdown.replace(WIKILINK_PATTERN, (fullMatch, imagePrefix: string | undefined, rawTarget: string) => {
        if (imagePrefix === "!") {
            return fullMatch;
        }

        const parsed = parseWikiLinkParts(rawTarget.trim());
        if (!parsed) {
            return fullMatch;
        }

        const href = `${READ_MODE_WIKILINK_PROTOCOL}${encodeURIComponent(parsed.target)}`;
        const safeDisplayText = parsed.displayText.replace(/([\[\]])/g, "\\$1");
        return `[${safeDisplayText}](${href})`;
    });
}

/**
 * @function decodeReadModeWikiLinkHref
 * @description 从阅读态 WikiLink href 中解析出原始目标。
 * @param href 阅读态链接 href。
 * @returns 解析成功时返回目标文本，否则返回 null。
 */
export function decodeReadModeWikiLinkHref(href: string | undefined): string | null {
    if (!href) {
        return null;
    }

    const encodedTarget = href.startsWith(READ_MODE_WIKILINK_PROTOCOL)
        ? href.slice(READ_MODE_WIKILINK_PROTOCOL.length)
        : href.startsWith(LEGACY_READ_MODE_WIKILINK_PROTOCOL)
            ? href.slice(LEGACY_READ_MODE_WIKILINK_PROTOCOL.length)
            : null;

    if (!encodedTarget) {
        return null;
    }

    try {
        return decodeURIComponent(encodedTarget);
    } catch {
        return null;
    }
}