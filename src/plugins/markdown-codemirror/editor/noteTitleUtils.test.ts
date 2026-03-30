/**
 * @module plugins/markdown-codemirror/editor/noteTitleUtils.test
 * @description noteTitleUtils 单元测试：验证标题展示值与 Markdown 重命名目标路径的推导规则。
 */

import { describe, expect, test } from "bun:test";

import {
    resolveMarkdownNoteTitle,
    resolveRenamedMarkdownPath,
} from "./noteTitleUtils";

describe("resolveMarkdownNoteTitle", () => {
    test("移除 md 后缀用于顶部标题展示", () => {
        expect(resolveMarkdownNoteTitle("Entry/BlockChain.md")).toBe("BlockChain");
    });

    test("移除 markdown 后缀用于顶部标题展示", () => {
        expect(resolveMarkdownNoteTitle("Entry/BlockChain.markdown")).toBe("BlockChain");
    });

    test("保留非 Markdown 文件名原值", () => {
        expect(resolveMarkdownNoteTitle("Entry/BlockChain")).toBe("BlockChain");
    });
});

describe("resolveRenamedMarkdownPath", () => {
    test("未输入后缀时沿用当前 md 后缀", () => {
        expect(resolveRenamedMarkdownPath("Entry/BlockChain.md", "Blockchain Basics")).toBe(
            "Entry/Blockchain Basics.md",
        );
    });

    test("未输入后缀时沿用当前 markdown 后缀", () => {
        expect(resolveRenamedMarkdownPath("Entry/BlockChain.markdown", "Blockchain Basics")).toBe(
            "Entry/Blockchain Basics.markdown",
        );
    });

    test("显式输入 Markdown 后缀时直接采用草稿", () => {
        expect(resolveRenamedMarkdownPath("Entry/BlockChain.md", "Blockchain.md")).toBe(
            "Entry/Blockchain.md",
        );
    });

    test("空白标题返回 null", () => {
        expect(resolveRenamedMarkdownPath("Entry/BlockChain.md", "   ")).toBeNull();
    });
});