/**
 * @module plugins/markdown-codemirror/editor/editorWordBoundaries
 * @description 编辑器词边界工具：提供中英文混合文本的统一分词与 Vim 跳词逻辑。
 *
 * 核心概念：
 *   - `LineSegment`：将一行文本切分为连续、不重叠的片段，每个片段归类为
 *     `word`（中文词 / 英文单词）、`punctuation`（标点符号）或 `whitespace`（空白）。
 *   - `buildUnifiedLineSegments`：基于后端分词 token 与字符分类，生成覆盖整行的片段列表。
 *   - `findWordInLine`：在片段列表上模拟 Vim `findWord` 语义，查找行内词边界。
 *   - `getWordObjectRange`：为 `iw` / `aw` 文本对象计算词范围。
 *
 * @dependencies
 *  - ../../api/vaultApi（ChineseSegmentToken 类型）
 *
 * @exports
 *  - containsChineseCharacter — 中文字符检测
 *  - classifyChar — 单字符分类
 *  - buildUnifiedLineSegments — 统一行分词
 *  - findWordInLine — Vim 行内跳词查找
 *  - getWordObjectRange — Vim iw/aw 范围
 *  - resolveEnglishPreviousWordBoundary — Cmd+Backspace 英文删词边界
 *  - resolveChinesePreviousWordBoundary — Cmd+Backspace 中文删词边界
 *  - normalizeChineseMotionTokens — 旧接口（向后兼容）
 *  - getChineseWordRangeAtCursor — 旧接口（向后兼容）
 *  - resolveChineseMotionOffset — 旧接口（向后兼容）
 */

import type { ChineseSegmentToken } from "../../../api/vaultApi";

/* ------------------------------------------------------------------ */
/*  类型定义                                                           */
/* ------------------------------------------------------------------ */

/**
 * @description 行内片段的分类。
 *  - `word`：中文词或英文单词（连续 ASCII word 字符 / CJK 字符序列）
 *  - `punctuation`：标点或其他非空白、非单词字符
 *  - `whitespace`：空白字符
 */
export type SegmentKind = "word" | "punctuation" | "whitespace";

/**
 * @interface LineSegment
 * @description 行内的一个连续片段，start/end 为 UTF-16 code unit 偏移，end 为开区间。
 * @property start 起始偏移
 * @property end 结束偏移（开区间）
 * @property kind 片段分类
 */
export interface LineSegment {
    /** 起始偏移（UTF-16 code unit） */
    start: number;
    /** 结束偏移（开区间，UTF-16 code unit） */
    end: number;
    /** 片段分类 */
    kind: SegmentKind;
}

/**
 * @interface WordRange
 * @description 词范围，供 findWordInLine 返回。from ≤ to，均为行内 UTF-16 偏移。
 * @property from 词起始偏移
 * @property to 词结束偏移（开区间）
 */
export interface WordRange {
    /** 词起始偏移 */
    from: number;
    /** 词结束偏移（开区间） */
    to: number;
}

/* ------------------------------------------------------------------ */
/*  字符分类                                                           */
/* ------------------------------------------------------------------ */

/** CJK 统一汉字（含扩展 A 及兼容补充区） */
const CJK_REGEX = /[\u3400-\u9FFF\uF900-\uFAFF]/;

/** CJK 标点符号 */
const CJK_PUNCTUATION_REGEX = /[\u3000-\u303F\uFF00-\uFFEF\u2000-\u206F]/;

/** ASCII 单词字符 */
const ASCII_WORD_REGEX = /[A-Za-z0-9_]/;

/** 空白字符 */
const WHITESPACE_REGEX = /\s/;

/**
 * @function isCjkChar
 * @description 判断字符是否为 CJK 汉字。
 */
function isCjkChar(ch: string): boolean {
    return CJK_REGEX.test(ch);
}

/**
 * @function isCjkPunctuation
 * @description 判断字符是否为 CJK 标点（全角标点、中文标点等）。
 */
function isCjkPunctuation(ch: string): boolean {
    return CJK_PUNCTUATION_REGEX.test(ch);
}

/**
 * @function isAsciiWordCharacter
 * @description 判断字符是否属于 ASCII 单词字符（字母/数字/下划线）。
 */
function isAsciiWordCharacter(ch: string): boolean {
    return ASCII_WORD_REGEX.test(ch);
}

/**
 * @function isWhitespaceCharacter
 * @description 判断字符是否为空白字符。
 */
function isWhitespaceCharacter(ch: string): boolean {
    return WHITESPACE_REGEX.test(ch);
}

/**
 * @function classifyChar
 * @description 将单个字符归类为 SegmentKind。
 *   CJK 汉字 → word，ASCII 单词字符 → word，空白 → whitespace，其余 → punctuation。
 * @param ch 单字符
 * @returns 片段分类
 */
export function classifyChar(ch: string): SegmentKind {
    if (isWhitespaceCharacter(ch)) return "whitespace";
    if (isAsciiWordCharacter(ch)) return "word";
    if (isCjkChar(ch)) return "word";
    return "punctuation";
}

/**
 * @function containsChineseCharacter
 * @description 判断文本是否包含中文字符。
 * @param text 待检测文本
 * @returns 含中文返回 true
 */
export function containsChineseCharacter(text: string): boolean {
    return CJK_REGEX.test(text);
}

/* ------------------------------------------------------------------ */
/*  统一分词                                                           */
/* ------------------------------------------------------------------ */

/**
 * @function buildSegmentsFromChars
 * @description 无分词 token 时的回退策略：按字符分类连续合并生成片段。
 *   CJK 字符每个字单独成段（word），ASCII 单词字符连续合并，空白与标点各自连续合并。
 * @param lineText 行文本
 * @returns 覆盖整行的 LineSegment[]
 */
function buildSegmentsFromChars(lineText: string): LineSegment[] {
    if (lineText.length === 0) return [];

    const segments: LineSegment[] = [];
    let pos = 0;

    while (pos < lineText.length) {
        const ch = lineText.charAt(pos);

        // CJK 字符每字单独成段
        if (isCjkChar(ch)) {
            segments.push({ start: pos, end: pos + 1, kind: "word" });
            pos += 1;
            continue;
        }

        // CJK 标点每个独立成段
        if (isCjkPunctuation(ch)) {
            segments.push({ start: pos, end: pos + 1, kind: "punctuation" });
            pos += 1;
            continue;
        }

        // 同类字符连续合并
        const kind = classifyChar(ch);
        const segStart = pos;
        pos += 1;
        while (pos < lineText.length) {
            const next = lineText.charAt(pos);
            if (isCjkChar(next) || isCjkPunctuation(next)) break;
            if (classifyChar(next) !== kind) break;
            pos += 1;
        }
        segments.push({ start: segStart, end: pos, kind });
    }

    return segments;
}

/**
 * @function buildUnifiedLineSegments
 * @description 基于后端分词 token 与字符分类，生成覆盖整行的 LineSegment[]。
 *
 *   算法：
 *   1. 如果没有分词 token，退化为 buildSegmentsFromChars。
 *   2. 将分词 token 按 start 排序、去重（同一起点保留更长 token）。
 *   3. 遍历 token，对 token 间的间隙使用 buildSegmentsFromChars 填充。
 *   4. 对每个 token 进行子分段：确保不同字符类别不混合在同一 segment 中，
 *      同时保持 CJK 连续区域为一个整体（尊重分词结果）。
 *
 * @param lineText 行文本
 * @param tokens 后端分词 token（可为 null）
 * @returns 覆盖整行的 LineSegment[]
 */
export function buildUnifiedLineSegments(
    lineText: string,
    tokens: ChineseSegmentToken[] | null,
): LineSegment[] {
    if (lineText.length === 0) return [];
    if (!tokens || tokens.length === 0) return buildSegmentsFromChars(lineText);

    const deduped = deduplicateTokens(tokens);
    const segments: LineSegment[] = [];
    let cursor = 0;

    for (const token of deduped) {
        const tokenStart = Math.max(0, token.start);
        const tokenEnd = Math.min(lineText.length, token.end);
        if (tokenStart > tokenEnd) continue;

        // 填充间隙
        if (tokenStart > cursor) {
            pushShiftedSegments(segments, buildSegmentsFromChars(lineText.slice(cursor, tokenStart)), cursor);
        }

        if (tokenStart >= tokenEnd) {
            cursor = Math.max(cursor, tokenEnd);
            continue;
        }

        // 对 token 进行子分段
        const tokenText = lineText.slice(tokenStart, tokenEnd);
        const subSegments = splitTokenIntoSubSegments(tokenText, tokenStart);
        segments.push(...subSegments);
        cursor = Math.max(cursor, tokenEnd);
    }

    // 填充尾部间隙
    if (cursor < lineText.length) {
        pushShiftedSegments(segments, buildSegmentsFromChars(lineText.slice(cursor)), cursor);
    }

    return segments;
}

/**
 * 将偏移为 0 的子段列表平移到 baseOffset，并追加到目标数组。
 */
function pushShiftedSegments(target: LineSegment[], segs: LineSegment[], baseOffset: number): void {
    for (const seg of segs) {
        target.push({ start: seg.start + baseOffset, end: seg.end + baseOffset, kind: seg.kind });
    }
}

/**
 * 按 start 排序，同一起点保留最长 token。
 */
function deduplicateTokens(tokens: ChineseSegmentToken[]): ChineseSegmentToken[] {
    const map = new Map<number, ChineseSegmentToken>();
    for (const token of tokens) {
        if (token.end <= token.start) continue;
        const existing = map.get(token.start);
        if (!existing || token.end > existing.end) {
            map.set(token.start, token);
        }
    }
    return [...map.values()].sort((a, b) => a.start - b.start);
}

/**
 * @function splitTokenIntoSubSegments
 * @description 将单个 token 文本拆分为连续的子段。
 *   确保不同字符类别（CJK / ASCII word / punctuation / whitespace）不会混合在同一段。
 *   CJK 字符在同一个 token 内保持为一个 word segment（尊重分词结果）。
 */
function splitTokenIntoSubSegments(tokenText: string, baseOffset: number): LineSegment[] {
    if (tokenText.length === 0) return [];

    const segments: LineSegment[] = [];
    let pos = 0;

    while (pos < tokenText.length) {
        const ch = tokenText.charAt(pos);

        // CJK 连续区域保持为一个 word segment（尊重分词结果）
        if (isCjkChar(ch)) {
            const segStart = pos;
            pos += 1;
            while (pos < tokenText.length && isCjkChar(tokenText.charAt(pos))) {
                pos += 1;
            }
            segments.push({ start: baseOffset + segStart, end: baseOffset + pos, kind: "word" });
            continue;
        }

        if (isWhitespaceCharacter(ch)) {
            const segStart = pos;
            pos += 1;
            while (pos < tokenText.length && isWhitespaceCharacter(tokenText.charAt(pos))) {
                pos += 1;
            }
            segments.push({ start: baseOffset + segStart, end: baseOffset + pos, kind: "whitespace" });
            continue;
        }

        if (isAsciiWordCharacter(ch)) {
            const segStart = pos;
            pos += 1;
            while (pos < tokenText.length && isAsciiWordCharacter(tokenText.charAt(pos))) {
                pos += 1;
            }
            segments.push({ start: baseOffset + segStart, end: baseOffset + pos, kind: "word" });
            continue;
        }

        // 标点：CJK 标点每个独立，ASCII 标点连续合并
        if (isCjkPunctuation(ch)) {
            segments.push({ start: baseOffset + pos, end: baseOffset + pos + 1, kind: "punctuation" });
            pos += 1;
        } else {
            const segStart = pos;
            pos += 1;
            while (
                pos < tokenText.length &&
                !isCjkChar(tokenText.charAt(pos)) &&
                !isWhitespaceCharacter(tokenText.charAt(pos)) &&
                !isAsciiWordCharacter(tokenText.charAt(pos)) &&
                !isCjkPunctuation(tokenText.charAt(pos))
            ) {
                pos += 1;
            }
            segments.push({ start: baseOffset + segStart, end: baseOffset + pos, kind: "punctuation" });
        }
    }

    return segments;
}

/* ------------------------------------------------------------------ */
/*  Vim 跳词：findWordInLine                                           */
/* ------------------------------------------------------------------ */

/**
 * @function findWordInLine
 * @description 在 LineSegment[] 上执行 Vim `findWord` 语义——
 *   从 pos 出发，沿 forward/backward 方向查找下一个"词"段，
 *   返回该词的 `{ from, to }` 范围。
 *
 *   - 小词模式（w/b/e）：word 和 punctuation 为独立词，whitespace 跳过。
 *   - 大词模式（W/B/E）：连续非空白片段合并为一个大词。
 *
 * @param segments 行内片段列表
 * @param lineText 行文本
 * @param pos 光标行内 UTF-16 偏移
 * @param forward 向前（true）或向后（false）
 * @param bigWord 是否为大词模式（W/B/E）
 * @returns 找到的词范围，未找到返回 null
 */
export function findWordInLine(
    segments: LineSegment[],
    lineText: string,
    pos: number,
    forward: boolean,
    bigWord: boolean,
): WordRange | null {
    if (segments.length === 0 || lineText.length === 0) return null;
    return bigWord ? findBigWordInLine(segments, pos, forward) : findSmallWordInLine(segments, pos, forward);
}

/**
 * 小词模式（w/b/e）：word 和 punctuation 各自为独立词，whitespace 不是词。
 */
function findSmallWordInLine(segments: LineSegment[], pos: number, forward: boolean): WordRange | null {
    if (forward) {
        const curIdx = segments.findIndex((seg) => pos >= seg.start && pos < seg.end);

        // 从下一个 segment 开始找第一个非空白段
        const startIdx = curIdx >= 0 ? curIdx + 1 : segments.findIndex((seg) => seg.start > pos);
        if (startIdx < 0) return null;

        for (let i = startIdx; i < segments.length; i++) {
            if (segments[i].kind !== "whitespace") {
                return { from: segments[i].start, to: segments[i].end };
            }
        }
        return null;
    } else {
        // 向后搜索
        const curIdx = segments.findIndex((seg) => pos > seg.start && pos <= seg.end);

        // 如果光标在某个非空白 segment 内部（不在起始位置），该 segment 自身就是结果
        if (curIdx >= 0 && pos > segments[curIdx].start && segments[curIdx].kind !== "whitespace") {
            return { from: segments[curIdx].start, to: segments[curIdx].end };
        }

        // 从前面的 segment 中找第一个非空白段
        const searchFrom = curIdx >= 0 ? curIdx - 1 : findLastSegmentIndexBefore(segments, pos);
        for (let i = searchFrom; i >= 0; i--) {
            if (segments[i].kind !== "whitespace") {
                return { from: segments[i].start, to: segments[i].end };
            }
        }
        return null;
    }
}

/**
 * 大词模式（W/B/E）：连续非空白片段合并为一个大词。
 */
function findBigWordInLine(segments: LineSegment[], pos: number, forward: boolean): WordRange | null {
    const bigWords: WordRange[] = [];
    let i = 0;
    while (i < segments.length) {
        if (segments[i].kind === "whitespace") {
            i++;
            continue;
        }
        const from = segments[i].start;
        let to = segments[i].end;
        i++;
        while (i < segments.length && segments[i].kind !== "whitespace") {
            to = segments[i].end;
            i++;
        }
        bigWords.push({ from, to });
    }

    if (forward) {
        const curWord = bigWords.findIndex((w) => pos >= w.from && pos < w.to);
        const startIdx = curWord >= 0 ? curWord + 1 : bigWords.findIndex((w) => w.from > pos);
        if (startIdx < 0 || startIdx >= bigWords.length) return null;
        return bigWords[startIdx];
    } else {
        const curWord = bigWords.findIndex((w) => pos > w.from && pos <= w.to);
        if (curWord >= 0 && pos > bigWords[curWord].from) {
            return bigWords[curWord];
        }
        const searchFrom = curWord >= 0 ? curWord - 1 : findLastBigWordBefore(bigWords, pos);
        if (searchFrom < 0) return null;
        return bigWords[searchFrom];
    }
}

/** 找到 pos 之前最后一个 segment 的索引。 */
function findLastSegmentIndexBefore(segments: LineSegment[], pos: number): number {
    for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i].end <= pos) return i;
    }
    return -1;
}

/** 找到 pos 之前最后一个大词的索引。 */
function findLastBigWordBefore(bigWords: WordRange[], pos: number): number {
    for (let i = bigWords.length - 1; i >= 0; i--) {
        if (bigWords[i].to <= pos) return i;
    }
    return -1;
}

/* ------------------------------------------------------------------ */
/*  Vim iw/aw 文本对象                                                 */
/* ------------------------------------------------------------------ */

/**
 * @function getWordObjectRange
 * @description 为 Vim `iw` / `aw` 文本对象计算词范围。
 *   - inner（iw）：返回光标所在词的精确范围。
 *   - outer（aw）：返回光标所在词加上相邻空白的范围。
 *
 * @param lineText 行文本
 * @param lineOffset 光标行内偏移
 * @param tokens 分词 token（可为 null）
 * @param inclusive 是否为 outer（aw）模式
 * @returns 词范围 { start, end }，未找到返回 null
 */
export function getWordObjectRange(
    lineText: string,
    lineOffset: number,
    tokens: ChineseSegmentToken[] | null,
    inclusive: boolean,
): { start: number; end: number } | null {
    const segments = buildUnifiedLineSegments(lineText, tokens);
    if (segments.length === 0) return null;

    const clampedOffset = Math.max(0, Math.min(lineOffset, lineText.length - 1));

    // 找光标所在的 segment
    let segIdx = segments.findIndex((seg) => clampedOffset >= seg.start && clampedOffset < seg.end);
    if (segIdx < 0) {
        segIdx = segments.length - 1;
    }

    const seg = segments[segIdx];

    if (!inclusive) {
        // iw：选中光标所在段
        return { start: seg.start, end: seg.end };
    }

    // aw：选中词 + 相邻空白
    let start = seg.start;
    let end = seg.end;

    if (seg.kind === "whitespace") {
        if (segIdx + 1 < segments.length) {
            end = segments[segIdx + 1].end;
        }
        return { start, end };
    }

    // 光标在词/标点上 → 选中词 + 后面的空白（或前面的空白）
    if (segIdx + 1 < segments.length && segments[segIdx + 1].kind === "whitespace") {
        end = segments[segIdx + 1].end;
    } else if (segIdx - 1 >= 0 && segments[segIdx - 1].kind === "whitespace") {
        start = segments[segIdx - 1].start;
    }

    return { start, end };
}

/* ------------------------------------------------------------------ */
/*  向后兼容的旧接口                                                   */
/* ------------------------------------------------------------------ */

/**
 * @function normalizeChineseMotionTokens
 * @description 规范化分词 token：按起点去重并保留更长区间，只保留含中文的 token。
 *   此为向后兼容接口，新代码请使用 buildUnifiedLineSegments。
 */
export function normalizeChineseMotionTokens(
    lineText: string,
    tokens: ChineseSegmentToken[],
): ChineseSegmentToken[] {
    const tokenByStart = new Map<number, ChineseSegmentToken>();

    tokens
        .filter((token) => {
            if (token.end <= token.start) return false;
            const tokenText = token.word.length > 0 ? token.word : lineText.slice(token.start, token.end);
            return containsChineseCharacter(tokenText);
        })
        .forEach((token) => {
            const existing = tokenByStart.get(token.start);
            if (!existing || token.end > existing.end) {
                tokenByStart.set(token.start, token);
            }
        });

    return [...tokenByStart.values()].sort((left, right) => left.start - right.start);
}

/**
 * @function resolveEnglishPreviousWordBoundary
 * @description 计算英文/符号文本在给定光标前的删除边界（Cmd+Backspace）。
 */
export function resolveEnglishPreviousWordBoundary(lineText: string, lineOffset: number): number {
    if (lineOffset <= 0) return 0;

    let cursor = lineOffset;
    const previousChar = lineText.charAt(cursor - 1);

    if (isWhitespaceCharacter(previousChar)) {
        while (cursor > 0 && isWhitespaceCharacter(lineText.charAt(cursor - 1))) cursor -= 1;
        return cursor;
    }

    if (isAsciiWordCharacter(previousChar)) {
        while (cursor > 0 && isAsciiWordCharacter(lineText.charAt(cursor - 1))) cursor -= 1;
        return cursor;
    }

    while (cursor > 0) {
        const currentChar = lineText.charAt(cursor - 1);
        if (isWhitespaceCharacter(currentChar) || isAsciiWordCharacter(currentChar) || isCjkChar(currentChar)) break;
        cursor -= 1;
    }

    return cursor;
}

/**
 * @function resolveChinesePreviousWordBoundary
 * @description 基于中文分词结果计算给定光标前的删除边界（Cmd+Backspace）。
 */
export function resolveChinesePreviousWordBoundary(
    lineText: string,
    lineOffset: number,
    tokens: ChineseSegmentToken[] | null,
): number {
    if (lineOffset <= 0) return 0;

    const previousOffset = lineOffset - 1;
    if (!tokens || tokens.length === 0) return previousOffset;

    const normalizedTokens = normalizeChineseMotionTokens(lineText, tokens);
    if (normalizedTokens.length === 0) return previousOffset;

    const containingToken = normalizedTokens.find(
        (token) => previousOffset >= token.start && previousOffset < token.end,
    );
    if (containingToken) return containingToken.start;

    const alignedToken = normalizedTokens.find((token) => token.end === lineOffset);
    if (alignedToken) return alignedToken.start;

    return previousOffset;
}

/**
 * @function getChineseWordRangeAtCursor
 * @description 基于分词结果定位当前光标对应的词范围。
 *   此为向后兼容接口，新代码请使用 getWordObjectRange。
 */
export function getChineseWordRangeAtCursor(
    lineText: string,
    lineOffset: number,
    tokens: ChineseSegmentToken[] | null,
): { start: number; end: number } | null {
    return getWordObjectRange(lineText, lineOffset, tokens, false);
}

/**
 * @function resolveChineseMotionOffset
 * @description 统一计算 Vim 中文运动目标偏移，支持 w/b/e。
 *   此为向后兼容接口，新代码请使用 findWordInLine + buildUnifiedLineSegments。
 */
export function resolveChineseMotionOffset(
    key: "w" | "b" | "e",
    lineText: string,
    lineOffset: number,
    tokens: ChineseSegmentToken[] | null,
): number | null {
    const segments = buildUnifiedLineSegments(lineText, tokens);

    if (key === "w") {
        const word = findWordInLine(segments, lineText, lineOffset, true, false);
        return word ? word.from : null;
    }

    if (key === "b") {
        const word = findWordInLine(segments, lineText, lineOffset, false, false);
        return word ? word.from : null;
    }

    // e：移到当前词末尾或下一个词末尾
    const curSeg = segments.find((seg) => lineOffset >= seg.start && lineOffset < seg.end);
    if (curSeg && curSeg.kind !== "whitespace" && lineOffset < curSeg.end - 1) {
        return curSeg.end - 1;
    }
    const word = findWordInLine(segments, lineText, lineOffset, true, false);
    if (!word) return null;
    return Math.max(word.from, word.to - 1);
}
