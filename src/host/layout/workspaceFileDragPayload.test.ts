/**
 * @module host/layout/workspaceFileDragPayload.test
 * @description 工作区文件拖拽 payload 测试：
 *   验证 hover 阶段可通过 drag types 判断是否包含文件，
 *   同时保持 drop 阶段的完整 payload 解析与归一化行为。
 * @dependencies
 *   - bun:test
 *   - ./workspaceFileDragPayload
 *
 * @example
 *   bun test src/host/layout/workspaceFileDragPayload.test.ts
 */

import { expect, test } from "bun:test";
import {
    hasWorkspaceFileDragPayload,
    hasWorkspaceFileDragPayloadFiles,
    readWorkspaceFileDragPayload,
    WORKSPACE_FILE_DRAG_MIME_TYPE,
    writeWorkspaceFileDragPayload,
} from "./workspaceFileDragPayload";

/**
 * @interface MockDataTransfer
 * @description 测试用 DataTransfer 替身，仅覆盖当前模块依赖的最小接口。
 */
interface MockDataTransfer {
    types: string[];
    setData: (format: string, value: string) => void;
    getData: (format: string) => string;
}

/**
 * @function createMockDataTransfer
 * @description 构造可模拟 dragstart / dragover / drop 的 DataTransfer。
 * @returns 可被当前测试复用的 mock DataTransfer。
 */
function createMockDataTransfer(): DataTransfer & MockDataTransfer {
    const store = new Map<string, string>();

    return {
        get types(): string[] {
            return Array.from(store.keys());
        },
        setData(format: string, value: string): void {
            store.set(format, value);
        },
        getData(format: string): string {
            return store.get(format) ?? "";
        },
    } as DataTransfer & MockDataTransfer;
}

test("should mark workspace file drags as hover-detectable when selection contains files", () => {
    const dataTransfer = createMockDataTransfer();

    writeWorkspaceFileDragPayload(dataTransfer, [
        { path: "notes/a.md", isDir: false },
        { path: "notes", isDir: true },
    ]);

    expect(hasWorkspaceFileDragPayload(dataTransfer)).toBe(true);
    expect(hasWorkspaceFileDragPayloadFiles(dataTransfer)).toBe(true);
});

test("should keep directory-only drags from advertising file hover acceptance", () => {
    const dataTransfer = createMockDataTransfer();

    writeWorkspaceFileDragPayload(dataTransfer, [
        { path: "notes", isDir: true },
    ]);

    expect(hasWorkspaceFileDragPayload(dataTransfer)).toBe(true);
    expect(hasWorkspaceFileDragPayloadFiles(dataTransfer)).toBe(false);
});

test("should write and read normalized workspace file payload", () => {
    const dataTransfer = createMockDataTransfer();

    writeWorkspaceFileDragPayload(dataTransfer, [
        { path: "notes\\guide.md", isDir: false },
        { path: "assets", isDir: true },
    ]);

    expect(dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME_TYPE)).not.toBe("");
    expect(dataTransfer.getData("text/plain")).toBe("");
    expect(readWorkspaceFileDragPayload(dataTransfer)).toEqual([
        { path: "notes/guide.md", isDir: false },
        { path: "assets", isDir: true },
    ]);
});

test("should ignore invalid payload entries", () => {
    const dataTransfer = createMockDataTransfer();
    dataTransfer.setData(WORKSPACE_FILE_DRAG_MIME_TYPE, JSON.stringify([
        { path: "", isDir: false },
        null,
        { path: "notes/ok.md", isDir: 0 },
    ]));

    expect(readWorkspaceFileDragPayload(dataTransfer)).toEqual([
        { path: "notes/ok.md", isDir: false },
    ]);
});