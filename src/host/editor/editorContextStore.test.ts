/**
 * @module host/editor/editorContextStore.test
 * @description editorContextStore 回归测试，覆盖“focus-only 事件不应清空内容”的边界。
 * @dependencies
 *  - bun:test
 *  - ./editorContextStore
 *
 * @example
 *   bun test src/host/editor/editorContextStore.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    getArticleSnapshotById,
    getFocusedArticleSnapshot,
    hasArticleSnapshotByPath,
    reportArticleContent,
    reportArticleContentByPath,
    reportArticleFocus,
    resetEditorContext,
} from "./editorContextStore";

describe("editorContextStore content snapshot boundary", () => {
    /**
     * @function should_keep_focus_only_article_untrusted_until_content_arrives
     * @description 首次仅上报 focus（无 content）时，不应标记为可靠内容快照。
     */
    it("should keep focus-only article untrusted until content arrives", () => {
        resetEditorContext();

        const articleId = "test-focus-only-untrusted";
        const path = "notes/focus-only.md";

        reportArticleFocus({
            articleId,
            path,
        });

        const snapshot = getArticleSnapshotById(articleId);
        expect(snapshot).not.toBeNull();
        expect(snapshot?.content).toBe("");
        expect(snapshot?.hasContentSnapshot).toBe(false);
    });

    /**
     * @function should_preserve_existing_content_on_followup_focus_without_content
     * @description 已有内容快照时，后续无 content 的 focus 不应覆盖内容。
     */
    it("should preserve existing content on follow-up focus without content", () => {
        resetEditorContext();

        const articleId = "test-preserve-content-after-focus";
        const path = "notes/preserve.md";
        const content = "# keep me\n\ncontent should stay";

        reportArticleContent({
            articleId,
            path,
            content,
        });

        reportArticleFocus({
            articleId,
            path,
        });

        const snapshot = getArticleSnapshotById(articleId);
        expect(snapshot).not.toBeNull();
        expect(snapshot?.content).toBe(content);
        expect(snapshot?.hasContentSnapshot).toBe(true);
    });

    /**
     * @function should_mark_focus_with_content_as_authoritative
     * @description focus 事件携带 content 时，应直接成为可靠快照。
     */
    it("should mark focus with content as authoritative", () => {
        resetEditorContext();

        const articleId = "test-focus-with-content";
        const path = "notes/focus-with-content.md";
        const content = "# title\n\nfrom focus payload";

        reportArticleFocus({
            articleId,
            path,
            content,
        });

        const snapshot = getArticleSnapshotById(articleId);
        expect(snapshot).not.toBeNull();
        expect(snapshot?.content).toBe(content);
        expect(snapshot?.hasContentSnapshot).toBe(true);
    });

    /**
     * @function should_sync_all_articles_by_path_with_authoritative_snapshot
     * @description 按路径批量回写后，命中文章应全部具备可靠快照。
     */
    it("should sync all articles by path with authoritative snapshot", () => {
        resetEditorContext();

        const path = "notes/shared-path.md";
        const content = "# shared\n\nupdated by path";

        reportArticleFocus({
            articleId: "test-shared-1",
            path,
        });
        reportArticleFocus({
            articleId: "test-shared-2",
            path,
        });

        reportArticleContentByPath(path, content);

        expect(hasArticleSnapshotByPath(path)).toBe(true);
        expect(hasArticleSnapshotByPath("notes/missing.md")).toBe(false);

        const snapshot1 = getArticleSnapshotById("test-shared-1");
        const snapshot2 = getArticleSnapshotById("test-shared-2");
        expect(snapshot1?.content).toBe(content);
        expect(snapshot2?.content).toBe(content);
        expect(snapshot1?.hasContentSnapshot).toBe(true);
        expect(snapshot2?.hasContentSnapshot).toBe(true);
    });

    /**
     * @function should_reset_all_cached_articles_after_vault_change
     * @description 仓库切换触发 reset 后，应清空焦点文章和缓存快照。
     */
    it("should reset all cached articles after vault change", () => {
        resetEditorContext();

        reportArticleFocus({
            articleId: "test-reset",
            path: "notes/reset.md",
            content: "# reset",
        });

        resetEditorContext();

        expect(getFocusedArticleSnapshot()).toBeNull();
        expect(getArticleSnapshotById("test-reset")).toBeNull();
    });
});
