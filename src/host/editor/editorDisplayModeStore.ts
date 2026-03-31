/**
 * @module host/editor/editorDisplayModeStore
 * @description 编辑器显示模式全局状态管理：集中维护所有 Markdown editor 共享的编辑态/阅读态开关。
 * @dependencies
 *  - react (useSyncExternalStore)
 *
 * @example
 *   const { displayMode } = useEditorDisplayModeState();
 *   updateEditorDisplayMode("read");
 *
 * @exports
 *  - EditorDisplayMode 编辑器显示模式类型
 *  - useEditorDisplayModeState 订阅全局编辑器显示模式
 *  - updateEditorDisplayMode 更新全局编辑器显示模式
 *  - getEditorDisplayModeSnapshot 读取当前全局快照
 */

import { useSyncExternalStore } from "react";

/**
 * @type EditorDisplayMode
 * @description 编辑器显示模式：`edit` 为可编辑态，`read` 为阅读态。
 */
export type EditorDisplayMode = "edit" | "read";

/**
 * @interface EditorDisplayModeState
 * @description 编辑器显示模式状态快照。
 */
interface EditorDisplayModeState {
    /** 当前全局生效的编辑器显示模式。 */
    displayMode: EditorDisplayMode;
}

/**
 * @function isEditorDisplayMode
 * @description 判断输入值是否为合法编辑器显示模式。
 * @param value 待判断值。
 * @returns 合法时返回 true。
 */
function isEditorDisplayMode(value: unknown): value is EditorDisplayMode {
    return value === "edit" || value === "read";
}

/**
 * @class EditorDisplayModeStore
 * @description 编辑器显示模式全局 Store。
 *
 * @state
 *  - displayMode - 全局编辑器显示模式 (EditorDisplayMode) ["edit"]
 *
 * @lifecycle
 *  - 初始化时机：模块首次导入时初始化
 *  - 数据来源：前端内存状态
 *  - 更新触发：updateEditorDisplayMode
 *  - 清理时机：页面刷新后重建
 *
 * @sync
 *  - 与后端同步：否
 *  - 缓存策略：仅内存缓存
 *  - 与其他Store的关系：CodeMirrorEditorTab 订阅本 Store 决定编辑态/阅读态
 */
class EditorDisplayModeStore {
    private state: EditorDisplayModeState = {
        displayMode: "edit",
    };

    private listeners = new Set<() => void>();

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getSnapshot(): EditorDisplayModeState {
        return this.state;
    }

    updateDisplayMode(displayMode: EditorDisplayMode): void {
        if (!isEditorDisplayMode(displayMode)) {
            console.warn("[editor-display-mode-store] invalid display mode ignored", {
                displayMode,
            });
            return;
        }

        if (this.state.displayMode === displayMode) {
            return;
        }

        const previousMode = this.state.displayMode;
        this.state = {
            displayMode,
        };
        this.listeners.forEach((listener) => listener());

        console.info("[editor-display-mode-store] display mode updated", {
            previousMode,
            nextMode: displayMode,
        });
    }
}

const editorDisplayModeStore = new EditorDisplayModeStore();

/**
 * @function useEditorDisplayModeState
 * @description 订阅全局编辑器显示模式。
 * @returns 当前显示模式快照。
 */
export function useEditorDisplayModeState(): EditorDisplayModeState {
    return useSyncExternalStore(
        (listener) => editorDisplayModeStore.subscribe(listener),
        () => editorDisplayModeStore.getSnapshot(),
        () => editorDisplayModeStore.getSnapshot(),
    );
}

/**
 * @function updateEditorDisplayMode
 * @description 更新全局编辑器显示模式。
 * @param displayMode 目标显示模式。
 */
export function updateEditorDisplayMode(displayMode: EditorDisplayMode): void {
    editorDisplayModeStore.updateDisplayMode(displayMode);
}

/**
 * @function getEditorDisplayModeSnapshot
 * @description 非响应式读取当前编辑器显示模式快照。
 * @returns 当前显示模式快照。
 */
export function getEditorDisplayModeSnapshot(): EditorDisplayModeState {
    return editorDisplayModeStore.getSnapshot();
}