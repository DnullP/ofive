/**
 * @module plugins/ai-chat/aiChatConfirmationPreview.test
 * @description AI 工具确认预览单元测试。
 */

import { describe, expect, it } from "bun:test";
import { buildConfirmationPreview } from "./aiChatConfirmationPreview";
import type { PendingToolConfirmation } from "./aiChatStreamState";

function createConfirmation(overrides: Partial<PendingToolConfirmation> = {}): PendingToolConfirmation {
    return {
        confirmationId: "confirm-1",
        sessionId: "session-1",
        assistantMessageId: "assistant-1",
        conversationId: "conversation-1",
        hint: "Patch will modify the note.",
        toolName: "vault_apply_markdown_patch",
        toolArgsJson: JSON.stringify({
            relativePath: "notes/guide.md",
            unifiedDiff: [
                "--- a/notes/guide.md",
                "+++ b/notes/guide.md",
                "@@ -3,3 +3,3 @@",
                " alpha",
                "-beta",
                "+beta patched",
                " gamma",
            ].join("\n"),
        }, null, 2),
        isSubmitting: false,
        ...overrides,
    };
}

describe("aiChatConfirmationPreview", () => {
    it("应将 markdown patch 确认参数渲染为 diff 预览", () => {
        const preview = buildConfirmationPreview(createConfirmation());

        expect(preview?.kind).toBe("markdown-patch");
        expect(preview && preview.kind === "markdown-patch" ? preview.relativePath : "").toBe("notes/guide.md");
        expect(preview && preview.kind === "markdown-patch" ? preview.hunkCount : 0).toBe(1);
        expect(preview && preview.kind === "markdown-patch" ? preview.diffText : "").toContain("--- a/notes/guide.md");
        expect(preview && preview.kind === "markdown-patch" ? preview.diffText : "").toContain("-beta");
        expect(preview && preview.kind === "markdown-patch" ? preview.diffText : "").toContain("+beta patched");
    });

    it("应在非 patch 工具时回退为原始参数预览", () => {
        const preview = buildConfirmationPreview(createConfirmation({
            toolName: "vault_create_markdown_file",
            toolArgsJson: '{"relativePath":"notes/new.md"}',
        }));

        expect(preview).toEqual({
            kind: "generic",
            rawArgsJson: '{"relativePath":"notes/new.md"}',
        });
    });

    it("应在参数不是合法 JSON 时回退为原始参数预览", () => {
        const preview = buildConfirmationPreview(createConfirmation({
            toolArgsJson: "not-json",
        }));

        expect(preview).toEqual({
            kind: "generic",
            rawArgsJson: "not-json",
        });
    });
});