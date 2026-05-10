/**
 * @module plugins/markdown-codemirror/editor/editorSurfaceContract.test
 * @description Editor 功能面契约测试：锚定当前内置语法渲染器、块级渲染扩展、
 *   交互式编辑插件与 Vim handoff 注册面的现有能力。
 */

import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "bun:test";
import { getRegisteredEditPluginExtensions } from "./editPluginRegistry";
import { registerFrontmatterBodyVimHandoff } from "./handoff/builtins/frontmatterBodyVimHandoff";
import { registerLatexBlockVimHandoff } from "./handoff/builtins/latexBlockVimHandoff";
import { registerMarkdownTableBodyVimHandoff } from "./handoff/builtins/markdownTableBodyVimHandoff";
import { listRegisteredVimHandoffs } from "./handoff/vimHandoffRegistry";
import { ensureBuiltinEditPluginsRegistered } from "./registerBuiltinEditPlugins";
import { ensureBuiltinSyntaxRenderersRegistered } from "./registerBuiltinSyntaxRenderers";
import { createRegisteredLineSyntaxRenderExtension } from "./syntaxRenderRegistry";
import {
    getLineSyntaxRendererSnapshot,
    type LineSyntaxDecorationContext,
    type SyntaxDecorationRange,
} from "./syntaxRenderRegistry";
import { createCodeBlockHighlightExtension } from "./syntaxPlugins/codeBlockHighlightExtension";
import { createFrontmatterSyntaxExtension } from "./syntaxPlugins/frontmatterSyntaxExtension";
import { createImageEmbedSyntaxExtension } from "./syntaxPlugins/imageEmbedSyntaxExtension";
import { createLatexSyntaxExtension } from "./syntaxPlugins/latexSyntaxExtension";
import {
    buildTaskCheckboxToggleSpec,
    createTaskCheckboxToggleExtension,
} from "./syntaxPlugins/listSyntaxRenderer";
import { createMarkdownTableSyntaxExtension } from "./syntaxPlugins/markdownTableSyntaxExtension";
import { createWikiLinkPreviewExtension } from "./syntaxPlugins/wikiLinkPreviewExtension";
import { createWikiLinkNavigationExtension } from "./syntaxPlugins/wikiLinkSyntaxRenderer";

type DecorationLike = {
    attrs?: { class?: string; style?: string };
    spec?: { class?: string; attributes?: { style?: string } };
    isReplace?: boolean;
    widget?: unknown;
};

const BUILTIN_LINE_RENDERER_IDS = [
    "header-line",
    "inline-bold",
    "inline-italic",
    "inline-strikethrough",
    "inline-code",
    "inline-wikilink",
    "inline-tag",
    "list-line",
    "blockquote-line",
    "horizontal-rule-line",
    "inline-link",
    "inline-highlight",
];

function createLineSyntaxContext(
    lineText: string,
    selectionFrom = 10_000,
): {
    context: LineSyntaxDecorationContext;
    ranges: SyntaxDecorationRange[];
} {
    const ranges: SyntaxDecorationRange[] = [];
    const view = {
        composing: false,
        state: {
            doc: {
                length: 20_000,
            },
            selection: {
                ranges: [{
                    from: selectionFrom,
                    to: selectionFrom,
                    empty: true,
                }],
            },
        },
    } as never;

    return {
        context: {
            view,
            lineText,
            lineFrom: 0,
            ranges,
        },
        ranges,
    };
}

function applyBuiltinRenderer(
    rendererId: string,
    lineText: string,
    selectionFrom = 10_000,
): SyntaxDecorationRange[] {
    ensureBuiltinSyntaxRenderersRegistered();
    const renderer = getLineSyntaxRendererSnapshot().find((item) => item.id === rendererId);
    expect(renderer).toBeDefined();

    const { context, ranges } = createLineSyntaxContext(lineText, selectionFrom);
    renderer!.applyLineDecorations(context);
    return ranges;
}

function decorationClass(range: SyntaxDecorationRange): string {
    const decoration = range.decoration as unknown as DecorationLike;
    return decoration.attrs?.class ?? decoration.spec?.class ?? "";
}

function decorationStyle(range: SyntaxDecorationRange): string {
    const decoration = range.decoration as unknown as DecorationLike;
    return decoration.attrs?.style ?? decoration.spec?.attributes?.style ?? "";
}

function isReplaceDecoration(range: SyntaxDecorationRange): boolean {
    return (range.decoration as unknown as DecorationLike).isReplace === true;
}

function hasWidget(range: SyntaxDecorationRange): boolean {
    return (range.decoration as unknown as DecorationLike).widget !== null
        && (range.decoration as unknown as DecorationLike).widget !== undefined;
}

describe("editor built-in syntax renderer contract", () => {
    test("registers the current line syntax renderers in a stable order", () => {
        ensureBuiltinSyntaxRenderersRegistered();

        const snapshot = getLineSyntaxRendererSnapshot();

        expect(snapshot.map((renderer) => renderer.id)).toEqual(BUILTIN_LINE_RENDERER_IDS);
        expect(snapshot
            .filter((renderer) => renderer.allowComposingSelectionLine === true)
            .map((renderer) => renderer.id)).toEqual(["header-line"]);
    });

    test("anchors representative inline and line decoration behavior", () => {
        const cases: Array<{
            id: string;
            lineText: string;
            expected: Array<{
                from: number;
                to: number;
                classIncludes?: string[];
                replace?: boolean;
                widget?: boolean;
                styleIncludes?: string;
            }>;
        }> = [
            {
                id: "header-line",
                lineText: "# Title",
                expected: [
                    { from: 0, to: 2, replace: true },
                    { from: 2, to: 7, classIncludes: ["cm-rendered-header", "cm-rendered-header-h1"] },
                    { from: 0, to: 0, classIncludes: ["cm-rendered-header-line", "cm-rendered-header-line-h1"] },
                ],
            },
            {
                id: "inline-bold",
                lineText: "**bold**",
                expected: [
                    { from: 0, to: 2, replace: true },
                    { from: 2, to: 6, classIncludes: ["cm-rendered-bold"] },
                    { from: 6, to: 8, replace: true },
                ],
            },
            {
                id: "inline-italic",
                lineText: "*em*",
                expected: [
                    { from: 0, to: 1, replace: true },
                    { from: 1, to: 3, classIncludes: ["cm-rendered-italic"] },
                    { from: 3, to: 4, replace: true },
                ],
            },
            {
                id: "inline-strikethrough",
                lineText: "~~gone~~",
                expected: [
                    { from: 0, to: 2, replace: true },
                    { from: 2, to: 6, classIncludes: ["cm-rendered-strikethrough"] },
                    { from: 6, to: 8, replace: true },
                ],
            },
            {
                id: "inline-code",
                lineText: "Use `code`",
                expected: [
                    { from: 4, to: 5, replace: true },
                    { from: 5, to: 9, classIncludes: ["cm-rendered-inline-code"] },
                    { from: 9, to: 10, replace: true },
                ],
            },
            {
                id: "inline-wikilink",
                lineText: "[[Guide]]",
                expected: [
                    { from: 0, to: 2, replace: true },
                    { from: 2, to: 7, classIncludes: ["cm-rendered-wikilink"] },
                    { from: 7, to: 9, replace: true },
                ],
            },
            {
                id: "inline-tag",
                lineText: "#topic",
                expected: [
                    {
                        from: 0,
                        to: 6,
                        classIncludes: ["cm-rendered-tag"],
                        styleIncludes: "background:",
                    },
                ],
            },
            {
                id: "list-line",
                lineText: "- item",
                expected: [
                    { from: 0, to: 2, replace: true, widget: true },
                    { from: 2, to: 6, classIncludes: ["cm-rendered-list-item", "cm-rendered-list-item-unordered"] },
                ],
            },
            {
                id: "blockquote-line",
                lineText: "> quote",
                expected: [
                    { from: 0, to: 2, replace: true },
                    { from: 2, to: 7, classIncludes: ["cm-rendered-blockquote"] },
                ],
            },
            {
                id: "horizontal-rule-line",
                lineText: "---",
                expected: [
                    { from: 0, to: 3, classIncludes: ["cm-rendered-horizontal-rule"] },
                ],
            },
            {
                id: "inline-link",
                lineText: "[site](https://example.com)",
                expected: [
                    { from: 0, to: 1, replace: true },
                    { from: 1, to: 5, classIncludes: ["cm-rendered-link"] },
                    { from: 5, to: 27, replace: true },
                ],
            },
            {
                id: "inline-highlight",
                lineText: "==mark==",
                expected: [
                    { from: 0, to: 2, replace: true },
                    { from: 2, to: 6, classIncludes: ["cm-rendered-highlight"] },
                    { from: 6, to: 8, replace: true },
                ],
            },
        ];

        for (const entry of cases) {
            const ranges = applyBuiltinRenderer(entry.id, entry.lineText);

            expect(ranges, entry.id).toHaveLength(entry.expected.length);
            entry.expected.forEach((expectedRange, index) => {
                const actual = ranges[index]!;
                expect(actual.from, `${entry.id} range ${index} from`).toBe(expectedRange.from);
                expect(actual.to, `${entry.id} range ${index} to`).toBe(expectedRange.to);
                if (expectedRange.replace !== undefined) {
                    expect(isReplaceDecoration(actual), `${entry.id} range ${index} replace`).toBe(expectedRange.replace);
                }
                if (expectedRange.widget !== undefined) {
                    expect(hasWidget(actual), `${entry.id} range ${index} widget`).toBe(expectedRange.widget);
                }
                for (const className of expectedRange.classIncludes ?? []) {
                    expect(decorationClass(actual), `${entry.id} range ${index} class`).toContain(className);
                }
                if (expectedRange.styleIncludes) {
                    expect(decorationStyle(actual), `${entry.id} range ${index} style`).toContain(expectedRange.styleIncludes);
                }
            });
        }
    });

    test("keeps alias wikilinks as a single display widget replacement", () => {
        const lineText = "[[target/path|Alias]]";
        const ranges = applyBuiltinRenderer("inline-wikilink", lineText);

        expect(ranges).toHaveLength(1);
        expect(ranges[0]).toMatchObject({ from: 0, to: lineText.length });
        expect(isReplaceDecoration(ranges[0]!)).toBe(true);
        expect(hasWidget(ranges[0]!)).toBe(true);
    });

    test("keeps inline code source visible when the selection touches the line", () => {
        const ranges = applyBuiltinRenderer("inline-code", "Use `[[Guide]]` here", 6);

        expect(ranges).toEqual([]);
    });
});

describe("editor extension and interaction plugin contract", () => {
    test("creates every currently wired block or interactive CodeMirror extension", () => {
        const containerApi = {} as never;
        const getCurrentFilePath = () => "test-resources/notes/editor-surface-contract.md";
        const extensionFactories: Array<[string, () => unknown]> = [
            ["frontmatter", () => createFrontmatterSyntaxExtension()],
            ["code-block-highlight", () => createCodeBlockHighlightExtension()],
            ["latex", () => createLatexSyntaxExtension()],
            ["markdown-table", () => createMarkdownTableSyntaxExtension(containerApi, getCurrentFilePath)],
            ["image-embed", () => createImageEmbedSyntaxExtension(getCurrentFilePath)],
            ["wikilink-preview", () => createWikiLinkPreviewExtension(containerApi, getCurrentFilePath)],
            ["wikilink-navigation", () => createWikiLinkNavigationExtension(containerApi, getCurrentFilePath)],
            ["task-checkbox-toggle", () => createTaskCheckboxToggleExtension()],
            ["registered-line-syntax", () => createRegisteredLineSyntaxRenderExtension()],
        ];

        for (const [id, createExtension] of extensionFactories) {
            const extension = createExtension();
            const extensionCount = Array.isArray(extension) ? extension.length : 1;

            expect(extension, id).toBeTruthy();
            expect(extensionCount, id).toBeGreaterThan(0);
        }
    });

    test("keeps the built-in edit plugin surface anchored to wikilink suggestion extensions", () => {
        ensureBuiltinEditPluginsRegistered();

        const extensions = getRegisteredEditPluginExtensions({
            getCurrentFilePath: () => "test-resources/notes/editor-surface-contract.md",
        });

        expect(extensions).toHaveLength(4);
    });

    test("keeps the built-in Vim handoff registrations anchored", () => {
        const cleanupCallbacks = [
            registerFrontmatterBodyVimHandoff(),
            registerLatexBlockVimHandoff(),
            registerMarkdownTableBodyVimHandoff(),
        ];

        try {
            const builtinIds = [
                "frontmatter.body-enter-navigation",
                "latex-block.enter-source",
                "markdown-table.body-enter-navigation",
            ];

            expect(listRegisteredVimHandoffs()
                .filter((registration) => builtinIds.includes(registration.id))
                .map((registration) => ({
                    id: registration.id,
                    owner: registration.owner,
                    surface: registration.surface,
                    priority: registration.priority,
                }))).toEqual([
                {
                    id: "frontmatter.body-enter-navigation",
                    owner: "frontmatter",
                    surface: "editor-body",
                    priority: 100,
                },
                {
                    id: "latex-block.enter-source",
                    owner: "latex-block",
                    surface: "editor-body",
                    priority: 200,
                },
                {
                    id: "markdown-table.body-enter-navigation",
                    owner: "markdown-table",
                    surface: "editor-body",
                    priority: 200,
                },
            ]);
        } finally {
            cleanupCallbacks.reverse().forEach((cleanup) => cleanup());
        }
    });

    test("anchors task checkbox toggle transactions as part of the visible list renderer", () => {
        const state = EditorState.create({
            doc: "- [ ] todo item",
            selection: { anchor: 13 },
        });

        expect(buildTaskCheckboxToggleSpec(state, 2)).toEqual({
            from: 3,
            to: 4,
            insert: "x",
            selection: state.selection,
        });
    });
});
