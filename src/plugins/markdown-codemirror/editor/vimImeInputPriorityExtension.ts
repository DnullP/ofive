/**
 * @module plugins/markdown-codemirror/editor/vimImeInputPriorityExtension
 * @description Vim 非 insert 命令态下让输入法文本优先交给 Vim，而不是写入正文。
 */

import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "codemirror";
import { getCM, Vim, type CodeMirror } from "@replit/codemirror-vim";
import {
    applyResolvedVimHandoff,
    resolveEditorBodyVimHandoff,
} from "./editorKeyboardBridge";
import type {
    VimHandoffWidget,
    VimHandoffWidgetPosition,
} from "./handoff/vimHandoffRegistry";

interface VimStateLike {
    insertMode?: boolean;
    visualMode?: boolean;
}

interface CodeMirrorLike {
    state?: {
        vim?: VimStateLike | null;
    };
}

interface VimImeInputPriorityDependencies {
    getCodeMirror?: (view: EditorView) => CodeMirrorLike | null;
    handleVimKey?: (cm: CodeMirrorLike, key: string) => boolean | undefined;
    isVimModeEnabled?: () => boolean;
    focusWidgetNavigationTarget?: (
        widget: VimHandoffWidget,
        position: VimHandoffWidgetPosition,
        blockFrom?: number,
    ) => boolean;
}

function isVimCommandMode(cm: CodeMirrorLike | null): boolean {
    const vimState = cm?.state?.vim ?? null;
    return Boolean(vimState && !vimState.insertMode);
}

function isSinglePlainTextInput(text: string): boolean {
    return [...text].length === 1 && text !== "\n" && text !== "\r";
}

export function handleVimImeTextInput(
    text: string,
    cm: CodeMirrorLike | null,
    handleVimKey: (cm: CodeMirrorLike, key: string) => boolean | undefined,
): boolean {
    if (cm === null || !isVimCommandMode(cm)) {
        return false;
    }

    if (isSinglePlainTextInput(text)) {
        handleVimKey(cm, text);
    }

    return true;
}

export function handleEditorBodyVimHandoffTextInput(
    view: EditorView,
    text: string,
    isVimModeEnabled: () => boolean,
    focusWidgetNavigationTarget: (
        widget: VimHandoffWidget,
        position: VimHandoffWidgetPosition,
        blockFrom?: number,
    ) => boolean,
): boolean {
    const handoffResult = resolveEditorBodyVimHandoff({
        view,
        key: text,
        isVimModeEnabled: isVimModeEnabled(),
    });
    if (!handoffResult) {
        return false;
    }

    return applyResolvedVimHandoff(view, handoffResult, focusWidgetNavigationTarget);
}

/**
 * @function createVimImeInputPriorityExtension
 * @description 在 Vim 非 insert 命令态中拦截 IME 落下来的单字符文本，让 j/k/h/l 等键仍由 Vim 处理。
 * @param dependencies 测试注入依赖；生产默认使用 @replit/codemirror-vim。
 * @returns CodeMirror 扩展。
 */
export function createVimImeInputPriorityExtension(
    dependencies: VimImeInputPriorityDependencies = {},
): Extension {
    const getCodeMirrorInstance = dependencies.getCodeMirror ?? ((view: EditorView) => getCM(view));
    const handleVimKey = dependencies.handleVimKey ?? ((cm: CodeMirrorLike, key: string) =>
        Vim.handleKey(cm as CodeMirror, key, "user"));

    return Prec.highest(EditorView.inputHandler.of((view, _from, _to, text) => {
        if (
            isSinglePlainTextInput(text)
            && dependencies.isVimModeEnabled
            && dependencies.focusWidgetNavigationTarget
            && handleEditorBodyVimHandoffTextInput(
                view,
                text,
                dependencies.isVimModeEnabled,
                dependencies.focusWidgetNavigationTarget,
            )
        ) {
            return true;
        }

        const cm = getCodeMirrorInstance(view);
        return handleVimImeTextInput(text, cm, handleVimKey);
    }));
}
