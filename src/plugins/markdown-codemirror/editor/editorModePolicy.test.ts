/**
 * @module plugins/markdown-codemirror/editor/editorModePolicy.test
 * @description editorModePolicy 模块单元测试。
 * @dependencies
 *  - bun:test
 *  - ./editorModePolicy
 *
 * @example
 *   bun test src/plugins/markdown-codemirror/editor/editorModePolicy.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
    canExecuteEditorNativeCommandInMode,
    canMutateEditorDocument,
    toggleEditorDisplayMode,
} from "./editorModePolicy";

describe("editorModePolicy", () => {
    test("should allow all native commands in edit mode", () => {
        expect(canExecuteEditorNativeCommandInMode("edit", "editor.toggleBold")).toBe(true);
        expect(canExecuteEditorNativeCommandInMode("edit", "editor.find")).toBe(true);
    });

    test("should only allow safe commands in read mode", () => {
        expect(canExecuteEditorNativeCommandInMode("read", "editor.find")).toBe(true);
        expect(canExecuteEditorNativeCommandInMode("read", "editor.selectAll")).toBe(true);
        expect(canExecuteEditorNativeCommandInMode("read", "editor.toggleBold")).toBe(false);
        expect(canExecuteEditorNativeCommandInMode("read", "editor.toggleWikiLink")).toBe(false);
        expect(canExecuteEditorNativeCommandInMode("read", "editor.insertTask")).toBe(false);
        expect(canExecuteEditorNativeCommandInMode("read", "editor.insertFrontmatter")).toBe(false);
        expect(canExecuteEditorNativeCommandInMode("read", "editor.insertTable")).toBe(false);
        expect(canExecuteEditorNativeCommandInMode("read", "editor.segmentedDeleteBackward")).toBe(false);
    });

    test("should expose mutation boundary and mode toggle", () => {
        expect(canMutateEditorDocument("edit")).toBe(true);
        expect(canMutateEditorDocument("read")).toBe(false);
        expect(toggleEditorDisplayMode("edit")).toBe("read");
        expect(toggleEditorDisplayMode("read")).toBe("edit");
    });
});
