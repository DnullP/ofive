/**
 * @module events/appEventBus.test
 * @description 应用事件总线回归测试，覆盖前端编辑事件发布与订阅语义。
 * @dependencies
 *  - bun:test
 *  - ./appEventBus
 *
 * @example
 *   bun test src/events/appEventBus.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    emitEditorContentChangedEvent,
    emitEditorFocusChangedEvent,
    subscribeEditorContentBusEvent,
    subscribeEditorFocusBusEvent,
} from "./appEventBus";

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
});
