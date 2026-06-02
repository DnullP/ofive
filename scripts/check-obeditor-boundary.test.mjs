/**
 * @file scripts/check-obeditor-boundary.test.mjs
 * @description obeditor 边界 guard 的最小回归测试。
 */

import { describe, expect, test } from "bun:test";

import {
    buildObeditorBoundaryViolations,
    buildObeditorImportViolations,
} from "./check-obeditor-boundary.mjs";

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

    test("allows the default extension pack and host adapter APIs from obeditor", () => {
        const violations = buildObeditorImportViolations({
            "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts": `
                import {
                    createDefaultMarkdownCodeMirrorExtensions,
                    createImeCompositionGuard,
                    type EditorService,
                } from "obeditor";
            `,
        });

        expect(violations).toEqual([]);
    });

    test("rejects concrete obeditor plugin factory imports in ofive", () => {
        const violations = buildObeditorImportViolations({
            "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts": `
                import {
                    createDefaultMarkdownCodeMirrorExtensions,
                    createFrontmatterSyntaxExtension,
                    createMarkdownTableSyntaxExtension as tableExtension,
                    attachPasteImageHandler,
                } from "obeditor";
            `,
        });

        expect(violations).toEqual([
            {
                relativePath: "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts",
                reason: "ofive must consume obeditor's default extension pack instead of importing createFrontmatterSyntaxExtension",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts",
                reason: "ofive must consume obeditor's default extension pack instead of importing createMarkdownTableSyntaxExtension",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts",
                reason: "ofive must consume obeditor's default extension pack instead of importing attachPasteImageHandler",
            },
        ]);
    });
});
