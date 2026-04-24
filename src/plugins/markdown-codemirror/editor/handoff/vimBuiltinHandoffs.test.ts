/**
 * @module plugins/markdown-codemirror/editor/handoff/vimBuiltinHandoffs.test
 * @description 内置 Vim handoff 注册项测试：验证 frontmatter / LaTeX 规则在注册中心中的实际解析结果。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { registerFrontmatterBodyVimHandoff } from "./builtins/frontmatterBodyVimHandoff";
import { registerLatexBlockVimHandoff } from "./builtins/latexBlockVimHandoff";
import { registerMarkdownTableBodyVimHandoff } from "./builtins/markdownTableBodyVimHandoff";
import { resolveRegisteredVimHandoff } from "./vimHandoffRegistry";

const cleanupCallbacks: Array<() => void> = [];

afterEach(() => {
    while (cleanupCallbacks.length > 0) {
        cleanupCallbacks.pop()?.();
    }
});

describe("builtin vim handoffs", () => {
    test("frontmatter body handoff should resolve to focus-widget-navigation", () => {
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
            kind: "focus-widget-navigation",
            widget: "frontmatter",
            position: "last",
            reason: "enter-frontmatter-from-body",
        });
    });

    test("markdown table body handoff should resolve to focus-widget-navigation", () => {
        cleanupCallbacks.push(registerMarkdownTableBodyVimHandoff());

        expect(resolveRegisteredVimHandoff({
            surface: "editor-body",
            key: "j",
            markdown: ["Before", "| Name | Status |", "| --- | --- |", "| Demo | Open |", "After"].join("\n"),
            currentLineNumber: 1,
            selectionHead: 0,
            hasFrontmatter: false,
            firstBodyLineNumber: 1,
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toEqual({
            kind: "focus-widget-navigation",
            widget: "markdown-table",
            position: "first",
            blockFrom: 7,
            reason: "enter-markdown-table-from-body",
        });
    });

    test("markdown table body handoff should cross blank lines above the table", () => {
        cleanupCallbacks.push(registerMarkdownTableBodyVimHandoff());

        expect(resolveRegisteredVimHandoff({
            surface: "editor-body",
            key: "j",
            markdown: [
                "Before paragraph",
                "",
                "| Name | Status |",
                "| --- | --- |",
                "| Demo | Open |",
                "After",
            ].join("\n"),
            currentLineNumber: 1,
            selectionHead: 0,
            hasFrontmatter: false,
            firstBodyLineNumber: 1,
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toEqual({
            kind: "focus-widget-navigation",
            widget: "markdown-table",
            position: "first",
            blockFrom: 18,
            reason: "enter-markdown-table-from-body",
        });
    });

    test("markdown table body handoff should cross blank lines below the table", () => {
        cleanupCallbacks.push(registerMarkdownTableBodyVimHandoff());

        expect(resolveRegisteredVimHandoff({
            surface: "editor-body",
            key: "k",
            markdown: [
                "Before",
                "| Name | Status |",
                "| --- | --- |",
                "| Demo | Open |",
                "",
                "After paragraph",
            ].join("\n"),
            currentLineNumber: 6,
            selectionHead: 0,
            hasFrontmatter: false,
            firstBodyLineNumber: 1,
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toEqual({
            kind: "focus-widget-navigation",
            widget: "markdown-table",
            position: "last",
            blockFrom: 7,
            reason: "enter-markdown-table-from-body",
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