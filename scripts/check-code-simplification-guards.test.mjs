/**
 * @file scripts/check-code-simplification-guards.test.mjs
 * @description 代码简化 guard 的最小回归测试，确保新增债务会被脚本拦截。
 */

import { describe, expect, test } from "bun:test";

import { buildCodeSimplificationViolations } from "./check-code-simplification-guards.mjs";
import { stripCodeComments } from "./scan-code-simplification-targets.mjs";

function createReport(overrides = {}) {
    return {
        oversizedFiles: [],
        escapeHatchFiles: [],
        rawTauriFiles: [],
        legacyStoreImportFiles: [],
        duplicateStoreEntrypoints: [],
        ...overrides,
    };
}

describe("code simplification guards", () => {
    test("strips comment-only boundary references before scanning raw imports", () => {
        const content = [
            "/**",
            " * @tauri-apps/api/core",
            " */",
            "import { invoke } from \"@tauri-apps/api/core\";",
        ].join("\n");

        expect(stripCodeComments(content).trim()).toBe("import { invoke } from \"@tauri-apps/api/core\";");
    });

    test("rejects a new source file above the line-count threshold", () => {
        const report = createReport({
            oversizedFiles: [
                {
                    relativePath: "src/plugins/example/ExampleTab.tsx",
                    lineCount: 900,
                    lineThreshold: 800,
                },
            ],
        });

        expect(buildCodeSimplificationViolations(report)).toEqual([
            {
                kind: "line-count",
                relativePath: "src/plugins/example/ExampleTab.tsx",
                message: "900 lines exceeds allowed 800",
            },
        ]);
    });

    test("allows raw Tauri imports in API wrappers but rejects plugin-level imports", () => {
        const report = createReport({
            rawTauriFiles: [
                {
                    relativePath: "src/api/newApi.ts",
                },
                {
                    relativePath: "src/plugins/example/examplePlugin.tsx",
                },
            ],
        });

        expect(buildCodeSimplificationViolations(report)).toEqual([
            {
                kind: "raw-tauri",
                relativePath: "src/plugins/example/examplePlugin.tsx",
                message: "raw @tauri-apps/api usage must stay inside src/api/** or approved host platform facades",
            },
        ]);
    });

    test("rejects new type escape hatches outside the baseline", () => {
        const report = createReport({
            escapeHatchFiles: [
                {
                    relativePath: "src/plugins/example/examplePlugin.tsx",
                    escapeHatchCount: 1,
                },
            ],
        });

        expect(buildCodeSimplificationViolations(report)).toEqual([
            {
                kind: "escape-hatch",
                relativePath: "src/plugins/example/examplePlugin.tsx",
                message: "1 escape hatches exceeds allowed 0",
            },
        ]);
    });

    test("rejects obsolete duplicate store entrypoints", () => {
        const report = createReport({
            duplicateStoreEntrypoints: [
                {
                    canonical: "src/host/config/configStore.ts",
                    duplicate: "src/host/store/configStore.ts",
                    canonicalExists: true,
                    duplicateExists: true,
                },
            ],
        });

        expect(buildCodeSimplificationViolations(report)).toEqual([
            {
                kind: "duplicate-store-entrypoint",
                relativePath: "src/host/store/configStore.ts",
                message: "obsolete compatibility entrypoint duplicates src/host/config/configStore.ts",
            },
        ]);
    });
});
