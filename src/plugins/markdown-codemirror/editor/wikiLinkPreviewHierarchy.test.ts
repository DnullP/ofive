/**
 * @module plugins/markdown-codemirror/editor/wikiLinkPreviewHierarchy.test
 * @description WikiLink 预览层级注册表测试：验证父子 preview 的注册、注销与监听行为。
 * @dependencies
 *  - bun:test
 *  - ./wikiLinkPreviewHierarchy
 */

import { describe, expect, it } from "bun:test";

import {
    createWikiLinkPreviewId,
    hasWikiLinkPreviewDescendant,
    registerWikiLinkPreview,
    subscribeWikiLinkPreviewHierarchy,
    unregisterWikiLinkPreview,
} from "./wikiLinkPreviewHierarchy";

describe("wikiLinkPreviewHierarchy", () => {
    it("tracks parent child preview relationships", () => {
        const parentId = createWikiLinkPreviewId();
        const childId = createWikiLinkPreviewId();

        registerWikiLinkPreview(parentId, null);
        registerWikiLinkPreview(childId, parentId);

        expect(hasWikiLinkPreviewDescendant(parentId)).toBe(true);

        unregisterWikiLinkPreview(childId);
        unregisterWikiLinkPreview(parentId);

        expect(hasWikiLinkPreviewDescendant(parentId)).toBe(false);
    });

    it("notifies subscribers when hierarchy changes", async () => {
        const parentId = createWikiLinkPreviewId();
        const events: string[] = [];
        const dispose = subscribeWikiLinkPreviewHierarchy(() => {
            events.push("changed");
        });

        registerWikiLinkPreview(parentId, null);
        await Promise.resolve();
        unregisterWikiLinkPreview(parentId);
        await Promise.resolve();
        dispose();

        expect(events.length).toBe(2);
    });

    it("coalesces child replacement notifications within the same turn", async () => {
        const parentId = createWikiLinkPreviewId();
        const childId = createWikiLinkPreviewId();
        const replacementChildId = createWikiLinkPreviewId();
        const descendantStates: boolean[] = [];
        const dispose = subscribeWikiLinkPreviewHierarchy(() => {
            descendantStates.push(hasWikiLinkPreviewDescendant(parentId));
        });

        registerWikiLinkPreview(parentId, null);
        registerWikiLinkPreview(childId, parentId);
        await Promise.resolve();

        unregisterWikiLinkPreview(childId);
        registerWikiLinkPreview(replacementChildId, parentId);
        await Promise.resolve();

        unregisterWikiLinkPreview(replacementChildId);
        unregisterWikiLinkPreview(parentId);
        await Promise.resolve();
        dispose();

        expect(descendantStates).toEqual([true, true, false]);
    });
});