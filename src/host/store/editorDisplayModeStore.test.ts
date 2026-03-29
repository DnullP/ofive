/**
 * @module host/store/editorDisplayModeStore.test
 * @description editorDisplayModeStore 回归测试，覆盖全局编辑器显示模式的更新与读取。
 * @dependencies
 *  - bun:test
 *  - ./editorDisplayModeStore
 */

import { describe, expect, it } from "bun:test";
import {
    getEditorDisplayModeSnapshot,
    updateEditorDisplayMode,
} from "./editorDisplayModeStore";

describe("editorDisplayModeStore", () => {
    it("should default to edit mode", () => {
        updateEditorDisplayMode("edit");
        expect(getEditorDisplayModeSnapshot().displayMode).toBe("edit");
    });

    it("should update global display mode", () => {
        updateEditorDisplayMode("read");
        expect(getEditorDisplayModeSnapshot().displayMode).toBe("read");

        updateEditorDisplayMode("edit");
        expect(getEditorDisplayModeSnapshot().displayMode).toBe("edit");
    });
});