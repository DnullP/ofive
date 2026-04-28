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
    buildAiChatRuntimeContextSnapshot,
    buildPersistableHistory,
    deriveConversationTitle,
    ensureHistoryState,
    filterConversations,
    formatAiChatDuration,
    formatAiPanelError,
    mergeSettingsForVendor,
    resolveVendor,
    serializeAiChatRuntimeContextSnapshot,
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
    {
        id: "vendor-b",
        title: "Vendor B",
        description: "Vendor B desc",
        defaultModel: "model-b",
        fields: [
            {
                key: "endpoint",
                label: "Endpoint",
                description: "Endpoint",
                fieldType: "text",
                required: false,
                placeholder: null,
                defaultValue: "https://vendor-b.test",
            },
            {
                key: "apiKey",
                label: "API Key",
                description: "API Key",
                fieldType: "password",
                required: true,
                placeholder: null,
                defaultValue: null,
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

    it("应在切换 vendor 时回退到新 vendor 的默认模型和默认字段值", () => {
        const vendor = VENDORS[1]!;
        const merged = mergeSettingsForVendor({
            vendorId: "vendor-a",
            model: "model-a-custom",
            fieldValues: {
                token: "secret",
                endpoint: "",
            },
        }, vendor);

        expect(merged.model).toBe("model-b");
        expect(merged.fieldValues).toEqual({
            endpoint: "https://vendor-b.test",
            apiKey: "",
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

    it("应在持久化历史时保留被用户中断的消息标记", () => {
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
                            role: "assistant",
                            text: "Partial reply",
                            createdAtUnixMs: 1,
                            interruptedByUser: true,
                        },
                    ],
                },
            ],
        };

        const persistable = buildPersistableHistory(history);

        expect(persistable.conversations[0]?.messages[0]?.interruptedByUser).toBe(true);
    });

    it("应在持久化历史时为旧会话回填协议消息块", () => {
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
                            text: "Explain the code path",
                            createdAtUnixMs: 1,
                        },
                        {
                            id: "m2",
                            role: "assistant",
                            text: "",
                            reasoningText: "Inspect runtime state before answering",
                            createdAtUnixMs: 2,
                        },
                    ],
                },
            ],
        };

        const persistable = buildPersistableHistory(history);
        const firstConversation = persistable.conversations[0]!;

        expect(firstConversation.protocolMessages).toHaveLength(2);
        expect(firstConversation.protocolMessages?.[0]?.contentBlocks).toEqual([
            {
                kind: "text",
                text: "Explain the code path",
            },
        ]);
        expect(firstConversation.protocolMessages?.[1]?.contentBlocks).toEqual([
            {
                kind: "thinking",
                text: "Inspect runtime state before answering",
            },
        ]);
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

    it("应构建 AI 请求运行上下文快照", () => {
        const snapshot = buildAiChatRuntimeContextSnapshot({
            vaultPath: "/vault",
            activeFile: {
                articleId: "file:notes/a.md",
                path: "notes\\a.md",
                title: "a.md",
                kind: "markdown",
            },
            openTabs: [
                {
                    id: "file:notes/a.md",
                    path: "notes/a.md",
                    title: "a.md",
                    component: "markdown.codemirror",
                    active: true,
                },
                {
                    id: "graph",
                    path: null,
                    title: "Graph",
                    component: "knowledge-graph",
                    active: false,
                },
            ],
            files: [
                { path: "notes/a.md", isDir: false },
                { path: "notes", isDir: true },
                { path: "canvas/board.canvas", isDir: false },
            ],
            settings: {
                vendorId: "anthropic",
                model: "claude-sonnet",
                fieldValues: {},
            },
        });

        expect(snapshot.schemaVersion).toBe("ofive.ai.runtime-context.v1");
        expect(snapshot.activeFile?.path).toBe("notes/a.md");
        expect(snapshot.openTabs.map((tab) => tab.id)).toEqual(["file:notes/a.md", "graph"]);
        expect(snapshot.fileTree).toEqual({
            totalEntries: 3,
            fileCount: 2,
            directoryCount: 1,
            samplePaths: ["canvas/board.canvas", "notes/a.md"],
        });
        expect(JSON.parse(serializeAiChatRuntimeContextSnapshot(snapshot)).ai.model).toBe("claude-sonnet");
    });

    it("应格式化 AI 生成耗时", () => {
        expect(formatAiChatDuration(null)).toBeNull();
        expect(formatAiChatDuration(321)).toBe("321ms");
        expect(formatAiChatDuration(1250)).toBe("1.3s");
        expect(formatAiChatDuration(12_100)).toBe("12s");
        expect(formatAiChatDuration(65_000)).toBe("1m 05s");
    });
});
