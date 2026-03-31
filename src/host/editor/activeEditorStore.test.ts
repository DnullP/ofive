/**
 * @module host/editor/activeEditorStore.test
 * @description activeEditorStore 回归测试，覆盖活跃 Markdown 编辑器状态的写入与清理。
 * @dependencies
 *  - bun:test
 *  - ./activeEditorStore
 *
 * @example
 *   bun test src/host/editor/activeEditorStore.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    clearActiveEditor,
    getActiveEditorSnapshot,
    reportActiveEditor,
} from "./activeEditorStore";

describe("activeEditorStore", () => {
    /**
     * @function should_store_active_markdown_editor_snapshot
     * @description 上报活跃 Markdown 编辑器后，应能读取到对应快照。
     */
    it("should store active markdown editor snapshot", () => {
        clearActiveEditor();

        reportActiveEditor({
            articleId: "file:notes/alpha.md",
            path: "notes/alpha.md",
        });

        const snapshot = getActiveEditorSnapshot();
        expect(snapshot).not.toBeNull();
        expect(snapshot?.articleId).toBe("file:notes/alpha.md");
        expect(snapshot?.path).toBe("notes/alpha.md");
        expect(snapshot?.title).toBe("alpha.md");
        expect(snapshot?.kind).toBe("markdown");
    });

    /**
     * @function should_replace_previous_active_editor
     * @description 再次上报时，应覆盖旧的活跃编辑器快照。
     */
    it("should replace previous active editor", () => {
        clearActiveEditor();

        reportActiveEditor({
            articleId: "file:notes/alpha.md",
            path: "notes/alpha.md",
        });
        reportActiveEditor({
            articleId: "file:notes/beta.md",
            path: "notes/beta.md",
        });

        const snapshot = getActiveEditorSnapshot();
        expect(snapshot?.articleId).toBe("file:notes/beta.md");
        expect(snapshot?.path).toBe("notes/beta.md");
        expect(snapshot?.title).toBe("beta.md");
    });

    /**
     * @function should_clear_active_editor_snapshot
     * @description 清空后不应残留旧状态。
     */
    it("should clear active editor snapshot", () => {
        reportActiveEditor({
            articleId: "file:notes/gamma.md",
            path: "notes/gamma.md",
        });

        clearActiveEditor();

        expect(getActiveEditorSnapshot()).toBeNull();
    });
});