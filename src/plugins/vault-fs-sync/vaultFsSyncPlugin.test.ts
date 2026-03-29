/**
 * @module plugins/vault-fs-sync/vaultFsSyncPlugin.test
 * @description Vault fs 同步插件单元测试：覆盖自触发过滤、持久态事件转发与聚焦文章同步。
 * @dependencies
 *   - bun:test
 *   - ../../api/vaultApi
 *   - ./vaultFsSyncPlugin
 *
 * @example
 *   bun test src/plugins/vault-fs-sync/vaultFsSyncPlugin.test.ts
 */

import { describe, expect, it, mock } from "bun:test";
import type { VaultFsEventPayload } from "../../api/vaultApi";

mock.module("../../api/vaultApi", () => ({
    isSelfTriggeredVaultFsEvent: () => false,
    readVaultMarkdownFile: async () => ({ content: "# latest" }),
    searchVaultMarkdown: async () => [],
    suggestWikiLinkTargets: async () => [],
    resolveWikiLinkTarget: async () => null,
    saveVaultMarkdownFile: async () => ({ relativePath: "notes/demo.md", created: false }),
    isTauriRuntime: () => false,
    getCurrentVaultConfig: async () => ({
        feature_settings: {},
    }),
    saveCurrentVaultConfig: async () => ({
        feature_settings: {},
    }),
    isSelfTriggeredVaultConfigEvent: () => false,
}));

mock.module("../../host/events/appEventBus", () => ({
    emitPersistedContentUpdatedEvent: () => undefined,
    subscribeVaultFsBusEvent: () => {
        return () => {
            /* noop */
        };
    },
}));

mock.module("../../host/store/editorContextStore", () => ({
    getFocusedArticleSnapshot: () => null,
    reportArticleContentByPath: () => undefined,
}));

const {
    activateVaultFsSyncPluginRuntime,
} = await import("./vaultFsSyncPlugin");

type VaultFsSyncPluginDependencies = import("./vaultFsSyncPlugin").VaultFsSyncPluginDependencies;

/**
 * @function createPayload
 * @description 创建 Vault fs 事件测试负载。
 * @param overrides 需要覆盖的字段。
 * @returns 完整事件负载。
 */
function createPayload(
    overrides: Partial<VaultFsEventPayload> = {},
): VaultFsEventPayload {
    return {
        eventId: "evt-1",
        sourceTraceId: null,
        eventType: "modified",
        relativePath: "notes/demo.md",
        oldRelativePath: null,
        ...overrides,
    };
}

/**
 * @function createDependencies
 * @description 构造可手动派发 fs 事件的测试依赖。
 * @param overrides 依赖覆盖项。
 * @returns 测试依赖与事件派发器。
 */
function createDependencies(
    overrides: Partial<VaultFsSyncPluginDependencies> = {},
): {
    dependencies: VaultFsSyncPluginDependencies;
    emitFsEvent: (payload: VaultFsEventPayload) => Promise<void>;
} {
    let listener: ((payload: VaultFsEventPayload) => void) | null = null;
    const readVaultMarkdownFile = mock(async () => ({ content: "# latest" }));
    const emitPersistedContentUpdatedEvent = mock(() => undefined);
    const reportArticleContentByPath = mock(() => undefined);

    const dependencies: VaultFsSyncPluginDependencies = {
        isSelfTriggeredVaultFsEvent: () => false,
        readVaultMarkdownFile,
        subscribeVaultFsBusEvent: (nextListener) => {
            listener = nextListener;
            return () => {
                listener = null;
            };
        },
        emitPersistedContentUpdatedEvent,
        getFocusedArticleSnapshot: () => ({ path: "notes/demo.md" }),
        reportArticleContentByPath,
        ...overrides,
    };

    return {
        dependencies,
        emitFsEvent: async (payload) => {
            listener?.(payload);
            await Promise.resolve();
            await Promise.resolve();
        },
    };
}

describe("vaultFsSyncPlugin", () => {
    it("应忽略自触发 fs 事件", async () => {
        const { dependencies, emitFsEvent } = createDependencies({
            isSelfTriggeredVaultFsEvent: () => true,
        });

        const dispose = activateVaultFsSyncPluginRuntime(dependencies);
        await emitFsEvent(createPayload());

        expect(dependencies.emitPersistedContentUpdatedEvent).not.toHaveBeenCalled();
        expect(dependencies.readVaultMarkdownFile).not.toHaveBeenCalled();
        dispose();
    });

    it("应将外部 modified 事件转发为持久态内容更新事件", async () => {
        const { dependencies, emitFsEvent } = createDependencies();

        const dispose = activateVaultFsSyncPluginRuntime(dependencies);
        await emitFsEvent(createPayload({ relativePath: "notes/other.md" }));

        expect(dependencies.emitPersistedContentUpdatedEvent).toHaveBeenCalledWith({
            relativePath: "notes/other.md",
            source: "external",
        });
        dispose();
    });

    it("应在聚焦 Markdown 被外部修改时刷新编辑器内容", async () => {
        const { dependencies, emitFsEvent } = createDependencies();

        const dispose = activateVaultFsSyncPluginRuntime(dependencies);
        await emitFsEvent(createPayload({ eventType: "moved" }));

        expect(dependencies.readVaultMarkdownFile).toHaveBeenCalledWith("notes/demo.md");
        expect(dependencies.reportArticleContentByPath).toHaveBeenCalledWith(
            "notes/demo.md",
            "# latest",
        );
        dispose();
    });
});