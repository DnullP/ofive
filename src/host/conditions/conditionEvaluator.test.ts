/**
 * @module host/conditions/conditionEvaluator.test
 * @description conditionEvaluator 模块的单元测试，覆盖上下文构建与内置条件评估。
 */

import { describe, expect, test } from "bun:test";
import {
    createConditionContext,
    evaluateCondition,
    evaluateConditions,
    getConditionDefinition,
    getConditionLabel,
    registerConditionDefinition,
    SHORTCUT_CONDITION_LABELS,
    unregisterConditionDefinition,
} from "./conditionEvaluator";

describe("createConditionContext", () => {
    test("should fill optional fields with stable defaults", () => {
        const context = createConditionContext({
            focusedComponent: "tab:codemirror",
        });

        expect(context.focusedComponent).toBe("tab:codemirror");
        expect(context.activeTabId).toBeNull();
        expect(context.activeEditorArticleId).toBeNull();
        expect(context.currentVaultPath).toBeNull();
        expect(context.isOverlayOpen).toBe(false);
    });
});

describe("evaluateCondition", () => {
    test("should return true when condition is undefined", () => {
        const context = createConditionContext({ focusedComponent: "other" });
        expect(evaluateCondition(undefined, context)).toBe(true);
    });

    test("should match editorFocused with codemirror tab", () => {
        const context = createConditionContext({ focusedComponent: "tab:codemirror" });
        expect(evaluateCondition("editorFocused", context)).toBe(true);
        expect(evaluateCondition("fileTreeFocused", context)).toBe(false);
    });

    test("should match fileTreeFocused with files panel", () => {
        const context = createConditionContext({ focusedComponent: "panel:files" });
        expect(evaluateCondition("fileTreeFocused", context)).toBe(true);
        expect(evaluateCondition("editorFocused", context)).toBe(false);
    });

    test("should evaluate derived host conditions from normalized context", () => {
        const context = createConditionContext({
            focusedComponent: "other",
            activeTabId: "file:demo.md",
            activeEditorArticleId: "file:demo.md",
            currentVaultPath: "/tmp/vault",
            isOverlayOpen: false,
        });

        expect(evaluateCondition("activeTabPresent", context)).toBe(true);
        expect(evaluateCondition("activeEditorPresent", context)).toBe(true);
        expect(evaluateCondition("vaultLoaded", context)).toBe(true);
        expect(evaluateCondition("overlayClosed", context)).toBe(true);
    });
});

describe("evaluateConditions", () => {
    test("should use AND semantics for multiple conditions", () => {
        const context = createConditionContext({
            focusedComponent: "tab:codemirror",
            activeTabId: "file:demo.md",
        });

        expect(evaluateConditions(["editorFocused", "activeTabPresent"], context)).toBe(true);
        expect(evaluateConditions(["editorFocused", "fileTreeFocused"], context)).toBe(false);
    });
});

describe("condition registry", () => {
    test("should allow custom condition registration and rollback", () => {
        const cleanup = registerConditionDefinition({
            id: "test.custom",
            label: "conditions.testCustom",
            evaluate: (context) => context.focusedComponent === "other",
        });

        const context = createConditionContext({ focusedComponent: "other" });
        expect(evaluateCondition("test.custom", context)).toBe(true);
        expect(getConditionDefinition("test.custom")?.label).toBe("conditions.testCustom");

        cleanup();

        expect(getConditionDefinition("test.custom")).toBeUndefined();
        expect(evaluateCondition("test.custom", context)).toBe(false);
    });

    test("should keep builtin condition available after unregister", () => {
        unregisterConditionDefinition("editorFocused");
        expect(getConditionDefinition("editorFocused")?.label).toBe(
            SHORTCUT_CONDITION_LABELS.editorFocused,
        );
    });
});

describe("SHORTCUT_CONDITION_LABELS", () => {
    test("should expose i18n labels for built-in conditions", () => {
        expect(SHORTCUT_CONDITION_LABELS.editorFocused).toBe("focusContext.editorFocused");
        expect(SHORTCUT_CONDITION_LABELS.fileTreeFocused).toBe("focusContext.fileTreeFocused");
        expect(getConditionLabel("editorFocused")).toBe("focusContext.editorFocused");
    });
});