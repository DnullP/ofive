/**
 * @module plugins/ai-chat/aiChatRollback.test
 * @description AI chat rollback checkpoint tests.
 */

import { describe, expect, it } from "bun:test";
import {
    captureAiChatRollbackCheckpoint,
    isRollbackableAiChatFilePath,
    restoreAiChatRollbackCheckpoint,
} from "./aiChatRollback";

describe("aiChatRollback", () => {
    it("captures only rollbackable vault files", async () => {
        const checkpoint = await captureAiChatRollbackCheckpoint({
            files: [
                { path: "notes/B.md", isDir: false },
                { path: "notes", isDir: true },
                { path: "board.canvas", isDir: false },
                { path: "asset.png", isDir: false },
                { path: "notes/A.markdown", isDir: false },
            ],
            readMarkdownFile: async (relativePath) => ({ content: `md:${relativePath}` }),
            readCanvasFile: async (relativePath) => ({ content: `canvas:${relativePath}` }),
            checkpointId: "checkpoint-1",
            nowUnixMs: 10,
        });

        expect(checkpoint.id).toBe("checkpoint-1");
        expect(checkpoint.files.map((file) => file.relativePath)).toEqual([
            "board.canvas",
            "notes/A.markdown",
            "notes/B.md",
        ]);
        expect(checkpoint.files[0]?.content).toBe("canvas:board.canvas");
        expect(isRollbackableAiChatFilePath("asset.png")).toBe(false);
    });

    it("restores checkpoint files and deletes rollbackable files created later", async () => {
        const restored: string[] = [];
        const deleted: string[] = [];

        const result = await restoreAiChatRollbackCheckpoint({
            id: "checkpoint-1",
            createdAtUnixMs: 10,
            files: [
                {
                    relativePath: "notes/A.md",
                    kind: "markdown",
                    content: "# A",
                },
                {
                    relativePath: "board.canvas",
                    kind: "canvas",
                    content: "{\"nodes\":[],\"edges\":[]}",
                },
            ],
        }, {
            files: [
                { path: "notes/A.md", isDir: false },
                { path: "notes/New.md", isDir: false },
                { path: "board.canvas", isDir: false },
                { path: "image.png", isDir: false },
            ],
            saveMarkdownFile: async (relativePath, content) => {
                restored.push(`${relativePath}:${content}`);
            },
            saveCanvasFile: async (relativePath, content) => {
                restored.push(`${relativePath}:${content}`);
            },
            deleteMarkdownFile: async (relativePath) => {
                deleted.push(relativePath);
            },
            deleteCanvasFile: async (relativePath) => {
                deleted.push(relativePath);
            },
        });

        expect(result.deletedPaths).toEqual(["notes/New.md"]);
        expect(result.restoredPaths).toEqual(["notes/A.md", "board.canvas"]);
        expect(deleted).toEqual(["notes/New.md"]);
        expect(restored).toEqual([
            "notes/A.md:# A",
            "board.canvas:{\"nodes\":[],\"edges\":[]}",
        ]);
    });
});
