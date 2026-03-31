/**
 * @module plugins/markdown-codemirror/editor/handoff/builtins/latexBlockVimHandoff
 * @description 块级 LaTeX 的 Vim handoff 注册项。
 *   负责将紧邻块级 LaTeX 的 `j/k` 导航移交为“进入源码并展开 widget”。
 * @dependencies
 *  - ../latexVimHandoff
 *  - ../vimHandoffRegistry
 */

import { resolveLatexVimHandoffLine } from "../latexVimHandoff";
import {
    registerVimHandoff,
    VIM_HANDOFF_PRIORITY,
    type VimHandoffContext,
} from "../vimHandoffRegistry";

export function registerLatexBlockVimHandoff(): () => void {
    return registerVimHandoff({
        id: "latex-block.enter-source",
        owner: "latex-block",
        surface: "editor-body",
        priority: VIM_HANDOFF_PRIORITY.blockWidget,
        description: "当 Vim normal 模式在块级 LaTeX 相邻行按 j/k 时进入公式源码。",
        resolve: (context: VimHandoffContext) => {
            const targetLineNumber = resolveLatexVimHandoffLine({
                markdown: context.markdown,
                currentLineNumber: context.currentLineNumber,
                key: context.key,
                isVimEnabled: context.isVimEnabled,
                isVimNormalMode: context.isVimNormalMode,
            });

            if (targetLineNumber === null) {
                return null;
            }

            return {
                kind: "move-selection" as const,
                targetLineNumber,
                reason: "enter-adjacent-latex-source",
            };
        },
    });
}