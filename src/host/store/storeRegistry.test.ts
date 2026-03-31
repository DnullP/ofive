/**
 * @module host/store/storeRegistry.test
 * @description store registry 单元测试：验证 host/plugin store 注册，以及按 contribution 类型激活的治理行为。
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
    __resetManagedStoreRegistryForTests,
    enableManagedStoreContributions,
    getManagedStoresSnapshot,
    registerManagedStore,
    registerPluginOwnedStore,
} from "./storeRegistry";

const valueSpaceSchema = {
    summary: "Test value-space schema.",
    state: {
        fields: [{
            name: "themeMode",
            description: "Current theme mode.",
            valueType: "union" as const,
            initialValue: "dark",
            allowedValues: ["dark", "light"],
        }],
        invariants: ["themeMode is always supported"],
        actions: [{
            id: "update-theme-mode",
            description: "Update theme mode.",
            updates: ["themeMode"],
            sideEffects: ["notify subscribers"],
        }],
    },
    flow: {
        kind: "value-space" as const,
        description: "Single-field value space.",
        stateSpace: ["themeMode in {dark, light}"],
        updateTriggers: ["user action"],
        failureModes: ["invalid values are rejected"],
    },
};

const stateMachineSchema = {
    summary: "Test state-machine schema.",
    state: {
        fields: [
            {
                name: "vendorId",
                description: "Current vendor id.",
                valueType: "string" as const,
                initialValue: "openai",
            },
            {
                name: "isLoading",
                description: "Loading state.",
                valueType: "boolean" as const,
                initialValue: "false",
                allowedValues: ["true", "false"],
            },
        ],
        invariants: ["vendorId is stable after request success"],
        actions: [{
            id: "load-vendor",
            description: "Load vendor config.",
            updates: ["vendorId", "isLoading"],
            sideEffects: ["invoke backend API"],
        }],
    },
    flow: {
        kind: "state-machine" as const,
        description: "Async load flow.",
        initialState: "idle",
        states: [
            { id: "idle", description: "Not started." },
            { id: "loading", description: "Loading." },
            { id: "ready", description: "Loaded." },
        ],
        transitions: [
            {
                event: "load-request",
                from: ["idle", "ready"],
                to: "loading",
                description: "Start load.",
                sideEffects: ["invoke backend API"],
            },
            {
                event: "load-success",
                from: ["loading"],
                to: "ready",
                description: "Finish load.",
            },
        ],
        failureModes: ["request failure leaves store out of ready state"],
    },
};

afterEach(() => {
    __resetManagedStoreRegistryForTests();
});

describe("storeRegistry", () => {
    test("应记录 host 与 plugin store 的所有权和 contribution 元数据", () => {
        registerManagedStore({
            id: "theme",
            title: "Theme Store",
            ownerType: "host",
            scope: "frontend-local",
            schema: valueSpaceSchema,
            getSnapshot: () => ({ themeMode: "dark" }),
            subscribe: () => () => {
                /* noop */
            },
            contributions: [{ kind: "settings", activate: () => undefined }],
        });

        registerManagedStore({
            id: "ai-chat",
            title: "AI Chat Store",
            ownerType: "plugin",
            ownerId: "ai-chat",
            scope: "plugin-private",
            schema: stateMachineSchema,
            getSnapshot: () => ({ vendorId: "openai" }),
            subscribe: () => () => {
                /* noop */
            },
        });

        const snapshot = getManagedStoresSnapshot();

        expect(snapshot.map((item) => item.id)).toEqual(["ai-chat", "theme"]);
        expect(snapshot[0]).toMatchObject({
            ownerType: "plugin",
            ownerId: "ai-chat",
            contributionKinds: [],
            schema: stateMachineSchema,
        });
        expect(snapshot[1]).toMatchObject({
            ownerType: "host",
            contributionKinds: ["settings"],
            schema: valueSpaceSchema,
        });
    });

    test("启用 contribution 后应激活当前与后续注册 store 的对应贡献", () => {
        let activateCount = 0;
        let disposeCount = 0;

        registerManagedStore({
            id: "theme",
            title: "Theme Store",
            ownerType: "host",
            scope: "frontend-local",
            schema: valueSpaceSchema,
            getSnapshot: () => ({ themeMode: "dark" }),
            subscribe: () => () => {
                /* noop */
            },
            contributions: [{
                kind: "settings",
                activate: () => {
                    activateCount += 1;
                    return () => {
                        disposeCount += 1;
                    };
                },
            }],
        });

        expect(activateCount).toBe(0);

        enableManagedStoreContributions("settings");

        expect(activateCount).toBe(1);

        const unregisterPluginStore = registerManagedStore({
            id: "ai-chat",
            title: "AI Chat Store",
            ownerType: "plugin",
            ownerId: "ai-chat",
            scope: "plugin-private",
            schema: stateMachineSchema,
            getSnapshot: () => ({ vendorId: "openai" }),
            subscribe: () => () => {
                /* noop */
            },
            contributions: [{
                kind: "settings",
                activate: () => {
                    activateCount += 1;
                    return () => {
                        disposeCount += 1;
                    };
                },
            }],
        });

        expect(activateCount).toBe(2);

        unregisterPluginStore();

        expect(disposeCount).toBe(1);
    });

    test("插件 helper 应自动补全 plugin owner 元数据与前缀化 store id", () => {
        registerPluginOwnedStore("knowledge-graph", {
            storeId: "settings",
            title: "Graph Settings Store",
            scope: "plugin-private",
            schema: valueSpaceSchema,
            getSnapshot: () => ({ scale: 1 }),
            subscribe: () => () => {
                /* noop */
            },
        });

        expect(getManagedStoresSnapshot()).toEqual([
            expect.objectContaining({
                id: "knowledge-graph:settings",
                ownerType: "plugin",
                ownerId: "knowledge-graph",
                schema: valueSpaceSchema,
            }),
        ]);
    });

    test("缺失 schema 时应拒绝注册", () => {
        expect(() => registerManagedStore({
            id: "broken",
            title: "Broken Store",
            ownerType: "host",
            scope: "frontend-local",
            getSnapshot: () => ({}),
            subscribe: () => () => {
                /* noop */
            },
        } as never)).toThrow("schema.summary");
    });
});