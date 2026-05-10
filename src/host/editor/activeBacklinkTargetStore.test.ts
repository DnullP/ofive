/**
 * @module host/editor/activeBacklinkTargetStore.test
 * @description activeBacklinkTargetStore 回归测试，覆盖 Markdown 与项目源码反链目标切换。
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    clearActiveBacklinkTarget,
    clearProjectSourceBacklinkTarget,
    getActiveBacklinkTargetSnapshot,
    reportMarkdownBacklinkTarget,
    reportProjectSourceBacklinkTarget,
} from "./activeBacklinkTargetStore";

describe("activeBacklinkTargetStore", () => {
    afterEach(() => {
        clearActiveBacklinkTarget();
    });

    it("should report markdown backlink target", () => {
        reportMarkdownBacklinkTarget({
            articleId: "file:notes/topic.md",
            path: "notes/topic.md",
        });

        const snapshot = getActiveBacklinkTargetSnapshot();
        expect(snapshot).toMatchObject({
            kind: "markdown",
            articleId: "file:notes/topic.md",
            path: "notes/topic.md",
            title: "topic.md",
        });
    });

    it("should switch to project source backlink target", () => {
        reportProjectSourceBacklinkTarget({
            tabId: "project-reader:mock:src%2Fmain.ts",
            projectId: "mock-project",
            projectName: "mock-ofive",
            rootPath: "/mock/ofive",
            relativePath: "src/main.ts",
        });

        const snapshot = getActiveBacklinkTargetSnapshot();
        expect(snapshot).toMatchObject({
            kind: "project-source",
            tabId: "project-reader:mock:src%2Fmain.ts",
            projectId: "mock-project",
            projectName: "mock-ofive",
            relativePath: "src/main.ts",
            title: "mock-ofive / src/main.ts",
        });
    });

    it("should only clear matching project source target", () => {
        reportProjectSourceBacklinkTarget({
            tabId: "project-reader:mock:src%2Fmain.ts",
            projectId: "mock-project",
            projectName: "mock-ofive",
            rootPath: "/mock/ofive",
            relativePath: "src/main.ts",
        });

        clearProjectSourceBacklinkTarget("other-tab");
        expect(getActiveBacklinkTargetSnapshot()).not.toBeNull();

        clearProjectSourceBacklinkTarget("project-reader:mock:src%2Fmain.ts");
        expect(getActiveBacklinkTargetSnapshot()).toBeNull();
    });
});
