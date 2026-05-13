/**
 * @module host/layout/openFileService.test
 * @description 文件打开服务测试，覆盖解析出的 tab 生命周期元数据。
 * @dependencies
 *  - bun:test
 *  - ./openFileService
 *
 * @example
 *   bun test src/host/layout/openFileService.test.ts
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    registerFileOpener,
    unregisterFileOpener,
} from "../registry/fileOpenerRegistry";
import {
    registerTabComponent,
    unregisterTabComponent,
} from "../registry/tabComponentRegistry";
import {
    TAB_COMPONENT_ID_PARAM,
    TAB_LIFECYCLE_SCOPE_PARAM,
} from "./vaultTabScope";
import {
    buildFileTabId,
    resolveFileTabDefinition,
} from "./openFileService";

describe("openFileService", () => {
    afterEach(() => {
        unregisterFileOpener("test.markdown");
        unregisterTabComponent("codemirror");
    });

    /**
     * @function should_decorate_resolved_file_tabs_with_registered_lifecycle_scope
     * @description 通过 opener 解析出来的文件 tab 应带上组件 ID 与 vault 生命周期元数据。
     */
    it("should decorate resolved file tabs with registered lifecycle scope", async () => {
        registerTabComponent({
            id: "codemirror",
            component: () => null,
            lifecycleScope: "vault",
        });

        registerFileOpener({
            id: "test.markdown",
            label: "Test Markdown",
            kind: "markdown",
            priority: 100,
            matches: ({ relativePath }) => relativePath.endsWith(".md"),
            resolveTab: async ({ relativePath }) => ({
                id: buildFileTabId(relativePath),
                title: relativePath.split("/").pop() ?? relativePath,
                component: "codemirror",
                params: {
                    path: relativePath,
                    content: "# Test",
                },
            }),
        });

        const tab = await resolveFileTabDefinition({
            relativePath: "notes/demo.md",
            tabParams: {
                autoFocus: true,
            },
        });

        expect(tab?.params?.path).toBe("notes/demo.md");
        expect(tab?.params?.autoFocus).toBe(true);
        expect(tab?.params?.[TAB_COMPONENT_ID_PARAM]).toBe("codemirror");
        expect(tab?.params?.[TAB_LIFECYCLE_SCOPE_PARAM]).toBe("vault");
    });
});
