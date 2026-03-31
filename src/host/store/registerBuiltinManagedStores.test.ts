/**
 * @module host/store/registerBuiltinManagedStores.test
 * @description 内建 managed store 注册测试：验证 host 基础 store 会被集中注册到 store hub。
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
    __resetBuiltinManagedStoresRegistrationForTests,
    ensureBuiltinManagedStoresRegistered,
} from "./registerBuiltinManagedStores";
import {
    __resetManagedStoreRegistryForTests,
    getManagedStoresSnapshot,
} from "./storeRegistry";

afterEach(() => {
    __resetManagedStoreRegistryForTests();
    __resetBuiltinManagedStoresRegistrationForTests();
});

describe("ensureBuiltinManagedStoresRegistered", () => {
    test("应注册内建 config、vault、theme 与 shortcut managed store", () => {
        ensureBuiltinManagedStoresRegistered();

        const snapshot = getManagedStoresSnapshot();

        expect(snapshot.map((store) => store.id)).toEqual([
            "config",
            "shortcut",
            "theme",
            "vault",
        ]);
        expect(snapshot.find((store) => store.id === "config")?.contributionKinds).toEqual([]);
        expect(snapshot.find((store) => store.id === "vault")?.contributionKinds).toEqual([]);
        expect(snapshot.find((store) => store.id === "theme")?.contributionKinds).toEqual(["settings"]);
        expect(snapshot.find((store) => store.id === "shortcut")?.contributionKinds).toEqual(["settings"]);
        expect(snapshot.every((store) => store.schema.summary.length > 0)).toBe(true);
        expect(snapshot.find((store) => store.id === "theme")?.schema.flow.kind).toBe("value-space");
        expect(snapshot.find((store) => store.id === "config")?.schema.flow.kind).toBe("state-machine");
    });
});