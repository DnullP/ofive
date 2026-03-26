/**
 * @module host/commands/shortcutGovernance.test
 * @description shortcutGovernance 模块的单元测试，覆盖系统保留键限制与冲突分类。
 */

import { describe, expect, test } from "bun:test";
import { analyzeShortcutGovernance } from "./shortcutGovernance";

describe("analyzeShortcutGovernance", () => {
    test("should flag reserved bindings that are not allowed by policy", () => {
        const summary = analyzeShortcutGovernance(
            [
                {
                    id: "sidebar.left.toggle",
                    title: "Sidebar Left",
                    routeClass: "frontend-window",
                    bindingPolicy: "user-configurable",
                },
            ],
            {
                "sidebar.left.toggle": "Cmd+Q",
            },
        );

        expect(summary["sidebar.left.toggle"].issues[0]?.type).toBe("reserved-binding-not-allowed");
    });

    test("should classify unconditional duplicate shortcuts as hard conflicts", () => {
        const summary = analyzeShortcutGovernance(
            [
                {
                    id: "a",
                    title: "A",
                    routeClass: "frontend-window",
                    bindingPolicy: "user-configurable",
                },
                {
                    id: "b",
                    title: "B",
                    routeClass: "frontend-window",
                    bindingPolicy: "user-configurable",
                },
            ],
            {
                a: "Cmd+P",
                b: "Cmd+P",
            },
        );

        expect(summary.a.issues.some((issue) => issue.type === "hard-conflict")).toBe(true);
        expect(summary.b.issues.some((issue) => issue.type === "hard-conflict")).toBe(true);
    });

    test("should classify different conditional duplicates as conditional overlap", () => {
        const summary = analyzeShortcutGovernance(
            [
                {
                    id: "editor.command",
                    title: "Editor",
                    routeClass: "frontend-editor",
                    bindingPolicy: "user-configurable",
                    condition: "editorFocused",
                },
                {
                    id: "tree.command",
                    title: "Tree",
                    routeClass: "frontend-window",
                    bindingPolicy: "user-configurable",
                    condition: "fileTreeFocused",
                },
            ],
            {
                "editor.command": "Cmd+P",
                "tree.command": "Cmd+P",
            },
        );

        expect(summary["editor.command"].issues.some((issue) => issue.type === "conditional-overlap")).toBe(true);
        expect(summary["tree.command"].issues.some((issue) => issue.type === "conditional-overlap")).toBe(true);
    });
});