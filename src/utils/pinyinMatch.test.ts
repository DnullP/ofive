/**
 * @module utils/pinyinMatch.test
 * @description pinyinMatch 工具回归测试，覆盖全拼、首字母、无中文及非拼音查询场景。
 *
 * @dependencies
 *  - bun:test
 *  - ./pinyinMatch
 *
 * @run
 *   bun test src/utils/pinyinMatch.test.ts
 */

import { describe, expect, test } from "bun:test";
import { containsChinese, looksLikePinyin, scorePinyinMatch } from "./pinyinMatch";

describe("containsChinese", () => {
    test("中文文本返回 true", () => {
        expect(containsChinese("日记")).toBe(true);
        expect(containsChinese("hello世界")).toBe(true);
    });

    test("纯 ASCII 返回 false", () => {
        expect(containsChinese("hello")).toBe(false);
        expect(containsChinese("2024-01-01")).toBe(false);
    });
});

describe("looksLikePinyin", () => {
    test("纯字母返回 true", () => {
        expect(looksLikePinyin("riji")).toBe(true);
        expect(looksLikePinyin("ri ji")).toBe(true);
    });

    test("含数字或中文返回 false", () => {
        expect(looksLikePinyin("riji123")).toBe(false);
        expect(looksLikePinyin("日记")).toBe(false);
    });

    test("空白串返回 false", () => {
        expect(looksLikePinyin("   ")).toBe(false);
    });
});

describe("scorePinyinMatch", () => {
    test("全拼完全匹配得分最高", () => {
        const score = scorePinyinMatch("日记", "riji");
        expect(score).toBe(100);
    });

    test("全拼前缀匹配", () => {
        const score = scorePinyinMatch("日记本", "riji");
        expect(score).toBe(80);
    });

    test("首字母完全匹配", () => {
        const score = scorePinyinMatch("日记", "rj");
        expect(score).toBe(70);
    });

    test("首字母前缀匹配", () => {
        const score = scorePinyinMatch("日记本子", "rjb");
        expect(score).toBe(55);
    });

    test("全拼包含匹配", () => {
        const score = scorePinyinMatch("我的日记", "riji");
        expect(score).toBe(60);
    });

    test("首字母包含匹配", () => {
        const score = scorePinyinMatch("我的日记", "rj");
        expect(score).toBe(40);
    });

    test("无中文文本返回 null", () => {
        expect(scorePinyinMatch("hello", "hello")).toBeNull();
    });

    test("非拼音查询返回 null", () => {
        expect(scorePinyinMatch("日记", "123")).toBeNull();
        expect(scorePinyinMatch("日记", "日记")).toBeNull();
    });

    test("空查询返回 null", () => {
        expect(scorePinyinMatch("日记", "")).toBeNull();
        expect(scorePinyinMatch("日记", "  ")).toBeNull();
    });

    test("不匹配的拼音返回 null", () => {
        expect(scorePinyinMatch("日记", "xuesheng")).toBeNull();
    });
});
