/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkSyntaxRenderer.test
 * @description WikiLink 解析测试：覆盖普通链接、别名链接与非法输入，确保别名显示文本稳定。
 * @dependencies
 *  - bun:test
 *  - ./wikiLinkSyntaxRenderer
 *
 * @example
 *   bun test src/plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkSyntaxRenderer.test.ts
 */

import { describe, expect, it } from "bun:test";
import { EditorState } from "@codemirror/state";
import {
    extractWidgetWikiLinkTarget,
    handleWikiLinkMouseDown,
    isRenderedWikiLinkTarget,
} from "./wikiLinkSyntaxRenderer";
import { parseWikiLinkParts } from "./wikiLinkParser";

function createRenderTarget(options?: {
    rendered?: boolean;
    widgetTarget?: string;
}): EventTarget {
    return {
        closest(selector: string) {
            if (
                options?.widgetTarget
                && selector === ".cm-rendered-wikilink-display"
            ) {
                return {
                    dataset: {
                        wikiLinkTarget: options.widgetTarget,
                    },
                };
            }

            if (
                options?.rendered
                && selector === ".cm-rendered-wikilink, .cm-rendered-wikilink-display"
            ) {
                return {};
            }

            return null;
        },
    } as EventTarget;
}

describe("parseWikiLinkParts", () => {
    it("should use target as display text when alias is absent", () => {
        expect(parseWikiLinkParts("Network Segment")).toEqual({
            target: "Network Segment",
            displayText: "Network Segment",
            hasExplicitDisplayText: false,
        });
    });

    it("should expose alias as display text when explicit alias exists", () => {
        expect(parseWikiLinkParts("Network Segment|网段")).toEqual({
            target: "Network Segment",
            displayText: "网段",
            hasExplicitDisplayText: true,
        });
    });

    it("should preserve additional pipes inside alias text", () => {
        expect(parseWikiLinkParts("Network Segment|A|B")).toEqual({
            target: "Network Segment",
            displayText: "A|B",
            hasExplicitDisplayText: true,
        });
    });

    it("should reject wikilinks whose target is empty", () => {
        expect(parseWikiLinkParts("|网段")).toBeNull();
        expect(parseWikiLinkParts("   ")).toBeNull();
    });
});

describe("wikilink navigation interaction", () => {
    it("识别渲染态 wikilink DOM 命中", () => {
        expect(isRenderedWikiLinkTarget(createRenderTarget({ rendered: true }))).toBe(true);
        expect(isRenderedWikiLinkTarget(createRenderTarget())).toBe(false);
    });

    it("从 alias widget 中提取目标路径", () => {
        expect(
            extractWidgetWikiLinkTarget(createRenderTarget({ widgetTarget: "folder/note" })),
        ).toBe("folder/note");
    });

    it("普通左键点击渲染态 wikilink 时会阻止默认行为并打开目标", () => {
        const state = EditorState.create({
            doc: "[[Target Note]]",
        });

        let prevented = false;
        let openedTarget: string | null = null;

        const handled = handleWikiLinkMouseDown(
            {
                button: 0,
                target: createRenderTarget({ rendered: true }),
                clientX: 10,
                clientY: 12,
                preventDefault() {
                    prevented = true;
                },
            },
            {
                state,
                posAtCoords() {
                    return 4;
                },
            },
            (target) => {
                openedTarget = target;
            },
        );

        expect(handled).toBe(true);
        expect(prevented).toBe(true);
        expect(openedTarget).toBe("Target Note");
    });

    it("普通左键点击 alias widget 时会直接打开目标", () => {
        const state = EditorState.create({
            doc: "[[Target Note|Alias]]",
        });

        let prevented = false;
        let openedTarget: string | null = null;

        const handled = handleWikiLinkMouseDown(
            {
                button: 0,
                target: createRenderTarget({
                    rendered: true,
                    widgetTarget: "Target Note",
                }),
                clientX: 0,
                clientY: 0,
                preventDefault() {
                    prevented = true;
                },
            },
            {
                state,
                posAtCoords() {
                    throw new Error("widget click should not require posAtCoords");
                },
            },
            (target) => {
                openedTarget = target;
            },
        );

        expect(handled).toBe(true);
        expect(prevented).toBe(true);
        expect(openedTarget).toBe("Target Note");
    });

    it("非渲染态点击不会被拦截", () => {
        const state = EditorState.create({
            doc: "[[Target Note]]",
        });

        let prevented = false;
        let openedTarget: string | null = null;

        const handled = handleWikiLinkMouseDown(
            {
                button: 0,
                target: createRenderTarget(),
                clientX: 10,
                clientY: 12,
                preventDefault() {
                    prevented = true;
                },
            },
            {
                state,
                posAtCoords() {
                    return 4;
                },
            },
            (target) => {
                openedTarget = target;
            },
        );

        expect(handled).toBe(false);
        expect(prevented).toBe(false);
        expect(openedTarget).toBeNull();
    });
});