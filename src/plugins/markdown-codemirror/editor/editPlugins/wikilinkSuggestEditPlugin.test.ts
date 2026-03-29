/**
 * @module plugins/markdown-codemirror/editor/editPlugins/wikilinkSuggestEditPlugin.test
 * @description WikiLink 自动补全编辑插件的单元测试。
 *   覆盖 detectOpenWikiLink 在各种输入场景下的检测行为。
 */

import { describe, expect, test } from "bun:test";
import {
    buildWikiLinkSuggestionAcceptance,
    detectOpenWikiLink,
    resolveWikiLinkClosingBracketResolution,
    resolveWikiLinkSuggestionAcceptanceAtCursor,
} from "./wikilinkSuggestUtils";

/* ================================================================== */
/*  detectOpenWikiLink                                                */
/* ================================================================== */

describe("detectOpenWikiLink", () => {
    describe("基础检测", () => {
        test("光标在 [[ 后面：检测到空查询", () => {
            const doc = "hello [[";
            const result = detectOpenWikiLink(doc, doc.length);
            expect(result).not.toBeNull();
            expect(result!.query).toBe("");
            expect(result!.anchorPos).toBe(8); // [[ 之后
            expect(result!.replaceTo).toBe(doc.length);
        });

        test("光标在 [[test 后面：检测到 'test' 查询", () => {
            const doc = "hello [[test";
            const result = detectOpenWikiLink(doc, doc.length);
            expect(result).not.toBeNull();
            expect(result!.query).toBe("test");
            expect(result!.anchorPos).toBe(8);
            expect(result!.replaceTo).toBe(doc.length);
        });

        test("光标在 [[中文笔记 后面：检测到中文查询", () => {
            const doc = "hello [[中文笔记";
            const result = detectOpenWikiLink(doc, doc.length);
            expect(result).not.toBeNull();
            expect(result!.query).toBe("中文笔记");
        });

        test("没有 [[ 时返回 null", () => {
            const doc = "hello world";
            expect(detectOpenWikiLink(doc, doc.length)).toBeNull();
        });

        test("单个 [ 不触发", () => {
            const doc = "hello [test";
            expect(detectOpenWikiLink(doc, doc.length)).toBeNull();
        });
    });

    describe("已闭合 wikilink", () => {
        test("光标在已闭合 [[test]] 后面不触发", () => {
            const doc = "hello [[test]] world";
            expect(detectOpenWikiLink(doc, doc.length)).toBeNull();
        });

        test("光标在 [[test]] 内部仍触发（编辑已有链接）", () => {
            // 光标在 test 中间位置
            const doc = "hello [[test]]";
            const cursorPos = 10; // te|st 之间
            const result = detectOpenWikiLink(doc, cursorPos);
            expect(result).not.toBeNull();
            expect(result!.query).toBe("te");
            expect(result!.replaceTo).toBe(12);
            expect(result!.preserveClosingBrackets).toBe(true);
            expect(result!.closingBracketsImmediatelyAfterReplaceTo).toBe(true);
        });
    });

    describe("多行文档", () => {
        test("[[ 在上一行不触发", () => {
            const doc = "first [[line\nsecond line";
            const cursorPos = doc.length; // 光标在第二行末尾
            expect(detectOpenWikiLink(doc, cursorPos)).toBeNull();
        });

        test("[[ 在当前行触发", () => {
            const doc = "first line\nsecond [[note";
            const cursorPos = doc.length;
            const result = detectOpenWikiLink(doc, cursorPos);
            expect(result).not.toBeNull();
            expect(result!.query).toBe("note");
        });
    });

    describe("边界情况", () => {
        test("空文档", () => {
            expect(detectOpenWikiLink("", 0)).toBeNull();
        });

        test("光标在行首", () => {
            const doc = "hello [[test";
            expect(detectOpenWikiLink(doc, 0)).toBeNull();
        });

        test("[[ 在行首", () => {
            const doc = "[[note";
            const result = detectOpenWikiLink(doc, doc.length);
            expect(result).not.toBeNull();
            expect(result!.query).toBe("note");
            expect(result!.anchorPos).toBe(2);
            expect(result!.replaceTo).toBe(doc.length);
        });

        test("多个 [[ 取最后一个", () => {
            const doc = "[[first]] then [[second";
            const result = detectOpenWikiLink(doc, doc.length);
            expect(result).not.toBeNull();
            expect(result!.query).toBe("second");
        });

        test("图片嵌入 ![[image 也能检测", () => {
            // 补全不区分是否有 ! 前缀（补全时可以忽略前缀）
            const doc = "![[image";
            const result = detectOpenWikiLink(doc, doc.length);
            expect(result).not.toBeNull();
            expect(result!.query).toBe("image");
        });

        test("含竖线的 wikilink", () => {
            const doc = "[[target|display";
            const result = detectOpenWikiLink(doc, doc.length);
            expect(result).not.toBeNull();
            expect(result!.query).toBe("target|display");
        });

        test("光标位于已闭合 wikilink 中间时，替换范围会吞掉右侧尾部", () => {
            const doc = "[[123456]]";
            const cursorPos = 5; // [[123|456]]
            const result = detectOpenWikiLink(doc, cursorPos);

            expect(result).not.toBeNull();
            expect(result).toEqual({
                query: "123",
                anchorPos: 2,
                replaceTo: 8,
                preserveClosingBrackets: true,
                closingBracketsImmediatelyAfterReplaceTo: true,
            });
        });

        test("编辑 target 且后面存在 alias 时，替换范围会停在 | 之前", () => {
            const doc = "[[target|alias]]";
            const cursorPos = 5; // [[tar|get|alias]]
            const result = detectOpenWikiLink(doc, cursorPos);

            expect(result).not.toBeNull();
            expect(result).toEqual({
                query: "tar",
                anchorPos: 2,
                replaceTo: 8,
                preserveClosingBrackets: true,
                closingBracketsImmediatelyAfterReplaceTo: false,
            });
        });
    });
});

describe("buildWikiLinkSuggestionAcceptance", () => {
    test("中间位置接受补全时会清理右侧残留文本", () => {
        const acceptance = buildWikiLinkSuggestionAcceptance("Note", {
            anchorPos: 2,
            replaceTo: 8,
            preserveClosingBrackets: true,
            closingBracketsImmediatelyAfterReplaceTo: true,
        });

        expect(acceptance).toEqual({
            from: 2,
            to: 8,
            insert: "Note",
            selectionAnchor: 8,
        });
    });

    test("未闭合 wikilink 接受补全时会自动补上 ]]", () => {
        const acceptance = buildWikiLinkSuggestionAcceptance("Note", {
            anchorPos: 2,
            replaceTo: 6,
            preserveClosingBrackets: false,
            closingBracketsImmediatelyAfterReplaceTo: false,
        });

        expect(acceptance).toEqual({
            from: 2,
            to: 6,
            insert: "Note]]",
            selectionAnchor: 8,
        });
    });

    test("target 后存在 alias 时只替换 target 段", () => {
        const acceptance = buildWikiLinkSuggestionAcceptance("Note", {
            anchorPos: 2,
            replaceTo: 8,
            preserveClosingBrackets: true,
            closingBracketsImmediatelyAfterReplaceTo: false,
        });

        expect(acceptance).toEqual({
            from: 2,
            to: 8,
            insert: "Note",
            selectionAnchor: 6,
        });
    });
});

describe("resolveWikiLinkClosingBracketResolution", () => {
    test("立即存在 ]] 时应复用闭合括号并跨过它", () => {
        expect(resolveWikiLinkClosingBracketResolution("]] more")).toEqual({
            preserveClosingBrackets: true,
            closingBracketsImmediatelyAfterReplaceTo: true,
        });
    });

    test("alias 后存在 ]] 时应复用闭合括号但不额外跨过 alias", () => {
        expect(resolveWikiLinkClosingBracketResolution("|alias]]")).toEqual({
            preserveClosingBrackets: true,
            closingBracketsImmediatelyAfterReplaceTo: false,
        });
    });

    test("不存在 ]] 时应要求补全自行补上闭合括号", () => {
        expect(resolveWikiLinkClosingBracketResolution("|alias")).toEqual({
            preserveClosingBrackets: false,
            closingBracketsImmediatelyAfterReplaceTo: false,
        });
    });
});

describe("resolveWikiLinkSuggestionAcceptanceAtCursor", () => {
    test("自动补全生成的 [[]] 在中间接受补全时不应重复追加 ]]", () => {
        const acceptance = resolveWikiLinkSuggestionAcceptanceAtCursor(
            "[[]]",
            2,
            "123",
            {
                anchorPos: 2,
                replaceTo: 2,
                preserveClosingBrackets: false,
                closingBracketsImmediatelyAfterReplaceTo: false,
            },
        );

        expect(acceptance).toEqual({
            from: 2,
            to: 2,
            insert: "123",
            selectionAnchor: 7,
        });
    });

    test("即使弹窗状态滞后，alias 后已有 ]] 时也不应重复追加", () => {
        const acceptance = resolveWikiLinkSuggestionAcceptanceAtCursor(
            "[[target|alias]]",
            5,
            "Note",
            {
                anchorPos: 2,
                replaceTo: 5,
                preserveClosingBrackets: false,
                closingBracketsImmediatelyAfterReplaceTo: false,
            },
        );

        expect(acceptance).toEqual({
            from: 2,
            to: 8,
            insert: "Note",
            selectionAnchor: 6,
        });
    });
});
