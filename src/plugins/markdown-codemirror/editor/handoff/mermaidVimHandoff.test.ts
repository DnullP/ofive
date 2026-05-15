/**
 * @module plugins/markdown-codemirror/editor/handoff/mermaidVimHandoff.test
 * @description Mermaid fenced block Vim handoff 单元测试。
 */

import { describe, expect, test } from "bun:test";
import { resolveMermaidVimHandoffLine } from "./mermaidVimHandoff";

describe("resolveMermaidVimHandoffLine", () => {
    test("j should enter an adjacent mermaid fence from above", () => {
        expect(resolveMermaidVimHandoffLine({
            markdown: ["Before", "```mermaid", "graph TD", "```", "After"].join("\n"),
            currentLineNumber: 1,
            key: "j",
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBe(2);
    });

    test("k should enter an adjacent mermaid fence from below", () => {
        expect(resolveMermaidVimHandoffLine({
            markdown: ["Before", "```mermaid", "graph TD", "```", "After"].join("\n"),
            currentLineNumber: 5,
            key: "k",
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBe(4);
    });

    test("should support tilde fences and info string suffixes", () => {
        expect(resolveMermaidVimHandoffLine({
            markdown: ["Before", "~~~mermaid theme=dark", "flowchart LR", "~~~", "After"].join("\n"),
            currentLineNumber: 1,
            key: "j",
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBe(2);
    });

    test("should not hand off for non-mermaid code fences", () => {
        expect(resolveMermaidVimHandoffLine({
            markdown: ["Before", "```ts", "const x = 1;", "```", "After"].join("\n"),
            currentLineNumber: 1,
            key: "j",
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBeNull();
    });

    test("should not hand off outside Vim normal mode", () => {
        expect(resolveMermaidVimHandoffLine({
            markdown: "Before\n```mermaid\ngraph TD\n```\nAfter",
            currentLineNumber: 1,
            key: "j",
            isVimEnabled: true,
            isVimNormalMode: false,
        })).toBeNull();
    });
});
