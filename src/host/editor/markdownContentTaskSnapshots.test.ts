/**
 * @module host/editor/markdownContentTaskSnapshots.test
 * @description canonical Markdown 内容派生任务快照测试。
 * @dependencies
 *  - bun:test
 *  - ./editorContextStore
 *  - ./markdownContentTaskSnapshots
 */

import { describe, expect, it } from "bun:test";
import { reportArticleContent, reportArticleContentByPath, resetEditorContext } from "./editorContextStore";
import { overlayMarkdownContentTaskSnapshots } from "./markdownContentTaskSnapshots";

describe("overlayMarkdownContentTaskSnapshots", () => {
    it("should replace persisted tasks for paths that have canonical editor content", () => {
        resetEditorContext();

        reportArticleContent({
            articleId: "file:notes/tasks.md#view-2",
            path: "notes/tasks.md",
            content: [
                "# Tasks",
                "- [ ] Fresh task start:2026-03-24 09:00 !high",
                "```md",
                "- [ ] Hidden task !low",
                "```",
            ].join("\n"),
        });

        const tasks = overlayMarkdownContentTaskSnapshots([
            {
                relativePath: "notes/tasks.md",
                title: "tasks",
                line: 2,
                rawLine: "- [ ] Stale task !low",
                checked: false,
                content: "Stale task",
                priority: "low",
            },
            {
                relativePath: "notes/other.md",
                title: "other",
                line: 1,
                rawLine: "- [ ] Other task !medium",
                checked: false,
                content: "Other task",
                priority: "medium",
            },
        ]);

        expect(tasks.map((task) => `${task.relativePath}:${task.content}:${task.priority ?? ""}`)).toEqual([
            "notes/other.md:Other task:medium",
            "notes/tasks.md:Fresh task:high",
        ]);
    });

    it("should include path-only canonical content snapshots", () => {
        resetEditorContext();

        reportArticleContentByPath("notes/path-only.md", "- [x] Done from service !low");

        expect(overlayMarkdownContentTaskSnapshots([])).toEqual([{
            relativePath: "notes/path-only.md",
            title: "path-only",
            line: 1,
            rawLine: "- [x] Done from service !low",
            checked: true,
            content: "Done from service",
            priority: "low",
        }]);
    });
});
