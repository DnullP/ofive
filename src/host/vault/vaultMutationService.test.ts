/**
 * @module host/vault/vaultMutationService.test
 * @description Vault mutation service 回归测试：确认本地 rename/move/delete 会发布持久内容语义事件。
 * @dependencies
 *  - bun:test
 *  - ../../test-support/mockVaultApi
 *  - ../events/appEventBus
 *  - ./vaultMutationService
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createMockVaultApi } from "../../test-support/mockVaultApi";

const apiCalls: Array<{
    name: string;
    args: string[];
}> = [];

mock.module("../../api/vaultApi", () => createMockVaultApi({
    renameVaultMarkdownFile: async (fromRelativePath: string, toRelativePath: string) => {
        apiCalls.push({
            name: "renameVaultMarkdownFile",
            args: [fromRelativePath, toRelativePath],
        });
        return {
            relativePath: toRelativePath,
            created: false,
        };
    },
    moveVaultCanvasFileToDirectory: async (fromRelativePath: string, targetDirectoryRelativePath: string) => {
        apiCalls.push({
            name: "moveVaultCanvasFileToDirectory",
            args: [fromRelativePath, targetDirectoryRelativePath],
        });
        return {
            relativePath: `${targetDirectoryRelativePath}/board.canvas`,
            created: false,
        };
    },
    moveVaultFileToDirectory: async (fromRelativePath: string, targetDirectoryRelativePath: string) => {
        apiCalls.push({
            name: "moveVaultFileToDirectory",
            args: [fromRelativePath, targetDirectoryRelativePath],
        });
        return {
            relativePath: `${targetDirectoryRelativePath}/photo.png`,
            created: false,
        };
    },
    deleteVaultMarkdownFile: async (relativePath: string) => {
        apiCalls.push({
            name: "deleteVaultMarkdownFile",
            args: [relativePath],
        });
    },
}));

const {
    subscribePersistedContentUpdatedEvent,
} = await import("../events/appEventBus");
const {
    deletePersistedMarkdownFile,
    movePersistedCanvasFileToDirectory,
    movePersistedFileToDirectory,
    renamePersistedMarkdownFile,
} = await import("./vaultMutationService");

describe("vaultMutationService", () => {
    beforeEach(() => {
        apiCalls.length = 0;
    });

    it("should emit a persisted mutation event after markdown rename", async () => {
        const events: Array<{
            relativePath: string;
            source: string;
            operation?: string;
            oldRelativePath?: string;
        }> = [];
        const unlisten = subscribePersistedContentUpdatedEvent((event) => {
            events.push({
                relativePath: event.relativePath,
                source: event.source,
                operation: event.operation,
                oldRelativePath: event.oldRelativePath,
            });
        });

        await renamePersistedMarkdownFile("Notes\\old.md", "Notes/new.md");
        unlisten();

        expect(apiCalls).toEqual([{
            name: "renameVaultMarkdownFile",
            args: ["Notes/old.md", "Notes/new.md"],
        }]);
        expect(events).toEqual([{
            relativePath: "Notes/new.md",
            source: "save",
            operation: "renamed",
            oldRelativePath: "Notes/old.md",
        }]);
    });

    it("should emit a persisted mutation event after canvas move", async () => {
        const events: Array<{ relativePath: string; operation?: string; oldRelativePath?: string }> = [];
        const unlisten = subscribePersistedContentUpdatedEvent((event) => {
            events.push({
                relativePath: event.relativePath,
                operation: event.operation,
                oldRelativePath: event.oldRelativePath,
            });
        });

        await movePersistedCanvasFileToDirectory("Boards\\board.canvas", "Archive");
        unlisten();

        expect(apiCalls).toEqual([{
            name: "moveVaultCanvasFileToDirectory",
            args: ["Boards/board.canvas", "Archive"],
        }]);
        expect(events).toEqual([{
            relativePath: "Archive/board.canvas",
            operation: "moved",
            oldRelativePath: "Boards/board.canvas",
        }]);
    });

    it("should emit a persisted mutation event after generic file move", async () => {
        const events: Array<{ relativePath: string; operation?: string; oldRelativePath?: string }> = [];
        const unlisten = subscribePersistedContentUpdatedEvent((event) => {
            events.push({
                relativePath: event.relativePath,
                operation: event.operation,
                oldRelativePath: event.oldRelativePath,
            });
        });

        await movePersistedFileToDirectory("Assets\\photo.png", "Archive");
        unlisten();

        expect(apiCalls).toEqual([{
            name: "moveVaultFileToDirectory",
            args: ["Assets/photo.png", "Archive"],
        }]);
        expect(events).toEqual([{
            relativePath: "Archive/photo.png",
            operation: "moved",
            oldRelativePath: "Assets/photo.png",
        }]);
    });

    it("should emit a persisted mutation event after markdown delete", async () => {
        const events: Array<{ relativePath: string; operation?: string }> = [];
        const unlisten = subscribePersistedContentUpdatedEvent((event) => {
            events.push({
                relativePath: event.relativePath,
                operation: event.operation,
            });
        });

        await deletePersistedMarkdownFile("Notes\\delete-me.md");
        unlisten();

        expect(apiCalls).toEqual([{
            name: "deleteVaultMarkdownFile",
            args: ["Notes/delete-me.md"],
        }]);
        expect(events).toEqual([{
            relativePath: "Notes/delete-me.md",
            operation: "deleted",
        }]);
    });
});
