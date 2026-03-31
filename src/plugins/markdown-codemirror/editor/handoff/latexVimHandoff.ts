/**
 * @module plugins/markdown-codemirror/editor/handoff/latexVimHandoff
 * @description Vim normal 模式下块级 LaTeX 相邻行 handoff 逻辑。
 *   当光标位于块级 LaTeX 紧邻的上一行或下一行时，按 `j` / `k` 应直接进入
 *   LaTeX 源码区域，触发 widget 回退到源码编辑态。
 * @dependencies
 *  - ../../../utils/markdownBlockDetector
 *
 * @example
 *   const targetLine = resolveLatexVimHandoffLine({
 *       markdown: "before\n$$x^2$$\nafter",
 *       currentLineNumber: 1,
 *       key: "j",
 *       isVimEnabled: true,
 *       isVimNormalMode: true,
 *   });
 *   // => 2
 */

import { detectExcludedLineRanges } from "../../../../utils/markdownBlockDetector";

export interface ResolveLatexVimHandoffLineOptions {
    markdown: string;
    currentLineNumber: number;
    key: string;
    isVimEnabled: boolean;
    isVimNormalMode: boolean;
}

export function resolveLatexVimHandoffLine(
    options: ResolveLatexVimHandoffLineOptions,
): number | null {
    if (!options.isVimEnabled || !options.isVimNormalMode) {
        return null;
    }

    if (options.key !== "j" && options.key !== "k") {
        return null;
    }

    const targetLineNumber = options.key === "j"
        ? options.currentLineNumber + 1
        : Math.max(1, options.currentLineNumber - 1);

    const latexRange = detectExcludedLineRanges(options.markdown).find((range) =>
        range.type === "latex-block"
        && targetLineNumber >= range.fromLine
        && targetLineNumber <= range.toLine,
    );

    return latexRange ? targetLineNumber : null;
}