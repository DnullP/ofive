/**
 * @module plugins/search/searchPlugin.test
 * @description 搜索插件单元测试：覆盖初始注册、配置切换与重复启用去重。
 * @dependencies
 *   - bun:test
 *   - ../../api/vaultApi
 *   - ./searchPlugin
 *   - ../host/registry/activityRegistry
 *   - ../host/registry/panelRegistry
 *
 * @example
 *   bun test src/plugins/search/searchPlugin.test.ts
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import { createMockVaultApi } from "../../test-support/mockVaultApi";
import {
    getActivitiesSnapshot,
    registerActivity,
    unregisterActivity,
} from "../../host/registry/activityRegistry";
import {
    getPanelsSnapshot,
    registerPanel,
    unregisterPanel,
} from "../../host/registry/panelRegistry";

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
    activateSearchPluginRuntime,
    buildSearchHighlightSegments,
} = await import("./searchPlugin");

type SearchPluginConfigState = import("./searchPlugin").SearchPluginConfigState;

/**
 * @function createState
 * @description 生成搜索插件测试所需的最小配置状态。
 * @param searchEnabled 是否启用搜索。
 * @returns 最小配置状态对象。
 */
function createState(searchEnabled: boolean): SearchPluginConfigState {
    return {
        featureSettings: {
            searchEnabled,
        },
    };
}

/**
 * @function createDependencies
 * @description 创建带可控配置流的搜索插件测试依赖。
 * @param initialEnabled 初始搜索开关状态。
 * @returns 依赖对象与状态派发器。
 */
function createDependencies(initialEnabled: boolean): {
    dependencies: Parameters<typeof activateSearchPluginRuntime>[0];
    emitConfig: (searchEnabled: boolean) => void;
} {
    let state = createState(initialEnabled);
    const listeners = new Set<(nextState: SearchPluginConfigState) => void>();

    return {
        dependencies: {
            getConfigSnapshot: () => state,
            subscribeConfigChanges: (listener) => {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
            registerActivity,
            unregisterActivity,
            registerPanel,
            unregisterPanel,
        },
        emitConfig: (searchEnabled) => {
            state = createState(searchEnabled);
            listeners.forEach((listener) => listener(state));
        },
    };
}

describe("searchPlugin", () => {
    afterEach(() => {
        unregisterPanel("search");
        unregisterActivity("search");
    });

    it("应在初始启用时注册搜索 activity 与 panel，并在 dispose 时清理", () => {
        const { dependencies } = createDependencies(true);

        const dispose = activateSearchPluginRuntime(dependencies);

        expect(getActivitiesSnapshot().filter((item) => item.id === "search")).toHaveLength(1);
        expect(getPanelsSnapshot().filter((item) => item.id === "search")).toHaveLength(1);

        dispose();

        expect(getActivitiesSnapshot().filter((item) => item.id === "search")).toHaveLength(0);
        expect(getPanelsSnapshot().filter((item) => item.id === "search")).toHaveLength(0);
    });

    it("应在配置切换时同步搜索 surface 的可见性", () => {
        const { dependencies, emitConfig } = createDependencies(false);

        const dispose = activateSearchPluginRuntime(dependencies);

        expect(getActivitiesSnapshot().filter((item) => item.id === "search")).toHaveLength(0);
        expect(getPanelsSnapshot().filter((item) => item.id === "search")).toHaveLength(0);

        emitConfig(true);
        expect(getActivitiesSnapshot().filter((item) => item.id === "search")).toHaveLength(1);
        expect(getPanelsSnapshot().filter((item) => item.id === "search")).toHaveLength(1);

        emitConfig(false);
        expect(getActivitiesSnapshot().filter((item) => item.id === "search")).toHaveLength(0);
        expect(getPanelsSnapshot().filter((item) => item.id === "search")).toHaveLength(0);

        dispose();
    });

    it("重复收到启用配置时不应重复注册搜索 surface", () => {
        const { dependencies, emitConfig } = createDependencies(true);

        const dispose = activateSearchPluginRuntime(dependencies);

        emitConfig(true);
        emitConfig(true);

        expect(getActivitiesSnapshot().filter((item) => item.id === "search")).toHaveLength(1);
        expect(getPanelsSnapshot().filter((item) => item.id === "search")).toHaveLength(1);

        dispose();
    });

    it("应按 query 与 tag 拆分高亮片段，且忽略大小写", () => {
        const segments = buildSearchHighlightSegments(
            "Topic roadmap #Project",
            ["topic", "project"],
        );

        expect(segments).toEqual([
            { text: "Topic", matched: true },
            { text: " roadmap #", matched: false },
            { text: "Project", matched: true },
        ]);
    });
});
