/**
 * @file scripts/check-obeditor-boundary.test.mjs
 * @description obeditor 边界 guard 的最小回归测试。
 */

import { describe, expect, test } from "bun:test";

import { buildObeditorBoundaryViolations } from "./check-obeditor-boundary.mjs";

describe("obeditor boundary guard", () => {
    test("allows ofive host adapter files in the markdown editor shell", () => {
        const violations = buildObeditorBoundaryViolations([
            "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.tsx",
            "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts",
            "src/host/editor/ofiveEditorCapabilities.ts",
        ]);

        expect(violations).toEqual([]);
    });

    test("rejects generic syntax and edit plugin files in ofive", () => {
        const violations = buildObeditorBoundaryViolations([
            "src/plugins/markdown-codemirror/editor/syntaxPlugins/latexSyntaxExtension.ts",
            "src/plugins/markdown-codemirror/editor/editPlugins/wikilinkSuggestEditPlugin.ts",
        ]);

        expect(violations).toEqual([
            {
                relativePath: "src/plugins/markdown-codemirror/editor/syntaxPlugins/latexSyntaxExtension.ts",
                reason: "generic editor plugin directory is reserved for ../obeditor (src/plugins/markdown-codemirror/editor/syntaxPlugins/)",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/editPlugins/wikilinkSuggestEditPlugin.ts",
                reason: "generic editor plugin directory is reserved for ../obeditor (src/plugins/markdown-codemirror/editor/editPlugins/)",
            },
        ]);
    });

    test("rejects stale pasted image handler revival", () => {
        const violations = buildObeditorBoundaryViolations([
            "src/plugins/markdown-codemirror/editor/editorPasteImageHandler.ts",
        ]);

        expect(violations).toEqual([
            {
                relativePath: "src/plugins/markdown-codemirror/editor/editorPasteImageHandler.ts",
                reason: "generic editor implementation must live in ../obeditor",
            },
        ]);
    });
});
