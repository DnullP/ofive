/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkPreviewExtension.test
 * @description WikiLink 预览扩展测试：覆盖修饰键判定与 hover 命中解析，确保预览只在目标链接上触发。
 * @dependencies
 *  - bun:test
 *  - @codemirror/state
 *  - ./wikiLinkPreviewExtension
 */

import { describe, expect, it } from "bun:test";
import { EditorState } from "@codemirror/state";

import {
    isWikiLinkPreviewModifierPressed,
    resolveWikiLinkPreviewAtMouseEvent,
} from "./wikiLinkPreviewExtension";

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
    } as unknown as EventTarget;
}

describe("isWikiLinkPreviewModifierPressed", () => {
    it("在 Apple 平台上仅响应 Cmd", () => {
        expect(
            isWikiLinkPreviewModifierPressed(
                { metaKey: true, ctrlKey: false },
                "MacIntel",
            ),
        ).toBe(true);
        expect(
            isWikiLinkPreviewModifierPressed(
                { metaKey: false, ctrlKey: true },
                "MacIntel",
            ),
        ).toBe(false);
    });

    it("在非 Apple 平台上响应 Ctrl", () => {
        expect(
            isWikiLinkPreviewModifierPressed(
                { metaKey: false, ctrlKey: true },
                "Win32",
            ),
        ).toBe(true);
        expect(
            isWikiLinkPreviewModifierPressed(
                { metaKey: true, ctrlKey: false },
                "Linux x86_64",
            ),
        ).toBe(false);
    });
});

describe("resolveWikiLinkPreviewAtMouseEvent", () => {
    it("解析普通渲染态 wikilink 的 hover 命中", () => {
        const state = EditorState.create({
            doc: "[[Target Note]]",
        });

        const match = resolveWikiLinkPreviewAtMouseEvent(
            {
                metaKey: true,
                ctrlKey: false,
                target: createRenderTarget({ rendered: true }),
                clientX: 14,
                clientY: 18,
            },
            {
                state,
                posAtCoords() {
                    return 4;
                },
            },
        );

        expect(match).toEqual({
            from: 0,
            to: 15,
            target: "Target Note",
            displayText: "Target Note",
            anchorPos: 0,
        });
    });

    it("解析 alias widget 的 hover 命中", () => {
        const state = EditorState.create({
            doc: "[[Target Note|Alias]]",
        });

        const match = resolveWikiLinkPreviewAtMouseEvent(
            {
                metaKey: true,
                ctrlKey: false,
                target: createRenderTarget({
                    rendered: true,
                    widgetTarget: "Target Note",
                }),
                clientX: 10,
                clientY: 18,
            },
            {
                state,
                posAtCoords() {
                    return 14;
                },
            },
        );

        expect(match?.target).toBe("Target Note");
        expect(match?.displayText).toBe("Alias");
        expect(match?.anchorPos).toBe(0);
    });

    it("非渲染态 hover 不触发预览", () => {
        const state = EditorState.create({
            doc: "[[Target Note]]",
        });

        const match = resolveWikiLinkPreviewAtMouseEvent(
            {
                metaKey: true,
                ctrlKey: false,
                target: createRenderTarget(),
                clientX: 10,
                clientY: 18,
            },
            {
                state,
                posAtCoords() {
                    return 4;
                },
            },
        );

        expect(match).toBeNull();
    });
});