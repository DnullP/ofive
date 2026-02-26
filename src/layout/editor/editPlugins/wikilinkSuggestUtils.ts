/**
 * @module layout/editor/editPlugins/wikilinkSuggestUtils
 * @description WikiLink 检测相关的纯工具函数。
 *   将纯逻辑从 wikilinkSuggestEditPlugin 中抽出，以便
 *   在不依赖 CodeMirror / Vite 的环境中独立测试。
 *
 * @dependencies 无外部依赖
 *
 * @exports
 *   - OPEN_WIKILINK_PATTERN  匹配未闭合 wikilink 的正则
 *   - detectOpenWikiLink     检测光标前是否有未闭合 `[[`
 */

/* ================================================================== */
/*  常量                                                               */
/* ================================================================== */

/** 匹配 `[[queryText` 模式（未闭合的 wikilink） */
export const OPEN_WIKILINK_PATTERN = /\[\[([^\]\n]*)$/;

/* ================================================================== */
/*  检测 wikilink 输入意图                                             */
/* ================================================================== */

/**
 * @function detectOpenWikiLink
 * @description 检测光标前是否有未闭合的 `[[`，并提取查询文本。
 *   只在光标所在行范围内搜索，避免跨行误匹配。
 *   如果 queryText 中已包含 `]]`，视为已闭合，不触发。
 *   如果光标处于已闭合 `[[...]]` 内部（即光标后紧接 `]]`），
 *   则仍触发以允许用户修改已有链接目标。
 * @param docText 完整文档文本。
 * @param cursorPos 光标偏移位置（0-based）。
 * @returns `{ query, anchorPos }` 若检测到，否则 `null`。
 *   - query: `[[` 之后、光标之前的文本。
 *   - anchorPos: `[[` 后面第一个字符在文档中的偏移位置。
 */
export function detectOpenWikiLink(
    docText: string,
    cursorPos: number,
): { query: string; anchorPos: number } | null {
    // 只检查光标所在行（避免跨行误匹配）
    let lineStart = cursorPos;
    while (lineStart > 0 && docText.charAt(lineStart - 1) !== "\n") {
        lineStart--;
    }

    const linePrefix = docText.slice(lineStart, cursorPos);

    // 检查光标后是否已有 `]]`（已闭合则不触发）
    const afterCursor = docText.slice(cursorPos, cursorPos + 2);
    // 如果紧接着就是 ]] 说明用户正在已闭合 wikilink 的中间编辑，仍然触发
    // 做更宽松的判断：只要当前行光标前有 [[ 且 ]] 还没出现在查询段中就触发

    const match = OPEN_WIKILINK_PATTERN.exec(linePrefix);
    if (!match) {
        return null;
    }

    const queryText = match[1] ?? "";
    // 检查 queryText 内是否包含 `]]`，如果包含说明已闭合
    if (queryText.includes("]]")) {
        return null;
    }

    // anchorPos 是 `[[` 后面的位置，即查询文本在文档中的起始偏移
    const bracketOffset = match.index!;
    const anchorPos = lineStart + bracketOffset + 2; // +2 跳过 `[[`

    // 如果光标后紧接 `]]`，说明在已闭合 link 中编辑 — 仍然触发，以便修改链接目标
    // queryText 已由正则提取并不含 `]]`
    void afterCursor; // 仅用于上面的说明

    return { query: queryText, anchorPos };
}
