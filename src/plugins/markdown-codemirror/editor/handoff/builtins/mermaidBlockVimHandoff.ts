/**
 * @module plugins/markdown-codemirror/editor/handoff/builtins/mermaidBlockVimHandoff
 * @description Mermaid fenced block 的 Vim handoff 注册项。
 */

import { resolveMermaidVimHandoffLine } from "../mermaidVimHandoff";
import {
    registerVimHandoff,
    VIM_HANDOFF_PRIORITY,
    type VimHandoffContext,
} from "../vimHandoffRegistry";

export function registerMermaidBlockVimHandoff(): () => void {
    return registerVimHandoff({
        id: "mermaid-block.enter-source",
        owner: "mermaid-block",
        surface: "editor-body",
        priority: VIM_HANDOFF_PRIORITY.blockWidget,
        description: "当 Vim normal 模式在 Mermaid 图相邻行按 j/k 时进入图源码。",
        resolve: (context: VimHandoffContext) => {
            const targetLineNumber = resolveMermaidVimHandoffLine({
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
                reason: "enter-adjacent-mermaid-source",
            };
        },
    });
}
