/**
 * @module plugins/markdown-codemirror/editor/editPlugins/wikilinkSuggestEditPlugin.test
 * @description WikiLink 自动补全编辑插件的单元测试。
 *   覆盖 detectOpenWikiLink 在各种输入场景下的检测行为。
 */

import { describe, expect, test } from "bun:test";
import { detectOpenWikiLink } from "./wikilinkSuggestUtils";

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
        });

        test("光标在 [[test 后面：检测到 'test' 查询", () => {
            const doc = "hello [[test";
            const result = detectOpenWikiLink(doc, doc.length);
            expect(result).not.toBeNull();
            expect(result!.query).toBe("test");
            expect(result!.anchorPos).toBe(8);
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
    });
});
