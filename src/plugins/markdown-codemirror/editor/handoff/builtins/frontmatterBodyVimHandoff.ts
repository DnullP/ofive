/**
 * @module plugins/markdown-codemirror/editor/handoff/builtins/frontmatterBodyVimHandoff
 * @description frontmatter 正文边界的 Vim handoff 注册项。
 *   负责将正文首行按 `k` 的 Vim 导航移交给 frontmatter 导航层。
 * @dependencies
 *  - ../frontmatterVimHandoff
 *  - ../vimHandoffRegistry
 */

import { shouldEnterFrontmatterFromBody } from "../frontmatterVimHandoff";
import {
    registerVimHandoff,
    VIM_HANDOFF_PRIORITY,
    type VimHandoffContext,
} from "../vimHandoffRegistry";

export function registerFrontmatterBodyVimHandoff(): () => void {
    return registerVimHandoff({
        id: "frontmatter.body-enter-navigation",
        owner: "frontmatter",
        surface: "editor-body",
        priority: VIM_HANDOFF_PRIORITY.structuralBoundary,
        description: "当光标位于正文首行时，将 Vim 的 k 导航移交给 frontmatter 导航层。",
        resolve: (context: VimHandoffContext) => {
            const shouldEnter = shouldEnterFrontmatterFromBody({
                key: context.key,
                hasFrontmatter: context.hasFrontmatter,
                currentLineNumber: context.currentLineNumber,
                firstBodyLineNumber: context.firstBodyLineNumber,
                isVimEnabled: context.isVimEnabled,
                isVimNormalMode: context.isVimNormalMode,
            });

            if (!shouldEnter) {
                return null;
            }

            return {
                kind: "focus-widget-navigation" as const,
                widget: "frontmatter" as const,
                position: "last" as const,
                reason: "enter-frontmatter-from-body",
            };
        },
    });
}