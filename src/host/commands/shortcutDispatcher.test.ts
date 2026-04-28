/**
 * @module host/commands/shortcutDispatcher.test
 * @description shortcutDispatcher 模块的单元测试，覆盖系统保留键、全局调度和编辑器调度行为。
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
    createConditionContext,
    type ShortcutCondition,
} from "../conditions/conditionEvaluator";
import {
    registerCommand,
    unregisterCommand,
    type CommandDefinition,
    type CommandId,
    type CommandScope,
} from "./commandSystem";
import type { ShortcutBindingPolicy } from "./shortcutPolicies";
import { dispatchShortcut } from "./shortcutDispatcher";

/**
 * @function createKeyboardEventLike
 * @description 创建满足快捷键调度所需字段的键盘事件测试替身。
 * @param shortcut 快捷键字符串。
 * @returns 键盘事件替身。
 */
function createKeyboardEventLike(shortcut: string): KeyboardEvent {
    const parts = shortcut.split("+").map((part) => part.trim());
    const key = parts.pop() ?? "";
    const modifiers = new Set(parts);
    const normalizedKey = key.length === 1 ? key.toUpperCase() : key;
    const code = /^[A-Z]$/.test(normalizedKey)
        ? `Key${normalizedKey}`
        : /^\d$/.test(normalizedKey)
            ? `Digit${normalizedKey}`
            : "";

    return {
        key: normalizedKey,
        code,
        metaKey: modifiers.has("Cmd"),
        ctrlKey: modifiers.has("Ctrl"),
        altKey: modifiers.has("Alt"),
        shiftKey: modifiers.has("Shift"),
        getModifierState(name: string): boolean {
            return name === "AltGraph" ? modifiers.has("AltGraph") : false;
        },
    } as KeyboardEvent;
}

interface TestCommandMeta {
    scope?: "global" | "editor";
    condition?: ShortcutCondition;
    conditions?: ShortcutCondition[];
    bindingPolicy?: ShortcutBindingPolicy;
}

const registeredCommandIds = new Set<CommandId>();

afterEach(() => {
    registeredCommandIds.forEach((commandId) => {
        unregisterCommand(commandId);
    });
    registeredCommandIds.clear();
});

/**
 * @function defineCommand
 * @description 注册测试命令元信息。
 * @param commandId 命令 ID。
 * @param meta 命令元信息。
 */
function defineCommand(commandId: string, meta: TestCommandMeta): void {
    const definition: CommandDefinition = {
        id: commandId,
        title: commandId,
        scope: meta.scope as CommandScope | undefined,
        condition: meta.condition,
        conditions: meta.conditions,
        shortcut: meta.bindingPolicy
            ? {
                defaultBinding: "",
                editableInSettings: true,
                bindingPolicy: meta.bindingPolicy,
            }
            : undefined,
        execute: () => undefined,
    };
    registerCommand(definition);
    registeredCommandIds.add(commandId);
}

describe("dispatchShortcut", () => {
    test("should fallback to reserved app.quit for Cmd+Q in global source", () => {
        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+Q"),
            bindings: {},
            source: "global",
            conditionContext: createConditionContext({ focusedComponent: "other" }),
        });

        expect(result.kind).toBe("execute");
        expect(result.commandId).toBe("app.quit");
        expect(result.reason).toBe("system-reserved");
    });

    test("should prefer system binding over reserved fallback", () => {
        defineCommand("test.system.close", {
            bindingPolicy: "prefer-system-reserved",
        });

        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+W"),
            bindings: {
                "test.system.close": "Cmd+W",
            },
            source: "global",
            conditionContext: createConditionContext({ focusedComponent: "other" }),
        });

        expect(result.kind).toBe("execute");
        expect(result.commandId).toBe("test.system.close");
        expect(result.reason).toBe("system-binding");
    });

    test("global source should prefer conditioned commands over unconditioned commands", () => {
        defineCommand("test.global.open", {});
        defineCommand("test.fileTree.open", { condition: "fileTreeFocused" });

        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+P"),
            bindings: {
                "test.global.open": "Cmd+P",
                "test.fileTree.open": "Cmd+P",
            },
            source: "global",
            conditionContext: createConditionContext({ focusedComponent: "panel:files" }),
        });

        expect(result.kind).toBe("execute");
        expect(result.commandId).toBe("test.fileTree.open");
        expect(result.reason).toBe("conditioned-match");
    });

    test("global source should route shared Cmd+Backspace to editor delete when editor is focused", () => {
        defineCommand("file.deleteFocused", { condition: "editorFocused" });
        defineCommand("fileTree.deleteSelected", { condition: "fileTreeFocused" });

        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+Backspace"),
            bindings: {
                "file.deleteFocused": "Cmd+Backspace",
                "fileTree.deleteSelected": "Cmd+Backspace",
            },
            source: "global",
            conditionContext: createConditionContext({ focusedComponent: "tab:codemirror" }),
        });

        expect(result.kind).toBe("execute");
        expect(result.commandId).toBe("file.deleteFocused");
        expect(result.reason).toBe("conditioned-match");
    });

    test("global source should route shared Cmd+Backspace to file tree delete when file tree is focused", () => {
        defineCommand("file.deleteFocused", { condition: "editorFocused" });
        defineCommand("fileTree.deleteSelected", { condition: "fileTreeFocused" });

        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+Backspace"),
            bindings: {
                "file.deleteFocused": "Cmd+Backspace",
                "fileTree.deleteSelected": "Cmd+Backspace",
            },
            source: "global",
            conditionContext: createConditionContext({ focusedComponent: "panel:files" }),
        });

        expect(result.kind).toBe("execute");
        expect(result.commandId).toBe("fileTree.deleteSelected");
        expect(result.reason).toBe("conditioned-match");
    });

    test("global source should defer editor-scoped command execution", () => {
        defineCommand("test.editor.command", {
            scope: "editor",
            condition: "editorFocused",
        });

        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+L"),
            bindings: {
                "test.editor.command": "Cmd+L",
            },
            source: "global",
            conditionContext: createConditionContext({ focusedComponent: "tab:codemirror" }),
        });

        expect(result.kind).toBe("none");
        expect(result.commandId).toBeNull();
        expect(result.reason).toBe("editor-command-deferred");
    });

    test("editor source should execute command when condition matches", () => {
        defineCommand("test.editor.bold", {
            scope: "editor",
            condition: "editorFocused",
        });
        defineCommand("test.fileTree.copy", {
            condition: "fileTreeFocused",
        });

        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+B"),
            bindings: {
                "test.editor.bold": "Cmd+B",
                "test.fileTree.copy": "Cmd+B",
            },
            source: "editor",
            conditionContext: createConditionContext({ focusedComponent: "tab:codemirror" }),
            managedShortcutCandidates: ["Cmd+B"],
        });

        expect(result.kind).toBe("execute");
        expect(result.commandId).toBe("test.editor.bold");
    });

    test("editor source should block native shortcut when managed candidate matches without command hit", () => {
        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+Z"),
            bindings: {
                "editor.undo": "",
            },
            source: "editor",
            conditionContext: createConditionContext({ focusedComponent: "tab:codemirror" }),
            managedShortcutCandidates: ["Cmd+Z"],
        });

        expect(result.kind).toBe("block-native");
        expect(result.commandId).toBeNull();
        expect(result.reason).toBe("managed-editor-shortcut");
    });

    test("editor source should not block native shortcut inside frontmatter fields", () => {
        defineCommand("test.editor.selectAll", {
            scope: "editor",
            condition: "editorBodyFocused",
        });

        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+A"),
            bindings: {
                "test.editor.selectAll": "Cmd+A",
            },
            source: "editor",
            conditionContext: createConditionContext({ focusedComponent: "tab:codemirror-frontmatter" }),
            managedShortcutCandidates: ["Cmd+A"],
        });

        expect(result.kind).toBe("none");
        expect(result.commandId).toBeNull();
        expect(result.reason).toBe("no-match");
    });

    test("editor source should execute body-only command in editor body context", () => {
        defineCommand("test.editor.selectAll", {
            scope: "editor",
            condition: "editorBodyFocused",
        });

        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+A"),
            bindings: {
                "test.editor.selectAll": "Cmd+A",
            },
            source: "editor",
            conditionContext: createConditionContext({ focusedComponent: "tab:codemirror" }),
            managedShortcutCandidates: ["Cmd+A"],
        });

        expect(result.kind).toBe("execute");
        expect(result.commandId).toBe("test.editor.selectAll");
    });

    test("editor source should execute segmented delete on Alt+Backspace only in editor body context", () => {
        defineCommand("editor.segmentedDeleteBackward", {
            scope: "editor",
            condition: "editorBodyFocused",
        });

        const result = dispatchShortcut({
            event: createKeyboardEventLike("Alt+Backspace"),
            bindings: {
                "editor.segmentedDeleteBackward": "Alt+Backspace",
            },
            source: "editor",
            conditionContext: createConditionContext({ focusedComponent: "tab:codemirror" }),
            managedShortcutCandidates: ["Alt+Backspace"],
        });

        expect(result.kind).toBe("execute");
        expect(result.commandId).toBe("editor.segmentedDeleteBackward");
    });

    test("should support composite command conditions with AND semantics", () => {
        defineCommand("test.editor.command", {
            scope: "editor",
            conditions: ["editorFocused", "activeTabPresent"],
        });

        const result = dispatchShortcut({
            event: createKeyboardEventLike("Cmd+M"),
            bindings: {
                "test.editor.command": "Cmd+M",
            },
            source: "editor",
            conditionContext: createConditionContext({
                focusedComponent: "tab:codemirror",
                activeTabId: "file:demo.md",
            }),
            managedShortcutCandidates: ["Cmd+M"],
        });

        expect(result.kind).toBe("execute");
        expect(result.commandId).toBe("test.editor.command");
    });
});
