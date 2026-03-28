/**
 * @module host/store/autoSaveService.test
 * @description 自动保存服务单元测试，覆盖防抖调度、flush、手动保存同步、配置变更等场景。
 * @dependencies
 *  - bun:test
 *  - ./autoSaveService
 *
 * @example
 *   bun test src/host/store/autoSaveService.test.ts
 */

import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";

/**
 * 模拟 vaultApi 的 saveVaultMarkdownFile。
 * 由于 autoSaveService 从 ../api/vaultApi 导入 saveVaultMarkdownFile，
 * 这里通过 mock.module 替换模块行为。
 * 注意：mock.module 必须在 import autoSaveService 之前调用，否则真实的
 * vaultApi 会被加载（包含 import.meta.glob 等 Vite-only API）。
 */
let savedCalls: Array<{ path: string; content: string }> = [];

const actualAppEventBus = await import("../events/appEventBus");
const actualConfigStore = await import("./configStore");

mock.module("../../api/vaultApi", () => ({
    saveVaultMarkdownFile: async (path: string, content: string) => {
        savedCalls.push({ path, content });
        return { relativePath: path, created: false };
    },
    isTauriRuntime: () => false,
    searchVaultMarkdown: async () => [],
    isSelfTriggeredVaultFsEvent: () => false,
    readVaultMarkdownFile: async () => ({ content: "# latest" }),
    getCurrentVaultConfig: async () => ({
        feature_settings: {},
    }),
    saveCurrentVaultConfig: async () => ({
        feature_settings: {},
    }),
    isSelfTriggeredVaultConfigEvent: () => false,
}));

/** 内容变化事件监听器引用 */
let contentListener: ((payload: unknown) => void) | null = null;
let contentEventSeq = 1;

mock.module("../events/appEventBus", () => {
    return {
        ...actualAppEventBus,
        subscribeEditorContentBusEvent: (listener: (payload: unknown) => void) => {
            contentListener = listener;
            return () => {
                contentListener = null;
            };
        },
        emitEditorContentChangedEvent: (payload: {
            articleId: string;
            path: string;
            content: string;
            updatedAt: number;
        }) => {
            contentListener?.({
                eventId: `frontend-${contentEventSeq++}`,
                sourceTraceId: null,
                ...payload,
            });
        },
        emitPersistedContentUpdatedEvent: () => { /* noop */ },
    };
});

mock.module("./configStore", () => {
    return {
        ...actualConfigStore,
        subscribeConfigChanges: () => {
            return () => { /* noop */ };
        },
    };
});

/**
 * 测试辅助：触发内容变化事件。
 * @param payload 事件负载。
 */
function triggerContentEvent(payload: unknown): void {
    if (contentListener) {
        contentListener(payload);
    }
}

// 动态导入，确保 mock.module 已生效
const {
    startAutoSaveService,
    stopAutoSaveService,
    flushAutoSave,
    flushAutoSaveByPath,
    markContentAsSaved,
    getAutoSaveServiceState,
} = await import("./autoSaveService");

describe("autoSaveService", () => {
    beforeEach(() => {
        savedCalls = [];
    });

    afterEach(() => {
        stopAutoSaveService();
    });

    /**
     * @description 启动和停止服务应正确切换 running 状态。
     */
    it("should start and stop correctly", () => {
        startAutoSaveService();
        expect(getAutoSaveServiceState().running).toBe(true);

        stopAutoSaveService();
        expect(getAutoSaveServiceState().running).toBe(false);
    });

    /**
     * @description 重复启动不应重复订阅。
     */
    it("should ignore duplicate start", () => {
        startAutoSaveService();
        startAutoSaveService();
        expect(getAutoSaveServiceState().running).toBe(true);
    });

    /**
     * @description markContentAsSaved 应更新 lastSavedPaths。
     */
    it("should track saved content via markContentAsSaved", () => {
        startAutoSaveService();

        markContentAsSaved("notes/test.md", "# Hello");
        const state = getAutoSaveServiceState();
        expect(state.lastSavedPaths).toContain("notes/test.md");
    });

    /**
     * @description 非 Markdown 文件的内容变化事件应被忽略。
     */
    it("should ignore non-markdown file events", () => {
        startAutoSaveService();

        triggerContentEvent({
            eventId: "frontend-1",
            sourceTraceId: null,
            articleId: "file:image.png",
            path: "assets/image.png",
            content: "binary-data",
            updatedAt: Date.now(),
        });

        const state = getAutoSaveServiceState();
        expect(state.pendingPaths).toHaveLength(0);
    });

    /**
     * @description 内容变化事件应创建待保存条目。
     */
    it("should schedule pending save on content change", () => {
        startAutoSaveService();

        triggerContentEvent({
            eventId: "frontend-2",
            sourceTraceId: null,
            articleId: "file:notes/hello.md",
            path: "notes/hello.md",
            content: "# Hello World",
            updatedAt: Date.now(),
        });

        const state = getAutoSaveServiceState();
        expect(state.pendingPaths).toContain("notes/hello.md");
    });

    /**
     * @description flushAutoSave 应立即保存所有待保存条目。
     */
    it("should flush all pending entries", async () => {
        startAutoSaveService();

        triggerContentEvent({
            eventId: "frontend-3",
            sourceTraceId: null,
            articleId: "file:notes/a.md",
            path: "notes/a.md",
            content: "content-a",
            updatedAt: Date.now(),
        });

        triggerContentEvent({
            eventId: "frontend-4",
            sourceTraceId: null,
            articleId: "file:notes/b.md",
            path: "notes/b.md",
            content: "content-b",
            updatedAt: Date.now(),
        });

        await flushAutoSave();

        expect(savedCalls).toHaveLength(2);
        expect(savedCalls.find((c) => c.path === "notes/a.md")?.content).toBe("content-a");
        expect(savedCalls.find((c) => c.path === "notes/b.md")?.content).toBe("content-b");

        const state = getAutoSaveServiceState();
        expect(state.pendingPaths).toHaveLength(0);
    });

    /**
     * @description flushAutoSaveByPath 应只保存指定路径。
     */
    it("should flush only specified path", async () => {
        startAutoSaveService();

        triggerContentEvent({
            eventId: "frontend-5",
            sourceTraceId: null,
            articleId: "file:notes/x.md",
            path: "notes/x.md",
            content: "content-x",
            updatedAt: Date.now(),
        });

        triggerContentEvent({
            eventId: "frontend-6",
            sourceTraceId: null,
            articleId: "file:notes/y.md",
            path: "notes/y.md",
            content: "content-y",
            updatedAt: Date.now(),
        });

        await flushAutoSaveByPath("notes/x.md");

        expect(savedCalls).toHaveLength(1);
        expect(savedCalls[0].path).toBe("notes/x.md");

        const state = getAutoSaveServiceState();
        expect(state.pendingPaths).toContain("notes/y.md");
        expect(state.pendingPaths).not.toContain("notes/x.md");
    });

    /**
     * @description 内容与上次保存一致时不应重复保存。
     */
    it("should skip save when content unchanged from last saved", async () => {
        startAutoSaveService();

        markContentAsSaved("notes/same.md", "same content");

        triggerContentEvent({
            eventId: "frontend-7",
            sourceTraceId: null,
            articleId: "file:notes/same.md",
            path: "notes/same.md",
            content: "same content",
            updatedAt: Date.now(),
        });

        // 由于内容与 lastSaved 一致，不应创建待保存条目
        const state = getAutoSaveServiceState();
        expect(state.pendingPaths).not.toContain("notes/same.md");
    });

    /**
     * @description markContentAsSaved 应清除相同内容的 pending 条目。
     */
    it("should clear pending entry on markContentAsSaved with same content", () => {
        startAutoSaveService();

        triggerContentEvent({
            eventId: "frontend-8",
            sourceTraceId: null,
            articleId: "file:notes/p.md",
            path: "notes/p.md",
            content: "pending content",
            updatedAt: Date.now(),
        });

        expect(getAutoSaveServiceState().pendingPaths).toContain("notes/p.md");

        markContentAsSaved("notes/p.md", "pending content");

        expect(getAutoSaveServiceState().pendingPaths).not.toContain("notes/p.md");
    });
});
