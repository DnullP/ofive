/**
 * @module plugins/fileTree/fileTreeClipboard.test
 * @description 文件树插件剪贴板模块单元测试。
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
    clearFileTreeClipboard,
    getFileTreeClipboardEntry,
    setFileTreeClipboardEntry,
} from "./fileTreeClipboard";

describe("fileTreeClipboard", () => {
    beforeEach(() => {
        clearFileTreeClipboard();
    });

    test("should return null when clipboard is empty", () => {
        expect(getFileTreeClipboardEntry()).toBeNull();
    });

    test("should store and retrieve a file entry", () => {
        setFileTreeClipboardEntry({ path: "notes/test.md", isDir: false });
        const entry = getFileTreeClipboardEntry();
        expect(entry).toEqual({ path: "notes/test.md", isDir: false });
    });

    test("should store and retrieve a directory entry", () => {
        setFileTreeClipboardEntry({ path: "notes/subdir", isDir: true });
        const entry = getFileTreeClipboardEntry();
        expect(entry).toEqual({ path: "notes/subdir", isDir: true });
    });

    test("should overwrite previous entry when setting a new one", () => {
        setFileTreeClipboardEntry({ path: "notes/old.md", isDir: false });
        setFileTreeClipboardEntry({ path: "notes/new.md", isDir: false });
        const entry = getFileTreeClipboardEntry();
        expect(entry?.path).toBe("notes/new.md");
    });

    test("should return null after clearing", () => {
        setFileTreeClipboardEntry({ path: "notes/test.md", isDir: false });
        clearFileTreeClipboard();
        expect(getFileTreeClipboardEntry()).toBeNull();
    });

    test("should create a defensive copy", () => {
        const original = { path: "notes/ref.md", isDir: false };
        setFileTreeClipboardEntry(original);
        original.path = "notes/mutated.md";
        expect(getFileTreeClipboardEntry()?.path).toBe("notes/ref.md");
    });
});