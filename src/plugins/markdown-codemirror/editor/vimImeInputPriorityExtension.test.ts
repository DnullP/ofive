/**
 * @module plugins/markdown-codemirror/editor/vimImeInputPriorityExtension.test
 * @description Vim 命令态与中文输入法输入优先级回归测试。
 */

import { describe, expect, mock, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "codemirror";
import {
    handleEditorBodyVimHandoffTextInput,
    handleVimImeTextInput,
} from "./vimImeInputPriorityExtension";
import { registerMarkdownTableBodyVimHandoff } from "./handoff/builtins/markdownTableBodyVimHandoff";

function createCodeMirrorLike(options: {
    insertMode: boolean;
    visualMode?: boolean;
}) {
    return {
        state: {
            vim: {
                insertMode: options.insertMode,
                visualMode: options.visualMode ?? false,
            },
        },
    };
}

function createViewStub(markdown: string, selectionHead: number): EditorView {
    const state = EditorState.create({
        doc: markdown,
        selection: { anchor: selectionHead },
    });

    return {
        state,
        cm: createCodeMirrorLike({ insertMode: false }),
        dispatch: mock(() => undefined),
    } as unknown as EditorView;
}

describe("handleVimImeTextInput", () => {
    test("should route single-character IME text through Vim in normal mode", () => {
        const handleKey = mock(() => true);
        const cm = createCodeMirrorLike({ insertMode: false });
        const handled = handleVimImeTextInput(
            "j",
            cm,
            handleKey,
        );

        expect(handled).toBe(true);
        expect(handleKey).toHaveBeenCalledWith(cm, "j");
    });

    test("should consume single-character IME text in normal mode even when Vim does not handle it", () => {
        const handleKey = mock(() => false);
        const cm = createCodeMirrorLike({ insertMode: false });
        const handled = handleVimImeTextInput(
            "q",
            cm,
            handleKey,
        );

        expect(handled).toBe(true);
        expect(handleKey).toHaveBeenCalledWith(cm, "q");
    });

    test("should consume multi-character IME commits in normal mode", () => {
        const handleKey = mock(() => false);
        const cm = createCodeMirrorLike({ insertMode: false });
        const handled = handleVimImeTextInput(
            "中文",
            cm,
            handleKey,
        );

        expect(handled).toBe(true);
        expect(handleKey).not.toHaveBeenCalled();
    });

    test("should allow IME text through in Vim insert mode", () => {
        const handleKey = mock(() => true);
        const handled = handleVimImeTextInput(
            "j",
            createCodeMirrorLike({ insertMode: true }),
            handleKey,
        );

        expect(handled).toBe(false);
        expect(handleKey).not.toHaveBeenCalled();
    });

    test("should consume multi-character composition commits without sending them to Vim", () => {
        const handleKey = mock(() => true);
        const handled = handleVimImeTextInput(
            "中文",
            createCodeMirrorLike({ insertMode: false }),
            handleKey,
        );

        expect(handled).toBe(true);
        expect(handleKey).not.toHaveBeenCalled();
    });

    test("should route IME text through Vim in visual mode", () => {
        const handleKey = mock(() => true);
        const cm = createCodeMirrorLike({ insertMode: false, visualMode: true });
        const handled = handleVimImeTextInput(
            "j",
            cm,
            handleKey,
        );

        expect(handled).toBe(true);
        expect(handleKey).toHaveBeenCalledWith(cm, "j");
    });

    test("should apply markdown table handoff before inserting IME text", () => {
        const cleanup = registerMarkdownTableBodyVimHandoff();
        try {
            const markdown = ["Before", "| Name | Status |", "| --- | --- |", "| Demo | Open |", "After"].join("\n");
            const view = createViewStub(markdown, 0);
            const focusWidgetNavigationTarget = mock(() => true);
            const handled = handleEditorBodyVimHandoffTextInput(
                view,
                "j",
                () => true,
                focusWidgetNavigationTarget,
            );

            expect(handled).toBe(true);
            expect(focusWidgetNavigationTarget).toHaveBeenCalledWith("markdown-table", "first", 7);
            expect(view.dispatch).not.toHaveBeenCalled();
        } finally {
            cleanup();
        }
    });
});
