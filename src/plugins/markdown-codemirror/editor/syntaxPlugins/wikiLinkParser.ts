/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkParser
 * @description WikiLink 文本解析工具：负责拆分 target 与可选别名 displayText。
 * @dependencies
 *  - 无运行时外部依赖
 *
 * @example
 *   parseWikiLinkParts("Network Segment|网段")
 *
 * @exports
 *  - parseWikiLinkParts 解析 wiki link 内容区文本
 */

/**
 * @interface ParsedWikiLinkParts
 * @description Wiki link 文本解析结果。
 */
export interface ParsedWikiLinkParts {
    target: string;
    displayText: string;
    hasExplicitDisplayText: boolean;
}

/**
 * @function parseWikiLinkParts
 * @description 解析 wiki link 内容区，拆分 target 与可选 displayText。
 * @param rawTarget Wiki link 内容区原始文本，不包含 `[[` 与 `]]`。
 * @returns 解析结果；若 target 为空则返回 null。
 */
export function parseWikiLinkParts(rawTarget: string): ParsedWikiLinkParts | null {
    const [linkTargetPart, ...displayParts] = rawTarget.split("|");
    const target = (linkTargetPart ?? "").trim();
    if (target.length === 0) {
        return null;
    }

    const explicitDisplayText = displayParts.join("|").trim();
    return {
        target,
        displayText: explicitDisplayText.length > 0 ? explicitDisplayText : target,
        hasExplicitDisplayText: explicitDisplayText.length > 0,
    };
}