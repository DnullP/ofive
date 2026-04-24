/**
 * @module plugins/markdown-codemirror/editor/handoff/vimHandoffRegistry.test
 * @description Vim handoff 注册中心单元测试。
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
    listRegisteredVimHandoffs,
    registerVimHandoff,
    resolveRegisteredVimHandoff,
    unregisterVimHandoff,
    type VimHandoffContext,
} from "./vimHandoffRegistry";

const TEST_HANDOFF_IDS = [
    "test.alpha",
    "test.beta",
    "test.surface-frontmatter",
];

function createBaseContext(): VimHandoffContext {
    return {
        surface: "editor-body",
        key: "j",
        markdown: "Before\n$$x^2$$\nAfter",
        currentLineNumber: 1,
        selectionHead: 0,
        hasFrontmatter: false,
        firstBodyLineNumber: 1,
        isVimEnabled: true,
        isVimNormalMode: true,
    };
}

afterEach(() => {
    TEST_HANDOFF_IDS.forEach((handoffId) => unregisterVimHandoff(handoffId));
});

describe("vimHandoffRegistry", () => {
    test("should resolve the highest-priority matching handoff first", () => {
        registerVimHandoff({
            id: "test.beta",
            owner: "test-owner",
            surface: "editor-body",
            priority: 200,
            description: "low priority handoff",
            resolve: () => ({
                kind: "move-selection",
                targetLineNumber: 9,
                reason: "beta",
            }),
        });

        registerVimHandoff({
            id: "test.alpha",
            owner: "test-owner",
            surface: "editor-body",
            priority: 100,
            description: "high priority handoff",
            resolve: () => ({
                kind: "move-selection",
                targetLineNumber: 3,
                reason: "alpha",
            }),
        });

        expect(resolveRegisteredVimHandoff(createBaseContext())).toEqual({
            kind: "move-selection",
            targetLineNumber: 3,
            reason: "alpha",
        });
    });

    test("should filter by surface before resolving", () => {
        registerVimHandoff({
            id: "test.surface-frontmatter",
            owner: "test-owner",
            surface: "frontmatter-navigation",
            priority: 100,
            description: "frontmatter only handoff",
            resolve: () => ({
                kind: "focus-widget-navigation",
                widget: "frontmatter",
                position: "first",
                reason: "frontmatter-only",
            }),
        });

        expect(resolveRegisteredVimHandoff(createBaseContext())).toBeNull();
    });

    test("should expose registrations in stable priority order", () => {
        registerVimHandoff({
            id: "test.beta",
            owner: "test-owner",
            surface: "editor-body",
            priority: 200,
            description: "beta",
            resolve: () => null,
        });

        registerVimHandoff({
            id: "test.alpha",
            owner: "test-owner",
            surface: "editor-body",
            priority: 100,
            description: "alpha",
            resolve: () => null,
        });

        expect(listRegisteredVimHandoffs()
            .filter((registration) => TEST_HANDOFF_IDS.includes(registration.id))
            .map((registration) => registration.id)).toEqual([
                "test.alpha",
                "test.beta",
            ]);
    });
});