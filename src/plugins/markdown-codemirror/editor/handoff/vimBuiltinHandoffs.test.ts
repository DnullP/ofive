/**
 * @module plugins/markdown-codemirror/editor/handoff/vimBuiltinHandoffs.test
 * @description 内置 Vim handoff 注册项测试：验证 frontmatter / LaTeX 规则在注册中心中的实际解析结果。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { registerFrontmatterBodyVimHandoff } from "./builtins/frontmatterBodyVimHandoff";
import { registerLatexBlockVimHandoff } from "./builtins/latexBlockVimHandoff";
import { resolveRegisteredVimHandoff } from "./vimHandoffRegistry";

const cleanupCallbacks: Array<() => void> = [];

afterEach(() => {
    while (cleanupCallbacks.length > 0) {
        cleanupCallbacks.pop()?.();
    }
});

describe("builtin vim handoffs", () => {
    test("frontmatter body handoff should resolve to focus-frontmatter-navigation", () => {
        cleanupCallbacks.push(registerFrontmatterBodyVimHandoff());

        expect(resolveRegisteredVimHandoff({
            surface: "editor-body",
            key: "k",
            markdown: "---\ntitle: Demo\n---\nBody",
            currentLineNumber: 4,
            selectionHead: 0,
            hasFrontmatter: true,
            firstBodyLineNumber: 4,
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toEqual({
            kind: "focus-frontmatter-navigation",
            position: "last",
            reason: "enter-frontmatter-from-body",
        });
    });

    test("latex block handoff should resolve to move-selection", () => {
        cleanupCallbacks.push(registerLatexBlockVimHandoff());

        expect(resolveRegisteredVimHandoff({
            surface: "editor-body",
            key: "j",
            markdown: ["Before", "$$x^2$$", "After"].join("\n"),
            currentLineNumber: 1,
            selectionHead: 0,
            hasFrontmatter: false,
            firstBodyLineNumber: 1,
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toEqual({
            kind: "move-selection",
            targetLineNumber: 2,
            reason: "enter-adjacent-latex-source",
        });
    });
});