/**
 * @module plugins/markdown-codemirror/editor/handoff/registerBuiltinVimHandoffs
 * @description 内置 Vim handoff 注册入口：集中注册编辑器内置的结构边界与 widget 交互规则。
 * @dependencies
 *  - ./builtins/frontmatterBodyVimHandoff
 *  - ./builtins/latexBlockVimHandoff
 */

import { registerFrontmatterBodyVimHandoff } from "./builtins/frontmatterBodyVimHandoff";
import { registerLatexBlockVimHandoff } from "./builtins/latexBlockVimHandoff";
import { registerMarkdownTableBodyVimHandoff } from "./builtins/markdownTableBodyVimHandoff";

let registered = false;

export function ensureBuiltinVimHandoffsRegistered(): void {
    if (registered) {
        return;
    }

    registerFrontmatterBodyVimHandoff();
    registerLatexBlockVimHandoff();
    registerMarkdownTableBodyVimHandoff();
    registered = true;
}