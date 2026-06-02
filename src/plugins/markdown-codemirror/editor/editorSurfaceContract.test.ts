/**
 * @module plugins/markdown-codemirror/editor/editorSurfaceContract.test
 * @description ofive editor 宿主契约测试：ofive 只消费 obeditor 默认 Markdown
 *   扩展包，并通过 capabilities 注入 vault/wiki/media/i18n 等宿主能力。
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    createDefaultMarkdownCodeMirrorExtensions,
} from "obeditor";

describe("ofive editor host surface contract", () => {
    test("consumes the obeditor default Markdown CodeMirror extension pack", () => {
        const extensions = createDefaultMarkdownCodeMirrorExtensions({
            getCurrentFilePath: () => "test-resources/notes/editor-surface-contract.md",
            getCurrentDocumentContent: () => "# Contract",
            canMutateDocument: () => true,
            capabilities: {
                wikiLinks: {
                    suggestTargets: async () => [],
                    openTarget: async () => undefined,
                    previewTarget: async () => null,
                    resolveTarget: async () => null,
                },
                mediaEmbeds: {
                    createAsset: async (_file, context) => ({
                        relativePath: context.suggestedRelativePath ?? "Images/pasted-image.png",
                        markdown: context.markdown ?? "![[Images/pasted-image.png]]",
                    }),
                },
            },
        });

        expect(extensions.length).toBeGreaterThanOrEqual(10);
    });

    test("keeps concrete editor plugin wiring out of the ofive lifecycle", () => {
        const lifecycleSource = readFileSync(
            join(import.meta.dir, "useCodeMirrorEditorLifecycle.ts"),
            "utf8",
        );

        expect(lifecycleSource).toContain("createDefaultMarkdownCodeMirrorExtensions");
        expect(lifecycleSource).not.toMatch(/\bcreate(?:Frontmatter|CodeBlock|Latex|MarkdownTable|ImageEmbed|WikiLink|TaskCheckbox|PasteImage)[A-Za-z]*Extension\b/);
        expect(lifecycleSource).not.toMatch(/\bensureBuiltin(?:SyntaxRenderers|EditPlugins|VimHandoffs)Registered\b/);
        expect(lifecycleSource).not.toContain("getRegisteredEditPluginExtensions");
        expect(lifecycleSource).not.toContain("attachPasteImageHandler");
    });

    test("consumes obeditor styles and keeps plugin styles out of the ofive tab shell", () => {
        const tabSource = readFileSync(
            join(import.meta.dir, "CodeMirrorEditorTab.tsx"),
            "utf8",
        );
        const tabStyles = readFileSync(
            join(import.meta.dir, "CodeMirrorEditorTab.css"),
            "utf8",
        );

        expect(tabSource).toContain('import "obeditor/styles.css"');
        expect(tabSource).not.toContain('import "katex/dist/katex.min.css"');
        expect(tabStyles).not.toMatch(/\.cm-rendered-|\.cm-wikilink-(?:suggest|preview)|\.cm-latex|\.cm-frontmatter-widget|\.cm-image-embed|\.cm-code-block|\.cm-mermaid-widget|\.cm-hidden-block|\.hljs-|katex\/dist/u);
    });

    test("uses obeditor presentation readiness contracts instead of plugin DOM internals", () => {
        const lifecycleSource = readFileSync(
            join(import.meta.dir, "useCodeMirrorEditorLifecycle.ts"),
            "utf8",
        );
        const staleFrontmatterDomSelector = [
            ".cm-frontmatter",
            "-widget .",
            "fmv",
            "-editor",
        ].join("");

        expect(lifecycleSource).toContain("isDefaultMarkdownPresentationReady");
        expect(lifecycleSource).toContain("markdownDocumentStartsWithFrontmatter");
        expect(lifecycleSource).not.toContain(staleFrontmatterDomSelector);
    });

    test("delegates default Markdown widget DOM selectors to obeditor", () => {
        const tabSource = readFileSync(
            join(import.meta.dir, "CodeMirrorEditorTab.tsx"),
            "utf8",
        );
        const keyboardBridgeSource = readFileSync(
            join(import.meta.dir, "editorKeyboardBridge.ts"),
            "utf8",
        );
        const combinedSource = `${tabSource}\n${keyboardBridgeSource}`;

        expect(combinedSource).toContain("focusDefaultMarkdownWidgetVimNavigationTarget");
        expect(combinedSource).toContain("resolveDefaultMarkdownInteractionTargetState");
        expect(combinedSource).not.toMatch(/data-frontmatter-|data-markdown-table-/u);
    });

    test("prebundles Mermaid runtime dependencies exposed by the linked obeditor build", () => {
        const viteConfig = readFileSync(
            resolve(import.meta.dir, "../../../../vite.config.ts"),
            "utf8",
        );

        expect(viteConfig).toContain('"mermaid"');
        expect(viteConfig).toContain('"dayjs"');
        expect(viteConfig).toContain('"dayjs/plugin/isoWeek.js"');
        expect(viteConfig).toContain('"dayjs/plugin/customParseFormat.js"');
        expect(viteConfig).toContain('"dayjs/plugin/advancedFormat.js"');
        expect(viteConfig).toContain('"dayjs/plugin/duration.js"');
    });
});
