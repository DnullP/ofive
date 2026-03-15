/**
 * @module host/commands/focusContext.test
 * @description focusContext 模块的单元测试，含条件匹配回归测试。
 *
 * FocusedComponent 采用 dockview 层级模式：
 *   - "tab:<component>"  — 主区域选项卡（如 "tab:codemirror"）
 *   - "panel:<id>"       — 侧边栏面板（如 "panel:files"）
 *   - "other"            — 未匹配到任何 dockview 组件
 */

import { describe, expect, test } from "bun:test";
import {
    isConditionSatisfied,
    SHORTCUT_CONDITION_LABELS,
    type ShortcutCondition,
} from "./focusContext";

describe("isConditionSatisfied", () => {
    test("should return true when condition is undefined (global command)", () => {
        expect(isConditionSatisfied(undefined, "tab:codemirror")).toBe(true);
        expect(isConditionSatisfied(undefined, "panel:files")).toBe(true);
        expect(isConditionSatisfied(undefined, "other")).toBe(true);
    });

    test("should return true for editorFocused when codemirror tab is focused", () => {
        expect(isConditionSatisfied("editorFocused", "tab:codemirror")).toBe(true);
    });

    test("should return false for editorFocused when codemirror tab is not focused", () => {
        expect(isConditionSatisfied("editorFocused", "panel:files")).toBe(false);
        expect(isConditionSatisfied("editorFocused", "other")).toBe(false);
    });

    test("should return true for fileTreeFocused when files panel is focused", () => {
        expect(isConditionSatisfied("fileTreeFocused", "panel:files")).toBe(true);
    });

    test("should return false for fileTreeFocused when files panel is not focused", () => {
        expect(isConditionSatisfied("fileTreeFocused", "tab:codemirror")).toBe(false);
        expect(isConditionSatisfied("fileTreeFocused", "other")).toBe(false);
    });
});

describe("SHORTCUT_CONDITION_LABELS", () => {
    test("should have i18n keys for all known conditions", () => {
        expect(SHORTCUT_CONDITION_LABELS.editorFocused).toBe("focusContext.editorFocused");
        expect(SHORTCUT_CONDITION_LABELS.fileTreeFocused).toBe("focusContext.fileTreeFocused");
    });
});

/**
 * 回归测试：确保条件匹配机制在命令调度中正确过滤不属于当前上下文的命令。
 * 此测试覆盖两个历史缺陷：
 *  1. 编辑器内 Cmd+C 误触发 fileTree.copySelected（编辑器 handler 缺少条件过滤）
 *  2. 全局 handler 中条件命令优先级低于无条件命令（优先级反转）
 *
 * 测试不直接导入 commandSystem（其依赖链含 import.meta.glob），
 * 而是用等价的数据结构模拟命令注册表和调度算法。
 *
 * FocusedComponent 使用 dockview 命名模式：
 *   - "tab:codemirror" 代表编辑器
 *   - "panel:files" 代表文件树
 */
describe("regression: condition-aware command matching", () => {
    /** 模拟命令条件注册表 */
    const MOCK_COMMAND_CONDITIONS: Record<string, ShortcutCondition | undefined> = {
        "fileTree.copySelected": "fileTreeFocused",
        "fileTree.pasteInDirectory": "fileTreeFocused",
        "editor.undo": "editorFocused",
        "editor.redo": "editorFocused",
        "editor.selectAll": "editorFocused",
        "editor.find": "editorFocused",
        "quickSwitcher.open": undefined,
        "commandPalette.open": undefined,
        "file.saveFocused": undefined,
    };

    /** 辅助：获取命令条件（模拟 getCommandCondition） */
    const getCondition = (id: string): ShortcutCondition | undefined =>
        MOCK_COMMAND_CONDITIONS[id];

    /**
     * 回归：编辑器 handler 曾对 bindings 不做条件过滤，
     * 导致 fileTree.copySelected (Cmd+C) 在编辑器中被匹配并执行。
     * 此测试模拟编辑器 handler 中的过滤逻辑。
     */
    test("editor handler should NOT match fileTree-conditioned commands", () => {
        const bindings: Record<string, string> = {
            "fileTree.copySelected": "Cmd+C",
            "fileTree.pasteInDirectory": "Cmd+V",
            "editor.undo": "Cmd+Z",
            "quickSwitcher.open": "Cmd+O",
        };

        // 模拟编辑器 handler 的过滤逻辑：快捷键匹配后仅保留条件满足 "tab:codemirror" 的命令
        const matchedShortcut = "Cmd+C";
        const candidateIds = Object.entries(bindings)
            .filter(([, shortcut]) => shortcut === matchedShortcut)
            .map(([id]) => id);

        const editorMatch = candidateIds.find((id) => {
            const condition = getCondition(id);
            return isConditionSatisfied(condition, "tab:codemirror");
        });

        // fileTree.copySelected 不应在编辑器上下文中匹配
        expect(editorMatch).toBeUndefined();
    });

    /**
     * 编辑器 handler 应正确匹配 editorFocused 条件的命令。
     */
    test("editor handler should match editor-conditioned commands", () => {
        const bindings: Record<string, string> = {
            "editor.undo": "Cmd+Z",
            "fileTree.copySelected": "Cmd+C",
        };

        const matchedShortcut = "Cmd+Z";
        const candidateIds = Object.entries(bindings)
            .filter(([, shortcut]) => shortcut === matchedShortcut)
            .map(([id]) => id);

        const editorMatch = candidateIds.find((id) => {
            const condition = getCondition(id);
            return isConditionSatisfied(condition, "tab:codemirror");
        });

        expect(editorMatch).toBe("editor.undo");
    });

    /**
     * 编辑器 handler 应正确匹配无条件的全局命令。
     */
    test("editor handler should match unconditioned global commands", () => {
        const bindings: Record<string, string> = {
            "quickSwitcher.open": "Cmd+O",
            "fileTree.copySelected": "Cmd+C",
        };

        const matchedShortcut = "Cmd+O";
        const candidateIds = Object.entries(bindings)
            .filter(([, shortcut]) => shortcut === matchedShortcut)
            .map(([id]) => id);

        const editorMatch = candidateIds.find((id) => {
            const condition = getCondition(id);
            return isConditionSatisfied(condition, "tab:codemirror");
        });

        expect(editorMatch).toBe("quickSwitcher.open");
    });

    /**
     * 回归：全局 handler 应优先选择条件满足的命令而非无条件命令。
     */
    test("global handler should prefer conditioned match over unconditioned", () => {
        const candidateIds = ["fileTree.copySelected", "file.saveFocused"];

        // 在 panel:files 上下文中，条件命令应被选中
        const conditionedMatch = candidateIds.find((id) => {
            const condition = getCondition(id);
            return condition !== undefined && isConditionSatisfied(condition, "panel:files");
        });
        const unconditionedMatch = candidateIds.find((id) => {
            const condition = getCondition(id);
            return condition === undefined;
        });
        const selectedCommand = conditionedMatch ?? unconditionedMatch ?? null;

        expect(selectedCommand).toBe("fileTree.copySelected");
    });

    /**
     * 全局 handler 在无条件命令匹配时，不应选中不满足条件的命令。
     */
    test("global handler should fallback to unconditioned when condition not met", () => {
        const candidateIds = ["fileTree.copySelected", "file.saveFocused"];

        // 在 "other" 上下文中，fileTreeFocused 条件不满足
        const conditionedMatch = candidateIds.find((id) => {
            const condition = getCondition(id);
            return condition !== undefined && isConditionSatisfied(condition, "other");
        });
        const unconditionedMatch = candidateIds.find((id) => {
            const condition = getCondition(id);
            return condition === undefined;
        });
        const selectedCommand = conditionedMatch ?? unconditionedMatch ?? null;

        // 应回退到无条件的 file.saveFocused
        expect(selectedCommand).toBe("file.saveFocused");
    });

    /**
     * 全局 handler 在仅有条件不满足的命令时，不应选中任何命令。
     */
    test("global handler should return null when only mismatched conditions", () => {
        const candidateIds = ["fileTree.copySelected"];

        const conditionedMatch = candidateIds.find((id) => {
            const condition = getCondition(id);
            return condition !== undefined && isConditionSatisfied(condition, "tab:codemirror");
        });
        const unconditionedMatch = candidateIds.find((id) => {
            const condition = getCondition(id);
            return condition === undefined;
        });
        const selectedCommand = conditionedMatch ?? unconditionedMatch ?? null;

        expect(selectedCommand).toBeNull();
    });
});
