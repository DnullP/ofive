/**
 * @module plugins/outline/outlineManagedStoreRegistration.test
 * @description Outline managed store registration tests.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    __resetManagedStoreRegistryForTests,
    getManagedStoresSnapshot,
} from "../../host/store/storeRegistry";
import { registerOutlineManagedStore } from "./outlineManagedStoreRegistration";

afterEach(() => {
    __resetManagedStoreRegistryForTests();
});

describe("outline managed store registration", () => {
    it("registers the outline store as a plugin-owned derived state owner", () => {
        const unregister = registerOutlineManagedStore();

        expect(getManagedStoresSnapshot()).toEqual([
            expect.objectContaining({
                id: "outline:outline",
                ownerType: "plugin",
                ownerId: "outline",
                tags: ["outline", "editor", "derived-content"],
            }),
        ]);
        expect(getManagedStoresSnapshot()[0].schema.state.invariants).toContain(
            "headings are derived from canonical frontend Markdown content whenever that snapshot exists",
        );

        unregister();
        expect(getManagedStoresSnapshot()).toEqual([]);
    });
});
