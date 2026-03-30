import { describe, expect, test } from "bun:test";

import {
    isPlainFrontmatterVimKey,
    resolveFrontmatterEnterAction,
    resolveFrontmatterNavigationMove,
    shouldEnterFrontmatterFromBody,
} from "./frontmatterVimHandoff";

describe("isPlainFrontmatterVimKey", () => {
    test("应识别无修饰键的普通 Vim handoff 按键", () => {
        expect(isPlainFrontmatterVimKey({
            key: "k",
            metaKey: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
        }, "k")).toBe(true);
    });

    test("带修饰键时不应命中", () => {
        expect(isPlainFrontmatterVimKey({
            key: "k",
            metaKey: true,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
        }, "k")).toBe(false);
    });
});

describe("shouldEnterFrontmatterFromBody", () => {
    test("仅在 Vim normal 模式且位于正文首行时通过 k 进入 frontmatter", () => {
        expect(shouldEnterFrontmatterFromBody({
            key: "k",
            hasFrontmatter: true,
            currentLineNumber: 4,
            firstBodyLineNumber: 4,
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBe(true);
    });

    test("无 frontmatter 或不在首行时不应进入", () => {
        expect(shouldEnterFrontmatterFromBody({
            key: "k",
            hasFrontmatter: false,
            currentLineNumber: 4,
            firstBodyLineNumber: 4,
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBe(false);

        expect(shouldEnterFrontmatterFromBody({
            key: "k",
            hasFrontmatter: true,
            currentLineNumber: 5,
            firstBodyLineNumber: 4,
            isVimEnabled: true,
            isVimNormalMode: true,
        })).toBe(false);
    });
});

describe("resolveFrontmatterNavigationMove", () => {
    test("k 应向前移动，首项保持不动", () => {
        expect(resolveFrontmatterNavigationMove(2, 4, "previous")).toEqual({
            kind: "move",
            index: 1,
        });
        expect(resolveFrontmatterNavigationMove(0, 4, "previous")).toEqual({
            kind: "stay",
        });
    });

    test("j 应向后移动，末项时退出回正文", () => {
        expect(resolveFrontmatterNavigationMove(1, 4, "next")).toEqual({
            kind: "move",
            index: 2,
        });
        expect(resolveFrontmatterNavigationMove(3, 4, "next")).toEqual({
            kind: "exit-body",
        });
    });
});

describe("resolveFrontmatterEnterAction", () => {
    test("布尔字段应在导航层直接切换而不离开当前行", () => {
        expect(resolveFrontmatterEnterAction(true)).toBe("toggle-boolean");
        expect(resolveFrontmatterEnterAction(false)).toBe("toggle-boolean");
    });

    test("其他字段应进入实际值控件", () => {
        expect(resolveFrontmatterEnterAction("title")).toBe("focus-value");
        expect(resolveFrontmatterEnterAction(42)).toBe("focus-value");
        expect(resolveFrontmatterEnterAction(["a"])).toBe("focus-value");
    });
});