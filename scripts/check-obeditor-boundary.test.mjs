/**
 * @file scripts/check-obeditor-boundary.test.mjs
 * @description obeditor 边界 guard 的最小回归测试。
 */

import { describe, expect, test } from "bun:test";

import {
    buildObeditorBoundaryViolations,
    buildObeditorCssViolations,
    buildObeditorDomContractViolations,
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

    test("allows ofive host shell floating surface CSS outside the editor directory", () => {
        const violations = buildObeditorCssViolations({
            "src/App.css": `
                .app-runtime--tauri.app-effect--glass .cm-wikilink-suggest-popup,
                .app-runtime--tauri.app-effect--glass .cm-wikilink-preview-tooltip[data-floating-surface="true"] {
                    background: var(--floating-surface-bg);
                }
            `,
        });

        expect(violations).toEqual([]);
    });

    test("rejects generic editor plugin CSS in the ofive editor directory", () => {
        const violations = buildObeditorCssViolations({
            "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css": `
                @import "katex/dist/katex.min.css";
                .cm-tab-editor .cm-rendered-header { color: red; }
                .cm-wikilink-preview-tooltip { border: 0; }
                .cm-latex-inline-widget { display: inline; }
                .cm-frontmatter-widget { display: flex; }
                .cm-image-embed-widget { max-width: 100%; }
                .cm-code-block-copy-btn { float: right; }
                .cm-mermaid-widget { overflow: auto; }
                .cm-hidden-block-line { height: 0; }
                .cm-markdown-table-widget { width: 100%; }
                .hljs-keyword { color: purple; }
            `,
        });

        expect(violations).toEqual([
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector .cm-rendered- must live in ../obeditor/styles.css",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector .cm-wikilink-preview must live in ../obeditor/styles.css",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector .cm-latex must live in ../obeditor/styles.css",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector .cm-frontmatter-widget must live in ../obeditor/styles.css",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector .cm-image-embed must live in ../obeditor/styles.css",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector .cm-code-block must live in ../obeditor/styles.css",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector .cm-mermaid-widget must live in ../obeditor/styles.css",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector .cm-hidden-block must live in ../obeditor/styles.css",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector .cm-markdown-table-widget must live in ../obeditor/styles.css",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector .hljs- must live in ../obeditor/styles.css",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css",
                reason: "generic editor plugin CSS selector katex/dist must live in ../obeditor/styles.css",
            },
        ]);
    });

    test("rejects direct editor plugin DOM internals in ofive host lifecycle code", () => {
        const violations = buildObeditorDomContractViolations({
            "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts": `
                view.dom.querySelector(".cm-frontmatter-widget .fmv-editor");
                view.dom.querySelector("[data-frontmatter-vim-nav='true']");
                view.dom.querySelector("[data-markdown-table-block-from]");
            `,
        });

        expect(violations).toEqual([
            {
                relativePath: "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts",
                reason: "ofive must use obeditor exported contracts instead of inspecting plugin DOM .fmv-editor",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts",
                reason: "ofive must use obeditor exported contracts instead of inspecting plugin DOM .cm-frontmatter-widget .fmv-",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts",
                reason: "ofive must use obeditor exported contracts instead of inspecting plugin DOM data-frontmatter-*",
            },
            {
                relativePath: "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts",
                reason: "ofive must use obeditor exported contracts instead of inspecting plugin DOM data-markdown-table-*",
            },
        ]);
    });

    test("allows plugin DOM selector strings in guard tests only", () => {
        const violations = buildObeditorDomContractViolations({
            "src/plugins/markdown-codemirror/editor/editorKeyboardBridge.test.ts": `
                expect(source).toContain("[data-frontmatter-vim-nav='true']");
                expect(source).toContain("[data-markdown-table-block-from]");
            `,
        });

        expect(violations).toEqual([]);
    });
});
