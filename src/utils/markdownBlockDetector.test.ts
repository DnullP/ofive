/**
 * @module utils/markdownBlockDetector.test
 * @description markdownBlockDetector 的单元测试：验证 frontmatter、
 *   围栏代码块、LaTeX 块的检测和行级排斥查询。
 */

import { describe, expect, test } from "bun:test";
import {
    detectExcludedLineRanges,
    isLineExcluded,
} from "./markdownBlockDetector";

/* ================================================================ */
/*  detectExcludedLineRanges                                        */
/* ================================================================ */

describe("detectExcludedLineRanges", () => {
    test("should return empty for plain text", () => {
        const text = "# Hello\nSome paragraph.\n## Another";
        expect(detectExcludedLineRanges(text)).toEqual([]);
    });

    test("should detect frontmatter at document start", () => {
        const text = "---\ntitle: Test\ndate: 2024\n---\n# Heading";
        const ranges = detectExcludedLineRanges(text);
        expect(ranges).toEqual([
            { fromLine: 1, toLine: 4, type: "frontmatter" },
        ]);
    });

    test("should NOT treat --- in the middle as frontmatter", () => {
        const text = "# Heading\n---\nsome text\n---";
        const ranges = detectExcludedLineRanges(text);
        expect(ranges).toEqual([]);
    });

    test("should detect a single code fence", () => {
        const text = "# Heading\n```js\nconsole.log('hi');\n```\nEnd";
        const ranges = detectExcludedLineRanges(text);
        expect(ranges).toEqual([
            { fromLine: 2, toLine: 4, type: "code-fence" },
        ]);
    });

    test("should detect tilde code fence", () => {
        const text = "~~~python\nprint('hi')\n~~~";
        const ranges = detectExcludedLineRanges(text);
        expect(ranges).toEqual([
            { fromLine: 1, toLine: 3, type: "code-fence" },
        ]);
    });

    test("should detect multiple code fences", () => {
        const text = "```\na\n```\ntext\n```\nb\n```";
        const ranges = detectExcludedLineRanges(text);
        expect(ranges).toEqual([
            { fromLine: 1, toLine: 3, type: "code-fence" },
            { fromLine: 5, toLine: 7, type: "code-fence" },
        ]);
    });

    test("should skip unclosed code fence", () => {
        const text = "```js\n# comment\nno closing";
        const ranges = detectExcludedLineRanges(text);
        expect(ranges).toEqual([]);
    });

    test("should detect LaTeX block", () => {
        const text = "Text\n$$\nE = mc^2\n$$\nEnd";
        const ranges = detectExcludedLineRanges(text);
        expect(ranges).toEqual([
            { fromLine: 2, toLine: 4, type: "latex-block" },
        ]);
    });

    test("should NOT detect $$ inside code fence", () => {
        const text = "```\n$$\nvalue\n$$\n```";
        const ranges = detectExcludedLineRanges(text);
        /* code fence takes priority; no latex-block should appear */
        expect(ranges).toEqual([
            { fromLine: 1, toLine: 5, type: "code-fence" },
        ]);
    });

    test("should detect frontmatter + code fence + latex block together", () => {
        const text = [
            "---",
            "title: Test",
            "---",
            "# Real heading",
            "```shell",
            "# not a heading",
            "echo hello",
            "```",
            "$$",
            "x^2",
            "$$",
            "## Another heading",
        ].join("\n");
        const ranges = detectExcludedLineRanges(text);
        expect(ranges).toEqual([
            { fromLine: 1, toLine: 3, type: "frontmatter" },
            { fromLine: 5, toLine: 8, type: "code-fence" },
            { fromLine: 9, toLine: 11, type: "latex-block" },
        ]);
    });

    test("should handle code fence with # comments (the original bug)", () => {
        const text = [
            "# Real Heading",
            "```shell",
            "# This is a shell comment",
            "apt-get install -y curl",
            "# Another comment",
            "```",
            "## Second Heading",
        ].join("\n");
        const ranges = detectExcludedLineRanges(text);
        expect(ranges).toEqual([
            { fromLine: 2, toLine: 6, type: "code-fence" },
        ]);
    });
});

/* ================================================================ */
/*  isLineExcluded                                                  */
/* ================================================================ */

describe("isLineExcluded", () => {
    const ranges = [
        { fromLine: 1, toLine: 3, type: "frontmatter" as const },
        { fromLine: 5, toLine: 8, type: "code-fence" as const },
    ];

    test("should return true for lines inside frontmatter", () => {
        expect(isLineExcluded(1, ranges)).toBe(true);
        expect(isLineExcluded(2, ranges)).toBe(true);
        expect(isLineExcluded(3, ranges)).toBe(true);
    });

    test("should return false for lines between blocks", () => {
        expect(isLineExcluded(4, ranges)).toBe(false);
    });

    test("should return true for lines inside code fence", () => {
        expect(isLineExcluded(5, ranges)).toBe(true);
        expect(isLineExcluded(6, ranges)).toBe(true);
        expect(isLineExcluded(7, ranges)).toBe(true);
        expect(isLineExcluded(8, ranges)).toBe(true);
    });

    test("should return false for lines after all blocks", () => {
        expect(isLineExcluded(9, ranges)).toBe(false);
        expect(isLineExcluded(100, ranges)).toBe(false);
    });

    test("should return false for empty ranges", () => {
        expect(isLineExcluded(1, [])).toBe(false);
    });
});

/* ================================================================ */
/*  集成场景：模拟 OutlinePanel 标题提取                                */
/* ================================================================ */

describe("integration: heading extraction with exclusion", () => {
    test("should only find real headings, not code block comments", () => {
        const text = [
            "---",
            "title: Test Note",
            "---",
            "# Introduction",
            "",
            "```shell",
            "# install dependencies",
            "apt-get update",
            "# setup config",
            "```",
            "",
            "## Conclusion",
            "",
            "$$",
            "# not a heading either",
            "$$",
        ].join("\n");

        const lines = text.split("\n");
        const ranges = detectExcludedLineRanges(text);
        const headings: Array<{ level: number; text: string; line: number }> = [];

        lines.forEach((line, index) => {
            const lineNumber = index + 1;
            if (isLineExcluded(lineNumber, ranges)) return;
            const m = line.match(/^(#{1,6})\s+(.+)$/);
            if (!m) return;
            headings.push({
                level: (m[1] ?? "#").length,
                text: (m[2] ?? "").trim(),
                line: lineNumber,
            });
        });

        expect(headings).toEqual([
            { level: 1, text: "Introduction", line: 4 },
            { level: 2, text: "Conclusion", line: 12 },
        ]);
    });
});
