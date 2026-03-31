/**
 * @module plugins/markdown-codemirror/editor/editorKeyboardBridge.test
 * @description editorKeyboardBridge 单元测试：验证 Vim handoff、删词快捷键与表格编辑器快捷键协同。
 */

import { describe, expect, mock, test } from "bun:test";
import type { EditorView } from "codemirror";
import {
    handleEditorKeydown,
    type EditorKeyboardEventLike,
} from "./editorKeyboardBridge";

/**
 * @function createViewStub
 * @description 创建满足键盘桥接测试需求的最小 EditorView 桩。
 * @param markdown 当前文档文本。
 * @returns EditorView 兼容桩对象。
 */
function createViewStub(markdown: string): EditorView {
    const dom = {
        addEventListener: mock(() => undefined),
        removeEventListener: mock(() => undefined),
    };

    return {
        dom,
        state: {
            selection: {
                main: {
                    head: 0,
                },
            },
            doc: {
                toString: () => markdown,
                lineAt: () => ({ number: 1, from: 0 }),
                line: () => ({ from: 0 }),
            },
        },
        dispatch: mock(() => undefined),
    } as unknown as EditorView;
}

/**
 * @function createEventStub
 * @description 创建最小键盘事件桩，便于断言 preventDefault/stopPropagation 调用。
 * @param overrides 需要覆盖的字段。
 * @returns 键盘事件兼容桩对象。
 */
function createEventStub(
    overrides: Partial<EditorKeyboardEventLike> = {},
): EditorKeyboardEventLike {
    return {
        key: "x",
        keyCode: 0,
        isComposing: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        target: null,
        preventDefault: mock(() => undefined),
        stopPropagation: mock(() => undefined),
        ...overrides,
    };
}

describe("handleEditorKeydown", () => {
    test("should execute segmented delete for Cmd+Backspace in edit mode", () => {
        const view = createViewStub("中文测试");
        const executeSegmentedDeleteBackward = mock(async () => undefined);
        const executeEditorCommand = mock(() => undefined);
        const event = createEventStub({
            key: "Backspace",
            metaKey: true,
        });

        handleEditorKeydown({
            articleId: "file:demo",
            event,
            view,
            getBindings: () => ({ "editor.find": "Cmd+F" }),
            getManagedShortcutCandidates: () => [],
            getCurrentVaultPath: () => "/vault",
            getDisplayMode: () => "edit",
            isVimModeEnabled: () => false,
            executeSegmentedDeleteBackward,
            executeEditorCommand,
            focusFrontmatterNavigationTarget: mock(() => false),
            frontmatterSelectors: {
                focusable: "[data-frontmatter-field-focusable='true']",
                navigation: "[data-frontmatter-vim-nav='true']",
            },
            dependencies: {
                canMutateEditorDocument: () => true,
            },
        });

        expect(executeSegmentedDeleteBackward).toHaveBeenCalledWith(view);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(executeEditorCommand).not.toHaveBeenCalled();
    });

    test("should consume vim handoff before shortcut dispatch", () => {
        const view = createViewStub("---\ntitle: Demo\n---\n# Demo");
        const focusFrontmatterNavigationTarget = mock(() => true);
        const event = createEventStub({
            key: "k",
        });
        const dispatchShortcut = mock(() => ({
            kind: "none" as const,
            commandId: null,
            shouldPreventDefault: false,
            shouldStopPropagation: false,
            notifyTabClose: false,
            reason: "no-match" as const,
        }));

        handleEditorKeydown({
            articleId: "file:demo",
            event,
            view,
            getBindings: () => ({ "editor.find": "Cmd+F" }),
            getManagedShortcutCandidates: () => [],
            getCurrentVaultPath: () => "/vault",
            getDisplayMode: () => "edit",
            isVimModeEnabled: () => true,
            executeSegmentedDeleteBackward: mock(async () => undefined),
            executeEditorCommand: mock(() => undefined),
            focusFrontmatterNavigationTarget,
            frontmatterSelectors: {
                focusable: "[data-frontmatter-field-focusable='true']",
                navigation: "[data-frontmatter-vim-nav='true']",
            },
            dependencies: {
                dispatchShortcut,
                resolveEditorBodyAnchor: () => 1,
                resolveRegisteredVimHandoff: () => ({
                    kind: "focus-frontmatter-navigation",
                    position: "last",
                    reason: "test-handoff",
                }),
            },
        });

        expect(focusFrontmatterNavigationTarget).toHaveBeenCalledWith("last");
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(dispatchShortcut).not.toHaveBeenCalled();
    });

    test("should flush markdown table editor before executing non-editor shortcut", () => {
        const view = createViewStub("| a | b |");
        const executeEditorCommand = mock(() => undefined);
        const flushFocusedMarkdownTableEditor = mock(() => undefined);
        const event = createEventStub({
            key: "j",
        });

        handleEditorKeydown({
            articleId: "file:demo",
            event,
            view,
            getBindings: () => ({ "sidebar.left.toggle": "Cmd+Shift+J" }),
            getManagedShortcutCandidates: () => ["Cmd+Shift+J"],
            getCurrentVaultPath: () => "/vault",
            getDisplayMode: () => "edit",
            isVimModeEnabled: () => false,
            executeSegmentedDeleteBackward: mock(async () => undefined),
            executeEditorCommand,
            focusFrontmatterNavigationTarget: mock(() => false),
            frontmatterSelectors: {
                focusable: "[data-frontmatter-field-focusable='true']",
                navigation: "[data-frontmatter-vim-nav='true']",
            },
            dependencies: {
                dispatchShortcut: () => ({
                    kind: "execute",
                    commandId: "sidebar.left.toggle",
                    shouldPreventDefault: true,
                    shouldStopPropagation: true,
                    notifyTabClose: false,
                    reason: "conditioned-match",
                }),
                isMarkdownTableEditorFocused: () => true,
                flushFocusedMarkdownTableEditor,
            },
        });

        expect(flushFocusedMarkdownTableEditor).toHaveBeenCalledTimes(1);
        expect(executeEditorCommand).toHaveBeenCalledWith("sidebar.left.toggle");
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
    });
});