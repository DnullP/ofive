/**
 * @module plugins/markdown-codemirror/editor/vimChineseMotionExtension
 * @description Vim 中英文混合跳词扩展：通过 Vim.defineMotion / Vim._mapCommand
 *   注册增强的 `moveByWords` 与 `iw/aw` 文本对象，替换 vim 默认的跳词行为。
 *
 *   核心设计：
 *     1. 使用 `Vim.defineMotion` 注册 `enhancedMoveByWords` 运动函数，
 *        内部通过 `buildUnifiedLineSegments` + `findWordInLine` 实现基于分词的跳词逻辑。
 *     2. 通过 `Vim._mapCommand` 将 w/b/e/W/B/E 以及 iw/aw 重新映射到增强运动。
 *     3. 使用 WeakMap<EditorView, TokenProvider> 让不同编辑器实例各自使用自己的分词缓存。
 *     4. 因为 `defineMotion` 直接集成到 vim 运动系统中，所以 `dw/cw/yw` 等
 *        操作符+运动组合也能自动获得中文分词支持，无需 DOM 事件拦截。
 *
 * @dependencies
 *  - @replit/codemirror-vim（Vim API）
 *  - codemirror（EditorView）
 *  - ./editorWordBoundaries（统一分词 + 行内跳词）
 *  - ../../api/vaultApi（ChineseSegmentToken 类型）
 *
 * @exports
 *  - registerVimTokenProvider — 注册编辑器实例的分词缓存回调
 *  - setupVimEnhancedMotions — 注册增强运动（仅调用一次）
 */

import { EditorView } from "codemirror";
import { Vim } from "@replit/codemirror-vim";
import type { ChineseSegmentToken } from "../../../api/vaultApi";
import {
    buildUnifiedLineSegments,
    findWordInLine,
    getWordObjectRange,
} from "./editorWordBoundaries";

/* ------------------------------------------------------------------ */
/*  Token Provider 注册表                                              */
/* ------------------------------------------------------------------ */

/**
 * @typedef TokenProviderFn
 * @description 获取指定行分词 token 的回调函数。返回 null 表示缓存未命中。
 */
type TokenProviderFn = (lineNumber: number, lineText: string) => ChineseSegmentToken[] | null;

/**
 * 每个 EditorView 实例对应一个 TokenProvider，通过 WeakMap 关联。
 * WeakMap 确保编辑器销毁后自动释放。
 */
const tokenProviders = new WeakMap<EditorView, TokenProviderFn>();

/**
 * @function registerVimTokenProvider
 * @description 为指定 EditorView 实例注册分词缓存回调。
 *   应在编辑器创建时调用。
 * @param view EditorView 实例
 * @param provider 获取行 token 的回调
 */
export function registerVimTokenProvider(view: EditorView, provider: TokenProviderFn): void {
    tokenProviders.set(view, provider);
}

/**
 * @function unregisterVimTokenProvider
 * @description 注销指定 EditorView 的分词缓存回调。
 *   应在编辑器销毁时调用。
 * @param view EditorView 实例
 */
export function unregisterVimTokenProvider(view: EditorView): void {
    tokenProviders.delete(view);
}

/**
 * 获取 EditorView 的行分词 token。
 * lineNumber 使用 1-based（与 CodeMirror doc.lineAt 一致）。
 */
function getTokensForView(
    view: EditorView,
    lineNumber: number,
    lineText: string,
): ChineseSegmentToken[] | null {
    const provider = tokenProviders.get(view);
    return provider?.(lineNumber, lineText) ?? null;
}

/* ------------------------------------------------------------------ */
/*  增强运动：moveByWords                                              */
/* ------------------------------------------------------------------ */

/** 防止重复注册。 */
let motionsRegistered = false;

/**
 * @function setupVimEnhancedMotions
 * @description 注册增强的 Vim 运动函数，替换默认 w/b/e/W/B/E 和 iw/aw 行为。
 *   全局只需调用一次（由模块级守卫保证幂等）。
 *
 *   注册的运动：
 *   - `enhancedMoveByWords`：跳词（w/b/e/W/B/E），支持中英文混合分词。
 *     通过 `buildUnifiedLineSegments` 将每行文本拆分为 word/punctuation/whitespace
 *     片段，再用 `findWordInLine` 定位下一个词边界。支持跨行。
 *   - `enhancedInnerWord`：iw 文本对象，基于统一分词的 inner word 选择。
 *   - `enhancedOuterWord`：aw 文本对象，基于统一分词的 outer word 选择。
 *
 * @sideEffects
 *   - 调用 Vim.defineMotion 注册 3 个新运动
 *   - 调用 Vim._mapCommand 将 8 个按键映射到新运动
 */
export function setupVimEnhancedMotions(): void {
    if (motionsRegistered) return;
    motionsRegistered = true;

    // -------- 运动：enhancedMoveByWords --------
    // MotionFn: (cm, head, motionArgs, vim, inputState) => Pos | [Pos, Pos] | null
    Vim.defineMotion(
        "enhancedMoveByWords",
        (
            cm: { cm6: EditorView; getLine: (n: number) => string; lastLine: () => number },
            head: { line: number; ch: number },
            motionArgs: {
                repeat: number;
                forward?: boolean;
                wordEnd?: boolean;
                bigWord?: boolean;
            },
        ) => {
            const view = cm.cm6 as EditorView;
            const forward = !!motionArgs.forward;
            const wordEnd = !!motionArgs.wordEnd;
            const bigWord = !!motionArgs.bigWord;
            const repeat = motionArgs.repeat || 1;

            let curLine = head.line;
            let curCh = head.ch;

            for (let rep = 0; rep < repeat; rep++) {
                const moved = moveByWordsOnce(view, cm, curLine, curCh, forward, wordEnd, bigWord);
                if (!moved) break;
                curLine = moved.line;
                curCh = moved.ch;
            }

            return { line: curLine, ch: curCh };
        },
    );

    // -------- 文本对象：enhancedInnerWord (iw) --------
    Vim.defineMotion(
        "enhancedInnerWord",
        (
            cm: { cm6: EditorView; getLine: (n: number) => string },
            head: { line: number; ch: number },
            _motionArgs: { repeat: number },
        ) => {
            const view = cm.cm6 as EditorView;
            const lineText = cm.getLine(head.line);
            // vim 使用 0-based line，getLineTokens 使用 1-based
            const tokens = getTokensForView(view, head.line + 1, lineText);
            const range = getWordObjectRange(lineText, head.ch, tokens, false);

            if (!range) return head;

            // 返回 [anchor, head] 元组表示选区
            return [
                { line: head.line, ch: range.start },
                { line: head.line, ch: range.end },
            ] as [{ line: number; ch: number }, { line: number; ch: number }];
        },
    );

    // -------- 文本对象：enhancedOuterWord (aw) --------
    Vim.defineMotion(
        "enhancedOuterWord",
        (
            cm: { cm6: EditorView; getLine: (n: number) => string },
            head: { line: number; ch: number },
            _motionArgs: { repeat: number },
        ) => {
            const view = cm.cm6 as EditorView;
            const lineText = cm.getLine(head.line);
            const tokens = getTokensForView(view, head.line + 1, lineText);
            const range = getWordObjectRange(lineText, head.ch, tokens, true);

            if (!range) return head;

            return [
                { line: head.line, ch: range.start },
                { line: head.line, ch: range.end },
            ] as [{ line: number; ch: number }, { line: number; ch: number }];
        },
    );

    // -------- 按键映射：w/b/e/W/B/E → enhancedMoveByWords --------
    //  _mapCommand 会 unshift 到默认键表前端，优先于内置映射。
    Vim._mapCommand({
        keys: "w",
        type: "motion",
        motion: "enhancedMoveByWords",
        motionArgs: { forward: true, wordEnd: false },
    });
    Vim._mapCommand({
        keys: "b",
        type: "motion",
        motion: "enhancedMoveByWords",
        motionArgs: { forward: false, wordEnd: false },
    });
    Vim._mapCommand({
        keys: "e",
        type: "motion",
        motion: "enhancedMoveByWords",
        motionArgs: { forward: true, wordEnd: true, inclusive: true },
    });
    Vim._mapCommand({
        keys: "W",
        type: "motion",
        motion: "enhancedMoveByWords",
        motionArgs: { forward: true, wordEnd: false, bigWord: true },
    });
    Vim._mapCommand({
        keys: "B",
        type: "motion",
        motion: "enhancedMoveByWords",
        motionArgs: { forward: false, wordEnd: false, bigWord: true },
    });
    Vim._mapCommand({
        keys: "E",
        type: "motion",
        motion: "enhancedMoveByWords",
        motionArgs: { forward: true, wordEnd: true, bigWord: true, inclusive: true },
    });

    // -------- 按键映射：iw/aw → enhancedInnerWord/enhancedOuterWord --------
    Vim._mapCommand({
        keys: "iw",
        type: "motion",
        motion: "enhancedInnerWord",
        motionArgs: { textObjectInner: true },
    });
    Vim._mapCommand({
        keys: "aw",
        type: "motion",
        motion: "enhancedOuterWord",
        motionArgs: { textObjectInner: false },
    });

    console.info("[vim] enhanced Chinese/English word motions registered");
}

/* ------------------------------------------------------------------ */
/*  跳词单步逻辑                                                       */
/* ------------------------------------------------------------------ */

/**
 * @function moveByWordsOnce
 * @description 执行一次跳词运动（支持跨行）。
 *
 *   行为说明：
 *   - forward + !wordEnd (w)：移到下一个词的起始位置
 *   - forward + wordEnd (e)：移到当前/下一个词的末尾位置
 *   - !forward + !wordEnd (b)：移到当前/上一个词的起始位置
 *   - !forward + wordEnd (ge)：移到上一个词的末尾位置
 *
 *   当行内无法找到目标词时，自动跨行查找。
 *
 * @param view EditorView 实例
 * @param cm CodeMirror 适配器
 * @param line 当前行号（0-based）
 * @param ch 当前列号
 * @param forward 前进方向
 * @param wordEnd 是否到词尾
 * @param bigWord 是否大词模式
 * @returns 目标位置，无法移动返回 null
 */
function moveByWordsOnce(
    view: EditorView,
    cm: { getLine: (n: number) => string; lastLine: () => number },
    line: number,
    ch: number,
    forward: boolean,
    wordEnd: boolean,
    bigWord: boolean,
): { line: number; ch: number } | null {
    const lastLine = cm.lastLine();
    let curLine = line;
    let curCh = ch;

    // 最多搜索全部行数，防止无限循环
    const maxLineSearch = lastLine + 1;

    for (let attempt = 0; attempt < maxLineSearch; attempt++) {
        const lineText = cm.getLine(curLine);
        const tokens = getTokensForView(view, curLine + 1, lineText);
        const segments = buildUnifiedLineSegments(lineText, tokens);

        if (forward) {
            if (!wordEnd) {
                // w：找下一个词的起始
                const word = findWordInLine(segments, lineText, curCh, true, bigWord);
                if (word) return { line: curLine, ch: word.from };
            } else {
                // e：找当前词末尾或下一个词末尾
                const curSeg = segments.find((seg) => curCh >= seg.start && curCh < seg.end);
                if (curSeg && curSeg.kind !== "whitespace" && curCh < curSeg.end - 1) {
                    return { line: curLine, ch: curSeg.end - 1 };
                }
                const word = findWordInLine(segments, lineText, curCh, true, bigWord);
                if (word) return { line: curLine, ch: Math.max(word.from, word.to - 1) };
            }

            // 跨到下一行
            if (curLine >= lastLine) return null;
            curLine += 1;
            curCh = 0;

            // 空行处理：Vim 将空行视为一个"词"（对 w 运动）
            if (!wordEnd && cm.getLine(curLine).length === 0) {
                return { line: curLine, ch: 0 };
            }
        } else {
            if (!wordEnd) {
                // b：找当前/上一个词的起始
                const word = findWordInLine(segments, lineText, curCh, false, bigWord);
                if (word) return { line: curLine, ch: word.from };
            } else {
                // ge：找上一个词的末尾
                const curSeg = segments.find((seg) => curCh > seg.start && curCh <= seg.end);
                if (curSeg && curSeg.kind !== "whitespace" && curCh > curSeg.start) {
                    // 如果在词内部，先到词尾不对，ge 要找前一个词尾
                }
                // 从 pos 向后找非空白段的末尾
                const word = findWordInLine(segments, lineText, curCh, false, bigWord);
                if (word && word.to - 1 < curCh) {
                    return { line: curLine, ch: word.to - 1 };
                }
                // 如果当前段不满足，需要跨行
                if (word) {
                    // 找到的是 curCh 之前的的词但头部，再找它前面一个词
                    const prevWord = findWordInLine(segments, lineText, word.from, false, bigWord);
                    if (prevWord && prevWord.to - 1 < curCh) {
                        return { line: curLine, ch: prevWord.to - 1 };
                    }
                }
            }

            // 跨到上一行
            if (curLine <= 0) return null;
            curLine -= 1;
            curCh = cm.getLine(curLine).length;

            // 空行处理
            if (cm.getLine(curLine).length === 0) {
                return { line: curLine, ch: 0 };
            }
        }
    }

    return null;
}

