/**
 * @module plugins/markdown-codemirror/editor/editPlugins/wikilinkSuggestUtils
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

/**
 * @interface OpenWikiLinkMatch
 * @description 当前光标所在的 WikiLink 编辑区间信息。
 */
export interface OpenWikiLinkMatch {
    /** `[[` 到光标之间的查询文本 */
    query: string;
    /** `[[` 后的第一个字符偏移 */
    anchorPos: number;
    /** 当前补全应替换到的结束偏移（不含） */
    replaceTo: number;
    /** 替换区间后是否保留已有 `]]` */
    preserveClosingBrackets: boolean;
    /** `]]` 是否紧贴在替换区间后面，用于决定光标是否跨过闭合标记 */
    closingBracketsImmediatelyAfterReplaceTo: boolean;
}

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
): OpenWikiLinkMatch | null {
    // 只检查光标所在行（避免跨行误匹配）
    let lineStart = cursorPos;
    while (lineStart > 0 && docText.charAt(lineStart - 1) !== "\n") {
        lineStart--;
    }

    let lineEnd = cursorPos;
    while (lineEnd < docText.length && docText.charAt(lineEnd) !== "\n") {
        lineEnd++;
    }

    const linePrefix = docText.slice(lineStart, cursorPos);
    const lineSuffix = docText.slice(cursorPos, lineEnd);

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

    const nextPipeOffset = queryText.includes("|")
        ? -1
        : lineSuffix.indexOf("|");
    const nextClosingOffset = lineSuffix.indexOf("]]"
    );

    if (
        nextPipeOffset >= 0
        && (nextClosingOffset < 0 || nextPipeOffset < nextClosingOffset)
    ) {
        return {
            query: queryText,
            anchorPos,
            replaceTo: cursorPos + nextPipeOffset,
            preserveClosingBrackets: nextClosingOffset >= 0,
            closingBracketsImmediatelyAfterReplaceTo: false,
        };
    }

    if (nextClosingOffset >= 0) {
        return {
            query: queryText,
            anchorPos,
            replaceTo: cursorPos + nextClosingOffset,
            preserveClosingBrackets: true,
            closingBracketsImmediatelyAfterReplaceTo: true,
        };
    }

    return {
        query: queryText,
        anchorPos,
        replaceTo: cursorPos,
        preserveClosingBrackets: false,
        closingBracketsImmediatelyAfterReplaceTo: false,
    };
}

/**
 * @interface WikiLinkSuggestionAcceptance
 * @description 接受 WikiLink 补全建议后应执行的文本替换规格。
 */
export interface WikiLinkSuggestionAcceptance {
    /** 替换起始偏移 */
    from: number;
    /** 替换结束偏移（不含） */
    to: number;
    /** 插入文本 */
    insert: string;
    /** 接受补全后的光标位置 */
    selectionAnchor: number;
}

/**
 * @interface WikiLinkClosingBracketResolution
 * @description 根据替换区间后缀解析出的闭合括号复用信息。
 */
export interface WikiLinkClosingBracketResolution {
    /** 是否检测到可复用的 `]]` */
    preserveClosingBrackets: boolean;
    /** `]]` 是否紧贴在替换区间后面 */
    closingBracketsImmediatelyAfterReplaceTo: boolean;
}

/**
 * @function resolveWikiLinkClosingBracketResolution
 * @description 从当前替换区间后的文本中判断是否已存在可复用的 `]]`。
 *   支持两种场景：
 *   - 替换区间后立即就是 `]]`
 *   - 替换区间后还有 alias 段，如 `|alias]]`
 * @param suffixFromReplaceTo 从替换区间末尾开始直到行尾的文本。
 * @returns 闭合括号复用信息。
 */
export function resolveWikiLinkClosingBracketResolution(
    suffixFromReplaceTo: string,
): WikiLinkClosingBracketResolution {
    if (suffixFromReplaceTo.startsWith("]]")) {
        return {
            preserveClosingBrackets: true,
            closingBracketsImmediatelyAfterReplaceTo: true,
        };
    }

    if (/^\|[^\]\n]*\]\]/.test(suffixFromReplaceTo)) {
        return {
            preserveClosingBrackets: true,
            closingBracketsImmediatelyAfterReplaceTo: false,
        };
    }

    return {
        preserveClosingBrackets: false,
        closingBracketsImmediatelyAfterReplaceTo: false,
    };
}

function findLineEnd(docText: string, from: number): number {
    let lineEnd = from;
    while (lineEnd < docText.length && docText.charAt(lineEnd) !== "\n") {
        lineEnd++;
    }

    return lineEnd;
}

/**
 * @function resolveWikiLinkSuggestionAcceptanceAtCursor
 * @description 根据当前文档和光标位置重新计算接受补全时的替换规格，
 *   避免使用过时弹窗状态导致重复插入 `]]`。
 * @param docText 当前完整文档文本。
 * @param cursorPos 当前光标偏移。
 * @param itemTitle 被接受的建议标题。
 * @param fallbackMatch 弹窗状态中的兜底编辑区间信息。
 * @returns 当前文档上下文下的替换规格。
 */
export function resolveWikiLinkSuggestionAcceptanceAtCursor(
    docText: string,
    cursorPos: number,
    itemTitle: string,
    fallbackMatch: Pick<
        OpenWikiLinkMatch,
        "anchorPos"
        | "replaceTo"
        | "preserveClosingBrackets"
        | "closingBracketsImmediatelyAfterReplaceTo"
    >,
): WikiLinkSuggestionAcceptance {
    const detected = detectOpenWikiLink(docText, cursorPos);
    const effectiveMatch = detected ?? fallbackMatch;
    const lineEnd = findLineEnd(docText, cursorPos);
    const currentSuffix = docText.slice(effectiveMatch.replaceTo, lineEnd);
    const closingResolution = resolveWikiLinkClosingBracketResolution(currentSuffix);

    return buildWikiLinkSuggestionAcceptance(itemTitle, {
        ...effectiveMatch,
        preserveClosingBrackets: closingResolution.preserveClosingBrackets,
        closingBracketsImmediatelyAfterReplaceTo:
            closingResolution.closingBracketsImmediatelyAfterReplaceTo,
    });
}

/**
 * @function buildWikiLinkSuggestionAcceptance
 * @description 根据当前 WikiLink 编辑区间构建接受补全后的替换规格。
 * @param itemTitle 被接受的建议标题。
 * @param match 当前 WikiLink 编辑区间信息。
 * @returns 可直接用于 CodeMirror dispatch 的替换规格。
 */
export function buildWikiLinkSuggestionAcceptance(
    itemTitle: string,
    match: Pick<
        OpenWikiLinkMatch,
        "anchorPos" | "replaceTo" | "preserveClosingBrackets" | "closingBracketsImmediatelyAfterReplaceTo"
    >,
): WikiLinkSuggestionAcceptance {
    const insert = match.preserveClosingBrackets
        ? itemTitle
        : `${itemTitle}]]`;

    return {
        from: match.anchorPos,
        to: match.replaceTo,
        insert,
        selectionAnchor: match.anchorPos + insert.length + (match.closingBracketsImmediatelyAfterReplaceTo ? 2 : 0),
    };
}
