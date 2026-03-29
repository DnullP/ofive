/**
 * @module plugins/markdown-codemirror/editor/readModeSelectionPolicy.test
 * @description readModeSelectionPolicy 模块单元测试。
 * @dependencies
 *  - bun:test
 *  - ./readModeSelectionPolicy
 */

import { describe, expect, test } from "bun:test";
import { shouldSkipWikiLinkNavigationForSelection, type SelectionLike } from "./readModeSelectionPolicy";

function createLinkNode(): Node {
    return {} as Node;
}

describe("readModeSelectionPolicy", () => {
    test("should allow navigation when selection is collapsed", () => {
        const selection: SelectionLike = {
            isCollapsed: true,
            rangeCount: 1,
            getRangeAt: () => ({
                intersectsNode: () => true,
            }),
        };

        expect(shouldSkipWikiLinkNavigationForSelection(selection, createLinkNode())).toBe(false);
    });

    test("should skip navigation when selection intersects clicked link", () => {
        const selection: SelectionLike = {
            isCollapsed: false,
            rangeCount: 1,
            getRangeAt: () => ({
                intersectsNode: () => true,
            }),
        };

        expect(shouldSkipWikiLinkNavigationForSelection(selection, createLinkNode())).toBe(true);
    });

    test("should allow navigation when selection does not intersect clicked link", () => {
        const selection: SelectionLike = {
            isCollapsed: false,
            rangeCount: 2,
            getRangeAt: (index) => ({
                intersectsNode: () => index === 1 ? false : false,
            }),
        };

        expect(shouldSkipWikiLinkNavigationForSelection(selection, createLinkNode())).toBe(false);
    });

    test("should fail open when range inspection throws", () => {
        const selection: SelectionLike = {
            isCollapsed: false,
            rangeCount: 1,
            getRangeAt: () => {
                throw new Error("range unavailable");
            },
        };

        expect(shouldSkipWikiLinkNavigationForSelection(selection, createLinkNode())).toBe(false);
    });
});