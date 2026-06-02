/**
 * @module plugins/markdown-codemirror/editor/editorSurfaceContract.test
 * @description ofive editor 宿主契约测试：ofive 只消费 obeditor 默认 Markdown
 *   扩展包，并通过 capabilities 注入 vault/wiki/media/i18n 等宿主能力。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
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
});
