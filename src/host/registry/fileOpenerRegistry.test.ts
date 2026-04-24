/**
 * @module registry/fileOpenerRegistry.test
 * @description 文件 opener 注册中心单元测试：覆盖注册、注销、优先级解析与显式偏好选择。
 * @dependencies
 *   - bun:test
 *   - ./fileOpenerRegistry
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { TabInstanceDefinition } from "../layout/workbenchContracts";
import {
    getFileOpenersSnapshot,
    getMatchingFileOpeners,
    registerFileOpener,
    resolveFileOpener,
    unregisterFileOpener,
    type FileOpenerDescriptor,
} from "./fileOpenerRegistry";

function createOpener(overrides: Partial<FileOpenerDescriptor> & { id: string }): FileOpenerDescriptor {
    return {
        id: overrides.id,
        label: overrides.label ?? overrides.id,
        kind: overrides.kind ?? "markdown",
        priority: overrides.priority ?? 10,
        matches: overrides.matches ?? (({ relativePath }) => relativePath.endsWith(".md")),
        resolveTab: overrides.resolveTab ?? (async ({ relativePath }): Promise<TabInstanceDefinition> => ({
            id: `file:${relativePath}`,
            title: relativePath,
            component: "test",
        })),
    };
}

describe("fileOpenerRegistry", () => {
    afterEach(() => {
        for (const opener of getFileOpenersSnapshot()) {
            unregisterFileOpener(opener.id);
        }
    });

    it("应注册并返回 opener 快照", () => {
        registerFileOpener(createOpener({ id: "markdown.codemirror", priority: 100 }));

        const snapshot = getFileOpenersSnapshot();
        expect(snapshot).toHaveLength(1);
        expect(snapshot[0].id).toBe("markdown.codemirror");
        expect(snapshot[0].kind).toBe("markdown");
    });

    it("应按优先级降序返回候选 opener", () => {
        registerFileOpener(createOpener({ id: "markdown.secondary", priority: 10 }));
        registerFileOpener(createOpener({ id: "markdown.primary", priority: 100 }));

        const candidates = getMatchingFileOpeners({ relativePath: "notes/test.md" });
        expect(candidates.map((item) => item.id)).toEqual([
            "markdown.primary",
            "markdown.secondary",
        ]);
    });

    it("应优先使用显式指定且匹配的 opener id", () => {
        registerFileOpener(createOpener({ id: "markdown.secondary", priority: 10 }));
        registerFileOpener(createOpener({ id: "markdown.primary", priority: 100 }));

        const resolved = resolveFileOpener(
            { relativePath: "notes/test.md" },
            "markdown.secondary",
        );

        expect(resolved?.id).toBe("markdown.secondary");
    });

    it("显式 opener 不匹配时应回退到最高优先级候选", () => {
        registerFileOpener(createOpener({ id: "markdown.primary", priority: 100 }));
        registerFileOpener(createOpener({
            id: "image.default",
            kind: "image",
            priority: 200,
            matches: ({ relativePath }) => relativePath.endsWith(".png"),
        }));

        const resolved = resolveFileOpener(
            { relativePath: "notes/test.md" },
            "image.default",
        );

        expect(resolved?.id).toBe("markdown.primary");
    });
});