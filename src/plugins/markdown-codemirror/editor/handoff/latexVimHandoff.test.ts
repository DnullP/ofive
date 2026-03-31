/**
 * @module plugins/markdown-codemirror/editor/handoff/latexVimHandoff.test
 * @description 块级 LaTeX Vim handoff 纯逻辑单元测试。
 */

import { describe, expect, test } from "bun:test";
import { resolveLatexVimHandoffLine } from "./latexVimHandoff";

describe("resolveLatexVimHandoffLine", () => {
    test("j should enter an adjacent single-line block latex from above", () => {
        expect(resolveLatexVimHandoffLine({
            markdown: ["Before", "$$x^2$$", "After"].join("\n"),
            currentLineNumber: 1,
            key: "j",
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBe(2);
    });

    test("j should enter an adjacent multi-line block latex from above", () => {
        expect(resolveLatexVimHandoffLine({
            markdown: ["Before", "$$", "x^2", "$$", "After"].join("\n"),
            currentLineNumber: 1,
            key: "j",
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBe(2);
    });

    test("k should enter an adjacent multi-line block latex from below", () => {
        expect(resolveLatexVimHandoffLine({
            markdown: ["Before", "$$", "x^2", "$$", "After"].join("\n"),
            currentLineNumber: 5,
            key: "k",
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBe(4);
    });

    test("should not hand off when the adjacent line is not block latex", () => {
        expect(resolveLatexVimHandoffLine({
            markdown: ["Before", "plain text", "$$x^2$$"].join("\n"),
            currentLineNumber: 1,
            key: "j",
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBeNull();
    });

    test("should not hand off outside Vim normal mode", () => {
        expect(resolveLatexVimHandoffLine({
            markdown: "Before\n$$x^2$$\nAfter",
            currentLineNumber: 1,
            key: "j",
            isVimEnabled: true,
            isVimNormalMode: false,
        })).toBeNull();
    });
});