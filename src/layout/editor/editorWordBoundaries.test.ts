/**
 * @module layout/editor/editorWordBoundaries.test
 * @description editorWordBoundaries 模块的单元测试。
 *   覆盖统一分词、Vim 跳词、iw/aw 文本对象在纯中文、纯英文、中英文混合等场景下的行为。
 */

import { describe, expect, test } from "bun:test";
import type { ChineseSegmentToken } from "../../api/vaultApi";
import {
    classifyChar,
    buildUnifiedLineSegments,
    findWordInLine,
    getWordObjectRange,
    containsChineseCharacter,
    resolveChineseMotionOffset,
    getChineseWordRangeAtCursor,
    type LineSegment,
} from "./editorWordBoundaries";

/* ------------------------------------------------------------------ */
/*  辅助工具                                                           */
/* ------------------------------------------------------------------ */

/** 构造分词 token 的快捷函数 */
function tok(word: string, start: number, end: number): ChineseSegmentToken {
    return { word, start, end };
}

/** 提取 segments 的 kind 列表，用于快速断言 */
function kinds(segments: LineSegment[]): string[] {
    return segments.map((s) => s.kind);
}

/** 提取 segments 对应的文本切片 */
function texts(lineText: string, segments: LineSegment[]): string[] {
    return segments.map((s) => lineText.slice(s.start, s.end));
}

/* ================================================================== */
/*  classifyChar                                                      */
/* ================================================================== */

describe("classifyChar", () => {
    test("ASCII word characters → word", () => {
        expect(classifyChar("a")).toBe("word");
        expect(classifyChar("Z")).toBe("word");
        expect(classifyChar("0")).toBe("word");
        expect(classifyChar("_")).toBe("word");
    });

    test("CJK characters → word", () => {
        expect(classifyChar("中")).toBe("word");
        expect(classifyChar("文")).toBe("word");
        expect(classifyChar("你")).toBe("word");
    });

    test("whitespace → whitespace", () => {
        expect(classifyChar(" ")).toBe("whitespace");
        expect(classifyChar("\t")).toBe("whitespace");
        expect(classifyChar("\n")).toBe("whitespace");
    });

    test("punctuation → punctuation", () => {
        expect(classifyChar(",")).toBe("punctuation");
        expect(classifyChar("!")).toBe("punctuation");
        expect(classifyChar("-")).toBe("punctuation");
        expect(classifyChar("#")).toBe("punctuation");
    });
});

/* ================================================================== */
/*  containsChineseCharacter                                          */
/* ================================================================== */

describe("containsChineseCharacter", () => {
    test("纯英文不含中文", () => {
        expect(containsChineseCharacter("hello world")).toBe(false);
    });

    test("含中文返回 true", () => {
        expect(containsChineseCharacter("hello 世界")).toBe(true);
        expect(containsChineseCharacter("你好")).toBe(true);
    });

    test("空文本不含中文", () => {
        expect(containsChineseCharacter("")).toBe(false);
    });
});

/* ================================================================== */
/*  buildUnifiedLineSegments — 无 token（回退模式）                     */
/* ================================================================== */

describe("buildUnifiedLineSegments without tokens", () => {
    test("空文本返回空数组", () => {
        expect(buildUnifiedLineSegments("", null)).toEqual([]);
    });

    test("纯英文：连续 ASCII word 字符合并", () => {
        const segs = buildUnifiedLineSegments("hello world", null);
        expect(texts("hello world", segs)).toEqual(["hello", " ", "world"]);
        expect(kinds(segs)).toEqual(["word", "whitespace", "word"]);
    });

    test("纯中文：每字单独成段", () => {
        const segs = buildUnifiedLineSegments("你好世界", null);
        expect(texts("你好世界", segs)).toEqual(["你", "好", "世", "界"]);
        expect(kinds(segs)).toEqual(["word", "word", "word", "word"]);
    });

    test("中英文混合", () => {
        const line = "hello世界test";
        const segs = buildUnifiedLineSegments(line, null);
        expect(texts(line, segs)).toEqual(["hello", "世", "界", "test"]);
        expect(kinds(segs)).toEqual(["word", "word", "word", "word"]);
    });

    test("标点分隔", () => {
        const line = "hello,world";
        const segs = buildUnifiedLineSegments(line, null);
        expect(texts(line, segs)).toEqual(["hello", ",", "world"]);
        expect(kinds(segs)).toEqual(["word", "punctuation", "word"]);
    });

    test("中文标点每个独立", () => {
        const line = "你好！世界。";
        const segs = buildUnifiedLineSegments(line, null);
        expect(texts(line, segs)).toEqual(["你", "好", "！", "世", "界", "。"]);
    });

    test("Markdown 标题标记", () => {
        const line = "## 标题";
        const segs = buildUnifiedLineSegments(line, null);
        expect(texts(line, segs)).toEqual(["##", " ", "标", "题"]);
        expect(kinds(segs)).toEqual(["punctuation", "whitespace", "word", "word"]);
    });
});

/* ================================================================== */
/*  buildUnifiedLineSegments — 有分词 token                            */
/* ================================================================== */

describe("buildUnifiedLineSegments with tokens", () => {
    test("纯中文分词：尊重 token 边界", () => {
        // "我是一个学生" → 分词为 ["我", "是", "一个", "学生"]
        const line = "我是一个学生";
        const tokens = [
            tok("我", 0, 1),
            tok("是", 1, 2),
            tok("一个", 2, 4),
            tok("学生", 4, 6),
        ];
        const segs = buildUnifiedLineSegments(line, tokens);
        expect(texts(line, segs)).toEqual(["我", "是", "一个", "学生"]);
        expect(kinds(segs)).toEqual(["word", "word", "word", "word"]);
    });

    test("中英文混合分词", () => {
        // "我是developer" → ["我", "是", "developer"]
        const line = "我是developer";
        const tokens = [
            tok("我", 0, 1),
            tok("是", 1, 2),
            tok("developer", 2, 11),
        ];
        const segs = buildUnifiedLineSegments(line, tokens);
        expect(texts(line, segs)).toEqual(["我", "是", "developer"]);
        expect(kinds(segs)).toEqual(["word", "word", "word"]);
    });

    test("含空格和标点的混合分词", () => {
        // "hello 世界！test" → ["hello", " ", "世界", "！", "test"]
        const line = "hello 世界！test";
        const tokens = [
            tok("hello", 0, 5),
            tok(" ", 5, 6),
            tok("世界", 6, 8),
            tok("！", 8, 9),
            tok("test", 9, 13),
        ];
        const segs = buildUnifiedLineSegments(line, tokens);
        expect(texts(line, segs)).toEqual(["hello", " ", "世界", "！", "test"]);
        expect(kinds(segs)).toEqual(["word", "whitespace", "word", "punctuation", "word"]);
    });

    test("token 间隙用字符分析填充", () => {
        // 假设 token 只覆盖了中文部分，英文部分由间隙填充逻辑处理
        const line = "abc中文def";
        const tokens = [tok("中文", 3, 5)];
        const segs = buildUnifiedLineSegments(line, tokens);
        expect(texts(line, segs)).toEqual(["abc", "中文", "def"]);
        expect(kinds(segs)).toEqual(["word", "word", "word"]);
    });

    test("重复/重叠 token 去重", () => {
        const line = "你好世界";
        const tokens = [
            tok("你好", 0, 2),
            tok("你", 0, 1), // 同起点更短，应被忽略
            tok("世界", 2, 4),
        ];
        const segs = buildUnifiedLineSegments(line, tokens);
        expect(texts(line, segs)).toEqual(["你好", "世界"]);
        expect(kinds(segs)).toEqual(["word", "word"]);
    });

    test("空 token 数组退化为字符分析", () => {
        const line = "hello";
        const segs = buildUnifiedLineSegments(line, []);
        expect(texts(line, segs)).toEqual(["hello"]);
        expect(kinds(segs)).toEqual(["word"]);
    });
});

/* ================================================================== */
/*  findWordInLine — 小词模式（w/b/e）                                 */
/* ================================================================== */

describe("findWordInLine (small word)", () => {
    // "hello world test"
    // segs: [hello(0,5)] [' '(5,6)] [world(6,11)] [' '(11,12)] [test(12,16)]
    const line = "hello world test";
    const segs = buildUnifiedLineSegments(line, null);

    describe("forward (w)", () => {
        test("从 hello 起始跳到 world", () => {
            const w = findWordInLine(segs, line, 0, true, false);
            expect(w).toEqual({ from: 6, to: 11 });
        });

        test("从 hello 中间跳到 world", () => {
            const w = findWordInLine(segs, line, 2, true, false);
            expect(w).toEqual({ from: 6, to: 11 });
        });

        test("从 world 跳到 test", () => {
            const w = findWordInLine(segs, line, 6, true, false);
            expect(w).toEqual({ from: 12, to: 16 });
        });

        test("从最后一个词无法继续", () => {
            const w = findWordInLine(segs, line, 12, true, false);
            expect(w).toBeNull();
        });
    });

    describe("backward (b)", () => {
        test("从 test 起始跳到 world", () => {
            const w = findWordInLine(segs, line, 12, false, false);
            expect(w).toEqual({ from: 6, to: 11 });
        });

        test("从 world 中间跳到 word 起始", () => {
            const w = findWordInLine(segs, line, 8, false, false);
            expect(w).toEqual({ from: 6, to: 11 });
        });

        test("从 world 起始跳到 hello", () => {
            const w = findWordInLine(segs, line, 6, false, false);
            expect(w).toEqual({ from: 0, to: 5 });
        });

        test("从 hello 起始无法继续", () => {
            const w = findWordInLine(segs, line, 0, false, false);
            expect(w).toBeNull();
        });
    });
});

describe("findWordInLine with Chinese segments", () => {
    // "我是一个developer测试"
    // tokens: ["我", "是", "一个", "developer", "测试"]
    const line = "我是一个developer测试";
    const tokens = [
        tok("我", 0, 1),
        tok("是", 1, 2),
        tok("一个", 2, 4),
        tok("developer", 4, 13),
        tok("测试", 13, 15),
    ];
    const segs = buildUnifiedLineSegments(line, tokens);

    test("w 从 我 跳到 是", () => {
        const w = findWordInLine(segs, line, 0, true, false);
        expect(w).toEqual({ from: 1, to: 2 });
    });

    test("w 从 一个 跳到 developer", () => {
        const w = findWordInLine(segs, line, 2, true, false);
        expect(w).toEqual({ from: 4, to: 13 });
    });

    test("w 从 developer 跳到 测试", () => {
        const w = findWordInLine(segs, line, 4, true, false);
        expect(w).toEqual({ from: 13, to: 15 });
    });

    test("b 从 测试 跳到 developer", () => {
        const w = findWordInLine(segs, line, 13, false, false);
        expect(w).toEqual({ from: 4, to: 13 });
    });

    test("b 从 developer 中间跳到 developer 起始", () => {
        const w = findWordInLine(segs, line, 7, false, false);
        expect(w).toEqual({ from: 4, to: 13 });
    });

    test("b 从 developer 起始跳到 一个", () => {
        const w = findWordInLine(segs, line, 4, false, false);
        expect(w).toEqual({ from: 2, to: 4 });
    });
});

describe("findWordInLine with punctuation", () => {
    // "hello, world! 你好。"
    const line = "hello, world! 你好。";
    const tokens = [
        tok("hello", 0, 5),
        tok(",", 5, 6),
        tok(" ", 6, 7),
        tok("world", 7, 12),
        tok("!", 12, 13),
        tok(" ", 13, 14),
        tok("你好", 14, 16),
        tok("。", 16, 17),
    ];
    const segs = buildUnifiedLineSegments(line, tokens);

    test("w 从 hello 跳到逗号（标点是独立词）", () => {
        const w = findWordInLine(segs, line, 0, true, false);
        expect(w).toEqual({ from: 5, to: 6 });
    });

    test("w 从逗号跳到 world", () => {
        const w = findWordInLine(segs, line, 5, true, false);
        expect(w).toEqual({ from: 7, to: 12 });
    });

    test("w 从 world 跳到感叹号", () => {
        const w = findWordInLine(segs, line, 7, true, false);
        expect(w).toEqual({ from: 12, to: 13 });
    });

    test("w 从感叹号跳到你好", () => {
        const w = findWordInLine(segs, line, 12, true, false);
        expect(w).toEqual({ from: 14, to: 16 });
    });
});

/* ================================================================== */
/*  findWordInLine — 大词模式（W/B/E）                                 */
/* ================================================================== */

describe("findWordInLine (big word)", () => {
    // "hello,world  你好。世界"
    // 大词模式：连续非空白段合并
    // 大词1: "hello,world"(0,11), 大词2: "你好。世界"(13,18)
    const line = "hello,world  你好。世界";
    const tokens = [
        tok("hello", 0, 5),
        tok(",", 5, 6),
        tok("world", 6, 11),
        tok(" ", 11, 12),
        tok(" ", 12, 13),
        tok("你好", 13, 15),
        tok("。", 15, 16),
        tok("世界", 16, 18),
    ];
    const segs = buildUnifiedLineSegments(line, tokens);

    test("W 从 hello,world 跳到 你好。世界", () => {
        const w = findWordInLine(segs, line, 0, true, true);
        expect(w).toEqual({ from: 13, to: 18 });
    });

    test("W 从 hello,world 中间跳到 你好。世界", () => {
        const w = findWordInLine(segs, line, 6, true, true);
        expect(w).toEqual({ from: 13, to: 18 });
    });

    test("B 从 你好。世界 跳到 hello,world", () => {
        const w = findWordInLine(segs, line, 13, false, true);
        expect(w).toEqual({ from: 0, to: 11 });
    });

    test("B 从最后跳到所在大词起始", () => {
        const w = findWordInLine(segs, line, 17, false, true);
        expect(w).toEqual({ from: 13, to: 18 });
    });
});

/* ================================================================== */
/*  getWordObjectRange — iw/aw                                        */
/* ================================================================== */

describe("getWordObjectRange", () => {
    describe("iw (inner word)", () => {
        test("中文词内选中整个词", () => {
            const line = "我是一个学生";
            const tokens = [
                tok("我", 0, 1),
                tok("是", 1, 2),
                tok("一个", 2, 4),
                tok("学生", 4, 6),
            ];
            const range = getWordObjectRange(line, 3, tokens, false);
            expect(range).toEqual({ start: 2, end: 4 }); // "一个"
        });

        test("英文词内选中整个词", () => {
            const line = "hello world";
            const range = getWordObjectRange(line, 2, null, false);
            expect(range).toEqual({ start: 0, end: 5 }); // "hello"
        });

        test("混合文本中选中英文词", () => {
            const line = "我是developer测试";
            const tokens = [
                tok("我", 0, 1),
                tok("是", 1, 2),
                tok("developer", 2, 11),
                tok("测试", 11, 13),
            ];
            const range = getWordObjectRange(line, 5, tokens, false);
            expect(range).toEqual({ start: 2, end: 11 }); // "developer"
        });

        test("光标在空白上选中空白段", () => {
            const line = "hello  world";
            const range = getWordObjectRange(line, 5, null, false);
            expect(range).toEqual({ start: 5, end: 7 }); // "  "
        });

        test("光标在标点上选中标点段", () => {
            const line = "hello,world";
            const range = getWordObjectRange(line, 5, null, false);
            expect(range).toEqual({ start: 5, end: 6 }); // ","
        });
    });

    describe("aw (outer word)", () => {
        test("选中词 + 后面空白", () => {
            const line = "hello world";
            const range = getWordObjectRange(line, 2, null, true);
            expect(range).toEqual({ start: 0, end: 6 }); // "hello "
        });

        test("末尾词无后面空白时选中前面空白", () => {
            const line = "hello world";
            const range = getWordObjectRange(line, 8, null, true);
            // "world" 没有后面空白，选前面空白
            expect(range).toEqual({ start: 5, end: 11 }); // " world"
        });
    });
});

/* ================================================================== */
/*  resolveChineseMotionOffset — 向后兼容                              */
/* ================================================================== */

describe("resolveChineseMotionOffset (backward compat)", () => {
    test("w 返回下一个词起始", () => {
        const line = "我是一个学生";
        const tokens = [
            tok("我", 0, 1),
            tok("是", 1, 2),
            tok("一个", 2, 4),
            tok("学生", 4, 6),
        ];
        expect(resolveChineseMotionOffset("w", line, 0, tokens)).toBe(1);
        expect(resolveChineseMotionOffset("w", line, 1, tokens)).toBe(2);
        expect(resolveChineseMotionOffset("w", line, 2, tokens)).toBe(4);
    });

    test("b 返回上一个词起始", () => {
        const line = "我是一个学生";
        const tokens = [
            tok("我", 0, 1),
            tok("是", 1, 2),
            tok("一个", 2, 4),
            tok("学生", 4, 6),
        ];
        expect(resolveChineseMotionOffset("b", line, 6, tokens)).toBe(4);
        expect(resolveChineseMotionOffset("b", line, 4, tokens)).toBe(2);
        expect(resolveChineseMotionOffset("b", line, 2, tokens)).toBe(1);
    });

    test("e 返回当前词末尾", () => {
        const line = "我是一个学生";
        const tokens = [
            tok("我", 0, 1),
            tok("是", 1, 2),
            tok("一个", 2, 4),
            tok("学生", 4, 6),
        ];
        // 在 "一个" 起始(2)，e 应到 "一个" 末尾(3)
        expect(resolveChineseMotionOffset("e", line, 2, tokens)).toBe(3);
    });

    test("无 token 时 w 逐字前进", () => {
        const line = "你好";
        expect(resolveChineseMotionOffset("w", line, 0, null)).toBe(1);
    });
});

/* ================================================================== */
/*  getChineseWordRangeAtCursor — 向后兼容                             */
/* ================================================================== */

describe("getChineseWordRangeAtCursor (backward compat)", () => {
    test("有 token 时返回所在 token 范围", () => {
        const line = "我是一个学生";
        const tokens = [
            tok("我", 0, 1),
            tok("是", 1, 2),
            tok("一个", 2, 4),
            tok("学生", 4, 6),
        ];
        expect(getChineseWordRangeAtCursor(line, 3, tokens)).toEqual({ start: 2, end: 4 });
    });

    test("无 token 时退化为字符级范围", () => {
        const line = "你好世界";
        const range = getChineseWordRangeAtCursor(line, 1, null);
        // 无 token 每字一段，光标在 "好"(1) 上，应返回 {start:1,end:2}
        expect(range).toEqual({ start: 1, end: 2 });
    });
});

/* ================================================================== */
/*  复杂场景集成测试                                                   */
/* ================================================================== */

describe("complex mixed text scenarios", () => {
    test("Markdown 标题行分词", () => {
        const line = "## 这是标题 Title";
        const tokens = [
            tok("##", 0, 2),
            tok(" ", 2, 3),
            tok("这是", 3, 5),
            tok("标题", 5, 7),
            tok(" ", 7, 8),
            tok("Title", 8, 13),
        ];
        const segs = buildUnifiedLineSegments(line, tokens);
        expect(texts(line, segs)).toEqual(["##", " ", "这是", "标题", " ", "Title"]);

        // w 从 ## 跳到 这是
        const w1 = findWordInLine(segs, line, 0, true, false);
        expect(w1).toEqual({ from: 3, to: 5 });

        // w 从 标题 跳到 Title
        const w2 = findWordInLine(segs, line, 5, true, false);
        expect(w2).toEqual({ from: 8, to: 13 });
    });

    test("URL 中的标点处理", () => {
        const line = "访问 https://example.com 获取";
        // 模拟 jieba 对这行的分词
        const tokens = [
            tok("访问", 0, 2),
            tok(" ", 2, 3),
            tok("https", 3, 8),
            tok("://", 8, 11),
            tok("example", 11, 18),
            tok(".", 18, 19),
            tok("com", 19, 22),
            tok(" ", 22, 23),
            tok("获取", 23, 25),
        ];
        const segs = buildUnifiedLineSegments(line, tokens);
        expect(kinds(segs)).toEqual([
            "word", "whitespace", "word", "punctuation",
            "word", "punctuation", "word", "whitespace", "word",
        ]);
    });

    test("纯数字与中文混合", () => {
        const line = "第1个测试 2024年";
        const tokens = [
            tok("第", 0, 1),
            tok("1", 1, 2),
            tok("个", 2, 3),
            tok("测试", 3, 5),
            tok(" ", 5, 6),
            tok("2024", 6, 10),
            tok("年", 10, 11),
        ];
        const segs = buildUnifiedLineSegments(line, tokens);
        expect(texts(line, segs)).toEqual(["第", "1", "个", "测试", " ", "2024", "年"]);

        // w 从 "第" 跳到 "1"
        const w1 = findWordInLine(segs, line, 0, true, false);
        expect(w1).toEqual({ from: 1, to: 2 });

        // w 从 "测试" 跳到 "2024"
        const w2 = findWordInLine(segs, line, 3, true, false);
        expect(w2).toEqual({ from: 6, to: 10 });
    });

    test("连续空格处理", () => {
        const line = "hello    world";
        const segs = buildUnifiedLineSegments(line, null);
        expect(texts(line, segs)).toEqual(["hello", "    ", "world"]);

        // w 从 hello 跳到 world（跳过多个空格）
        const w = findWordInLine(segs, line, 0, true, false);
        expect(w).toEqual({ from: 9, to: 14 });
    });

    test("行首空格", () => {
        const line = "  hello";
        const segs = buildUnifiedLineSegments(line, null);
        expect(texts(line, segs)).toEqual(["  ", "hello"]);

        // b 从 hello 起始跳到无（前面只有空白，没有词）
        const w = findWordInLine(segs, line, 2, false, false);
        expect(w).toBeNull();
    });

    test("中英文交替密集文本", () => {
        const line = "aB中cD文eF";
        const tokens = [
            tok("aB", 0, 2),
            tok("中", 2, 3),
            tok("cD", 3, 5),
            tok("文", 5, 6),
            tok("eF", 6, 8),
        ];
        const segs = buildUnifiedLineSegments(line, tokens);
        expect(texts(line, segs)).toEqual(["aB", "中", "cD", "文", "eF"]);

        // w 连续跳词
        let pos = 0;
        const positions: number[] = [pos];
        for (let i = 0; i < 5; i++) {
            const w = findWordInLine(segs, line, pos, true, false);
            if (!w) break;
            pos = w.from;
            positions.push(pos);
        }
        expect(positions).toEqual([0, 2, 3, 5, 6]);
    });
});
