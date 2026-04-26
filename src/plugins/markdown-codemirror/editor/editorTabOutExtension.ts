/**
 * @module plugins/markdown-codemirror/editor/editorTabOutExtension
 * @description CodeMirror TabOut 行为：光标位于闭合括号前时，按 Tab 跳到闭合括号右侧。
 * @dependencies
 *   - @codemirror/state
 *   - @codemirror/view
 */

import { EditorSelection, Prec, type EditorState, type Extension } from "@codemirror/state";
import { keymap, type EditorView, type KeyBinding } from "@codemirror/view";

const TAB_OUT_PAIRS = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["<", ">"],
    ["（", "）"],
    ["［", "］"],
    ["【", "】"],
    ["｛", "｝"],
    ["《", "》"],
    ["〈", "〉"],
    ["「", "」"],
    ["『", "』"],
    ["〔", "〕"],
    ["〖", "〗"],
    ["〘", "〙"],
    ["〚", "〛"],
]);

const TAB_OUT_OPENERS = new Set(TAB_OUT_PAIRS.keys());
const TAB_OUT_CLOSERS = new Set(TAB_OUT_PAIRS.values());

export interface EditorTabOutTarget {
    /** 光标当前位置。 */
    from: number;
    /** TabOut 后目标位置。 */
    to: number;
    /** 被跳过的闭合括号字符。 */
    closer: string;
}

function isInlineWhitespace(char: string): boolean {
    return char === " " || char === "\t";
}

function hasMatchingUnclosedOpener(lineText: string, closerOffset: number, closer: string): boolean {
    const stack: string[] = [];

    for (let index = 0; index <= closerOffset; index += 1) {
        const char = lineText[index] ?? "";

        if (TAB_OUT_OPENERS.has(char)) {
            const expectedCloser = TAB_OUT_PAIRS.get(char);
            if (expectedCloser) {
                stack.push(expectedCloser);
            }
            continue;
        }

        if (!TAB_OUT_CLOSERS.has(char)) {
            continue;
        }

        if (index === closerOffset) {
            return stack[stack.length - 1] === closer;
        }

        if (stack[stack.length - 1] === char) {
            stack.pop();
        }
    }

    return false;
}

/**
 * @function findEditorTabOutTarget
 * @description 计算当前选择是否可以执行 TabOut。
 * @param state CodeMirror 状态。
 * @returns 可跳出目标；不应接管 Tab 时返回 null。
 */
export function findEditorTabOutTarget(state: EditorState): EditorTabOutTarget | null {
    const selection = state.selection.main;
    if (!selection.empty) {
        return null;
    }

    const cursor = selection.head;
    const line = state.doc.lineAt(cursor);
    const inlineOffset = cursor - line.from;
    const afterCursor = line.text.slice(inlineOffset);

    let whitespaceOffset = 0;
    while (whitespaceOffset < afterCursor.length && isInlineWhitespace(afterCursor[whitespaceOffset] ?? "")) {
        whitespaceOffset += 1;
    }

    const closer = afterCursor[whitespaceOffset] ?? "";
    if (!TAB_OUT_CLOSERS.has(closer)) {
        return null;
    }

    if (!hasMatchingUnclosedOpener(line.text, inlineOffset + whitespaceOffset, closer)) {
        return null;
    }

    return {
        from: cursor,
        to: cursor + whitespaceOffset + closer.length,
        closer,
    };
}

export function runEditorTabOut(view: EditorView): boolean {
    const target = findEditorTabOutTarget(view.state);
    if (!target) {
        return false;
    }

    view.dispatch({
        selection: EditorSelection.cursor(target.to),
        scrollIntoView: true,
    });
    return true;
}

const tabOutKeyBinding: KeyBinding = {
    key: "Tab",
    run: runEditorTabOut,
};

/**
 * @function createEditorTabOutKeymap
 * @description 创建 TabOut keymap；关闭时返回空扩展。
 * @param enabled 是否开启 TabOut。
 * @returns CodeMirror 扩展。
 */
export function createEditorTabOutKeymap(enabled: boolean): Extension {
    return enabled ? Prec.high(keymap.of([tabOutKeyBinding])) : [];
}
