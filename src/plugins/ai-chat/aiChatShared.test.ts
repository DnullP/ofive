/**
 * @module plugins/ai-chat/aiChatShared.test
 * @description AI 聊天共享状态工具单元测试：覆盖设置合并、标题生成、历史归一化与错误格式化。
 * @dependencies
 *   - bun:test
 *   - ./aiChatShared
 */

import { describe, expect, it } from "bun:test";
import type {
    AiChatConversationRecord,
    AiChatHistoryState,
    AiChatHistoryMessage,
    AiChatSettings,
    AiVendorDefinition,
} from "../../api/aiApi";
import {
    buildPersistableHistory,
    deriveConversationTitle,
    ensureHistoryState,
    filterConversations,
    formatAiPanelError,
    mergeSettingsForVendor,
    resolveVendor,
} from "./aiChatShared";

const VENDORS: AiVendorDefinition[] = [
    {
        id: "vendor-a",
        title: "Vendor A",
        description: "Vendor A desc",
        defaultModel: "model-a",
        fields: [
            {
                key: "token",
                label: "Token",
                description: "Access token",
                fieldType: "password",
                required: true,
                placeholder: null,
                defaultValue: null,
            },
            {
                key: "endpoint",
                label: "Endpoint",
                description: "Endpoint",
                fieldType: "text",
                required: false,
                placeholder: null,
                defaultValue: "https://example.test",
            },
        ],
    },
];

function createSettings(): AiChatSettings {
    return {
        vendorId: "vendor-a",
        model: "",
        fieldValues: {
            token: "secret",
        },
    };
}

function createConversation(
    id: string,
    updatedAt: number,
): AiChatConversationRecord {
    return {
        id,
        sessionId: `session-${id}`,
        title: id,
        createdAtUnixMs: updatedAt - 1,
        updatedAtUnixMs: updatedAt,
        messages: [],
    };
}

describe("aiChatShared", () => {
    it("应按 vendor 字段模式合并设置并补默认值", () => {
        const vendor = VENDORS[0]!;
        const merged = mergeSettingsForVendor(createSettings(), vendor);

        expect(merged.model).toBe("model-a");
        expect(merged.fieldValues).toEqual({
            token: "secret",
            endpoint: "https://example.test",
        });
    });

    it("应能按 id 查找 vendor", () => {
        expect(resolveVendor(VENDORS, "vendor-a")?.title).toBe("Vendor A");
        expect(resolveVendor(VENDORS, "missing")).toBeNull();
    });

    it("应根据首条用户消息生成标题并裁剪过长文本", () => {
        const title = deriveConversationTitle([
            {
                id: "1",
                role: "assistant",
                text: "skip",
                createdAtUnixMs: 1,
            },
            {
                id: "2",
                role: "user",
                text: "   This   is    a very long title that should be truncated   ",
                createdAtUnixMs: 2,
            },
        ]);

        expect(title).toBe("This is a very long title...");
    });

    it("应在历史为空时自动补一个会话", () => {
        const next = ensureHistoryState({
            activeConversationId: null,
            conversations: [],
        });

        expect(next.conversations).toHaveLength(1);
        expect(next.activeConversationId).toBe(next.conversations[0]?.id);
    });

    it("应在持久化历史时过滤空消息并重算标题", () => {
        const history: AiChatHistoryState = {
            activeConversationId: "c1",
            conversations: [
                {
                    id: "c1",
                    sessionId: "s1",
                    title: "stale",
                    createdAtUnixMs: 1,
                    updatedAtUnixMs: 2,
                    messages: [
                        {
                            id: "m1",
                            role: "user",
                            text: "Hello note",
                            createdAtUnixMs: 1,
                        },
                        {
                            id: "m2",
                            role: "assistant",
                            text: "   ",
                            createdAtUnixMs: 2,
                        },
                    ],
                },
            ],
        };

        const persistable = buildPersistableHistory(history);

        expect(persistable.conversations[0]?.title).toBe("Hello note");
        expect(persistable.conversations[0]?.messages).toHaveLength(1);
    });

    it("应按摘要与详情拆分错误文本", () => {
        expect(formatAiPanelError("backend failed: timeout")).toEqual({
            summary: "backend failed",
            detail: "timeout",
        });
        expect(formatAiPanelError("single line")).toEqual({
            summary: "single line",
            detail: null,
        });
    });

    it("应在历史修正时按更新时间倒序排列", () => {
        const history = ensureHistoryState({
            activeConversationId: "c1",
            conversations: [
                createConversation("c1", 10),
                createConversation("c2", 20),
            ],
        });

        expect(history.conversations.map((conversation) => conversation.id)).toEqual(["c2", "c1"]);
        expect(history.activeConversationId).toBe("c1");
    });

    it("应按标题和消息内容过滤会话", () => {
        const conversations: AiChatConversationRecord[] = [
            {
                id: "c1",
                sessionId: "s1",
                title: "Project roadmap",
                createdAtUnixMs: 1,
                updatedAtUnixMs: 2,
                messages: [{
                    id: "m1",
                    role: "user",
                    text: "Discuss milestones",
                    createdAtUnixMs: 1,
                } satisfies AiChatHistoryMessage],
            },
            {
                id: "c2",
                sessionId: "s2",
                title: "New conversation",
                createdAtUnixMs: 3,
                updatedAtUnixMs: 4,
                messages: [{
                    id: "m2",
                    role: "user",
                    text: "Look up vendor token settings",
                    createdAtUnixMs: 3,
                } satisfies AiChatHistoryMessage],
            },
        ];

        expect(filterConversations(conversations, "roadmap").map((conversation) => conversation.id)).toEqual(["c1"]);
        expect(filterConversations(conversations, "vendor token").map((conversation) => conversation.id)).toEqual(["c2"]);
        expect(filterConversations(conversations, "").map((conversation) => conversation.id)).toEqual(["c1", "c2"]);
    });
});