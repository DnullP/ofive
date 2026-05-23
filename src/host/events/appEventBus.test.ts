/**
 * @module host/events/appEventBus.test
 * @description 应用事件总线回归测试，覆盖前端编辑事件发布与订阅语义。
 * @dependencies
 *  - bun:test
 *  - ./appEventBus
 *
 * @example
 *   bun test src/host/events/appEventBus.test.ts
 */

import { describe, expect, it, mock } from "bun:test";
import { createMockVaultApi } from "../../test-support/mockVaultApi";

mock.module("../../api/vaultApi", () => createMockVaultApi({
    searchVaultMarkdown: async () => [],
    suggestWikiLinkTargets: async () => [],
    resolveWikiLinkTarget: async () => null,
    readVaultMarkdownFile: async () => ({ content: "# latest" }),
    saveVaultMarkdownFile: async () => ({ relativePath: "notes/demo.md", created: false }),
    getCurrentVaultConfig: async () => ({
        feature_settings: {},
    }),
    saveCurrentVaultConfig: async () => ({
        feature_settings: {},
    }),
}));

const {
    emitCustomActivityRemovalRequestedEvent,
    emitEditorContentChangedEvent,
    emitEditorFocusChangedEvent,
    emitEditorRevealRequestedEvent,
    emitFileTreeRenameRequestedEvent,
    emitVaultBeforeChangeEvent,
    subscribeCustomActivityRemovalRequestedEvent,
    subscribeEditorContentBusEvent,
    subscribeEditorFocusBusEvent,
    subscribeEditorRevealRequestedEvent,
    subscribeFileTreeRenameRequestedEvent,
    subscribeVaultBeforeChangeEvent,
} = await import("./appEventBus");

describe("appEventBus editor event flow", () => {
    /**
     * @function should_publish_editor_content_event_with_monotonic_frontend_event_id
     * @description 发布编辑内容事件后，订阅者应收到有效 payload，且 eventId 具备前缀语义。
     */
    it("should publish editor content event with monotonic frontend event id", () => {
        let capturedEventId: string | null = null;
        let capturedContent = "";

        const unlisten = subscribeEditorContentBusEvent((payload) => {
            capturedEventId = payload.eventId;
            capturedContent = payload.content;
        });

        emitEditorContentChangedEvent({
            articleId: "file:test-content",
            path: "notes/content.md",
            content: "# Content Bus",
            updatedAt: Date.now(),
        });

        unlisten();

        expect(capturedEventId).not.toBeNull();
        expect((capturedEventId ?? "").startsWith("frontend-")).toBe(true);
        expect(capturedContent).toBe("# Content Bus");
    });

    /**
     * @function should_publish_editor_focus_event_and_support_unsubscribe
     * @description 焦点事件应可被订阅，取消订阅后不再收到后续事件。
     */
    it("should publish editor focus event and support unsubscribe", () => {
        let callCount = 0;
        let lastPath = "";

        const unlisten = subscribeEditorFocusBusEvent((payload) => {
            callCount += 1;
            lastPath = payload.path;
        });

        emitEditorFocusChangedEvent({
            articleId: "file:test-focus",
            path: "notes/focus.md",
            content: "# Focus",
            updatedAt: Date.now(),
        });

        unlisten();

        emitEditorFocusChangedEvent({
            articleId: "file:test-focus",
            path: "notes/focus-ignored.md",
            content: "# Focus Ignored",
            updatedAt: Date.now(),
        });

        expect(callCount).toBe(1);
        expect(lastPath).toBe("notes/focus.md");
    });

    /**
     * @function should_publish_editor_reveal_event_with_target_line
     * @description 发布编辑器定位事件后，订阅者应收到正确的文章、路径和行号。
     */
    it("should publish editor reveal event with target line", () => {
        let capturedArticleId = "";
        let capturedPath = "";
        let capturedLine = 0;
        let capturedScrollAlignment: "center" | undefined;

        const unlisten = subscribeEditorRevealRequestedEvent((payload) => {
            capturedArticleId = payload.articleId;
            capturedPath = payload.path;
            capturedLine = payload.line;
            capturedScrollAlignment = payload.scrollAlignment;
        });

        emitEditorRevealRequestedEvent({
            articleId: "file:notes/guide.md",
            path: "notes/guide.md",
            line: 12,
            scrollAlignment: "center",
        });

        unlisten();

        expect(capturedArticleId).toBe("file:notes/guide.md");
        expect(capturedPath).toBe("notes/guide.md");
        expect(capturedLine).toBe(12);
        expect(capturedScrollAlignment).toBe("center");
    });

    /**
     * @function should_publish_file_tree_rename_request_event_with_target_path
     * @description 发布文件树重命名请求事件后，订阅者应收到目标路径。
     */
    it("should publish file tree rename request event with target path", () => {
        let capturedEventId: string | null = null;
        let capturedPath = "";

        const unlisten = subscribeFileTreeRenameRequestedEvent((payload) => {
            capturedEventId = payload.eventId;
            capturedPath = payload.path;
        });

        emitFileTreeRenameRequestedEvent({
            path: "notes/rename-me.md",
        });

        unlisten();

        expect(capturedEventId).not.toBeNull();
        expect((capturedEventId ?? "").startsWith("frontend-")).toBe(true);
        expect(capturedPath).toBe("notes/rename-me.md");
    });

    /**
     * @function should_publish_custom_activity_removal_request_event_with_target_id
     * @description 发布删除自定义 activity 请求后，订阅者应收到目标配置 ID。
     */
    it("should publish custom activity removal request event with target id", () => {
        let capturedEventId: string | null = null;
        let capturedActivityConfigId = "";

        const unlisten = subscribeCustomActivityRemovalRequestedEvent((payload) => {
            capturedEventId = payload.eventId;
            capturedActivityConfigId = payload.activityConfigId;
        });

        emitCustomActivityRemovalRequestedEvent({
            activityConfigId: "custom-calendar",
        });

        unlisten();

        expect(capturedEventId).not.toBeNull();
        expect((capturedEventId ?? "").startsWith("frontend-")).toBe(true);
        expect(capturedActivityConfigId).toBe("custom-calendar");
    });

    /**
     * @function should_wait_for_async_vault_before_change_listeners
     * @description 仓库切换前事件应等待异步监听方完成清理后再 resolve。
     */
    it("should wait for async vault before-change listeners", async () => {
        const order: string[] = [];
        const unlisten = subscribeVaultBeforeChangeEvent(async (payload) => {
            order.push(`start:${payload.nextVaultPath}`);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            order.push(`end:${payload.nextVaultPath}`);
        });

        const emitPromise = emitVaultBeforeChangeEvent({
            currentVaultPath: "/vault-a",
            nextVaultPath: "/vault-b",
        }).then((payload) => {
            order.push(`resolved:${payload.nextVaultPath}`);
            return payload;
        });

        await emitPromise;
        unlisten();

        expect(order).toEqual([
            "start:/vault-b",
            "end:/vault-b",
            "resolved:/vault-b",
        ]);
    });

    /**
     * @function should_support_unsubscribing_vault_before_change_listeners
     * @description 取消订阅后，仓库切换前监听方不应再收到事件。
     */
    it("should support unsubscribing vault before-change listeners", async () => {
        let callCount = 0;
        const unlisten = subscribeVaultBeforeChangeEvent(() => {
            callCount += 1;
        });

        unlisten();
        await emitVaultBeforeChangeEvent({
            currentVaultPath: "/vault-a",
            nextVaultPath: "/vault-b",
        });

        expect(callCount).toBe(0);
    });
});
