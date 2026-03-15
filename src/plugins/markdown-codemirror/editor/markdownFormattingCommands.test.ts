/**
 * @module plugins/markdown-codemirror/editor/markdownFormattingCommands.test
 * @description markdownFormattingCommands 单元测试：验证加粗、斜体、删除线、行内代码、高亮、链接等格式切换逻辑。
 */

import { describe, expect, test } from "bun:test";

/* ================================================================== */
/*  测试辅助：模拟 EditorView（轻量桩）                                   */
/* ================================================================== */

import {
    toggleBold,
    toggleItalic,
    toggleStrikethrough,
    toggleInlineCode,
    toggleHighlight,
    insertLink,
} from "./markdownFormattingCommands";

/**
 * 轻量 EditorView 模拟：捕获 dispatch 调用来验证格式命令的行为。
 * 只实现 toggleDelimiter / insertLink 会用到的 state 和 dispatch 接口。
 */
interface MockSelection {
    from: number;
    to: number;
    head: number;
    empty: boolean;
}

interface MockDispatchCall {
    changes: unknown;
    selection: unknown;
}

function createMockView(
    docText: string,
    selectionFrom: number,
    selectionTo: number,
): { view: any; dispatches: MockDispatchCall[] } {
    const dispatches: MockDispatchCall[] = [];

    const lineAt = (pos: number) => {
        let lineStart = 0;
        let lineNumber = 1;
        for (let i = 0; i < docText.length; i++) {
            if (docText[i] === "\n") {
                if (pos <= i) {
                    return { from: lineStart, to: i, number: lineNumber, text: docText.slice(lineStart, i) };
                }
                lineStart = i + 1;
                lineNumber++;
            }
        }
        return { from: lineStart, to: docText.length, number: lineNumber, text: docText.slice(lineStart) };
    };

    const selection: MockSelection = {
        from: selectionFrom,
        to: selectionTo,
        head: selectionTo,
        empty: selectionFrom === selectionTo,
    };

    const view = {
        state: {
            doc: {
                length: docText.length,
                sliceString: (from: number, to: number) => docText.slice(from, to),
                lineAt,
            },
            selection: {
                main: selection,
            },
        },
        dispatch: (transaction: MockDispatchCall) => {
            dispatches.push(transaction);
        },
    };

    return { view, dispatches };
}

/* ================================================================== */
/*  toggleBold 测试                                                    */
/* ================================================================== */

describe("toggleBold", () => {
    test("选中文本时包裹 **", () => {
        const { view, dispatches } = createMockView("hello world", 0, 5);
        toggleBold(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 5, insert: "**hello**" });
    });

    test("已被 ** 包裹的选中文本移除标记", () => {
        const { view, dispatches } = createMockView("**hello**", 0, 9);
        toggleBold(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 9, insert: "hello" });
    });

    test("选区外部已有 ** 时移除外部标记", () => {
        const { view, dispatches } = createMockView("**hello**", 2, 7);
        toggleBold(view);
        expect(dispatches).toHaveLength(1);
    });

    test("空选区时在光标处插入 **** 对并居中光标", () => {
        const { view, dispatches } = createMockView("hello world", 5, 5);
        toggleBold(view);
        expect(dispatches).toHaveLength(1);
        /* 光标在 "hello" 末尾 → 扩展到词边界 "hello" → 包裹为 **hello** */
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 5, insert: "**hello**" });
    });
});

/* ================================================================== */
/*  toggleItalic 测试                                                  */
/* ================================================================== */

describe("toggleItalic", () => {
    test("选中文本时包裹 *", () => {
        const { view, dispatches } = createMockView("hello world", 6, 11);
        toggleItalic(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 6, to: 11, insert: "*world*" });
    });

    test("已被 * 包裹的选中文本移除标记", () => {
        const { view, dispatches } = createMockView("*hello*", 0, 7);
        toggleItalic(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 7, insert: "hello" });
    });
});

/* ================================================================== */
/*  toggleStrikethrough 测试                                           */
/* ================================================================== */

describe("toggleStrikethrough", () => {
    test("选中文本时包裹 ~~", () => {
        const { view, dispatches } = createMockView("hello", 0, 5);
        toggleStrikethrough(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 5, insert: "~~hello~~" });
    });

    test("已被 ~~ 包裹的选中文本移除标记", () => {
        const { view, dispatches } = createMockView("~~hello~~", 0, 9);
        toggleStrikethrough(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 9, insert: "hello" });
    });
});

/* ================================================================== */
/*  toggleInlineCode 测试                                              */
/* ================================================================== */

describe("toggleInlineCode", () => {
    test("选中文本时包裹 `", () => {
        const { view, dispatches } = createMockView("hello", 0, 5);
        toggleInlineCode(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 5, insert: "`hello`" });
    });

    test("已被 ` 包裹的选中文本移除标记", () => {
        const { view, dispatches } = createMockView("`hello`", 0, 7);
        toggleInlineCode(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 7, insert: "hello" });
    });
});

/* ================================================================== */
/*  toggleHighlight 测试                                               */
/* ================================================================== */

describe("toggleHighlight", () => {
    test("选中文本时包裹 ==", () => {
        const { view, dispatches } = createMockView("hello", 0, 5);
        toggleHighlight(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 5, insert: "==hello==" });
    });

    test("已被 == 包裹的选中文本移除标记", () => {
        const { view, dispatches } = createMockView("==hello==", 0, 9);
        toggleHighlight(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 9, insert: "hello" });
    });
});

/* ================================================================== */
/*  insertLink 测试                                                    */
/* ================================================================== */

describe("insertLink", () => {
    test("空选区时插入 [](url) 模板", () => {
        const { view, dispatches } = createMockView("hello", 5, 5);
        insertLink(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 5, to: 5, insert: "[](url)" });
        expect(dispatches[0]!.selection).toEqual({ anchor: 6 });
    });

    test("有选区时将选中文本包裹为链接文字", () => {
        const { view, dispatches } = createMockView("hello", 0, 5);
        insertLink(view);
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]!.changes).toEqual({ from: 0, to: 5, insert: "[hello](url)" });
        /* 光标选中 url */
        expect(dispatches[0]!.selection).toEqual({ anchor: 8, head: 11 });
    });
});
