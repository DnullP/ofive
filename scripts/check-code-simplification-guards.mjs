/**
 * @file scripts/check-code-simplification-guards.mjs
 * @description 代码简化门禁：阻止新增超大文件、类型逃逸、raw Tauri 边界和 legacy store 入口。
 */

import { pathToFileURL } from "node:url";

import {
    allowedRawTauriFiles,
    escapeHatchBaseline,
    legacyStoreEntrypointModules,
    lineCountBaseline,
} from "./code-simplification-baseline.config.mjs";
import {
    buildCodeSimplificationReport,
} from "./scan-code-simplification-targets.mjs";

function isAllowedRawTauriFile(relativePath) {
    return relativePath.startsWith("src/api/") || allowedRawTauriFiles.has(relativePath);
}

function buildLineCountViolations(report) {
    return report.oversizedFiles
        .filter((file) => {
            const allowedLineCount = lineCountBaseline[file.relativePath] ?? file.lineThreshold;
            return file.lineCount > allowedLineCount;
        })
        .map((file) => {
            const allowedLineCount = lineCountBaseline[file.relativePath] ?? file.lineThreshold;
            return {
                kind: "line-count",
                relativePath: file.relativePath,
                message: `${file.lineCount} lines exceeds allowed ${allowedLineCount}`,
            };
        });
}

function buildEscapeHatchViolations(report) {
    return report.escapeHatchFiles
        .filter((file) => {
            const allowedCount = escapeHatchBaseline[file.relativePath] ?? 0;
            return file.escapeHatchCount > allowedCount;
        })
        .map((file) => {
            const allowedCount = escapeHatchBaseline[file.relativePath] ?? 0;
            return {
                kind: "escape-hatch",
                relativePath: file.relativePath,
                message: `${file.escapeHatchCount} escape hatches exceeds allowed ${allowedCount}`,
            };
        });
}

function buildRawTauriViolations(report) {
    return report.rawTauriFiles
        .filter((file) => !isAllowedRawTauriFile(file.relativePath))
        .map((file) => ({
            kind: "raw-tauri",
            relativePath: file.relativePath,
            message: "raw @tauri-apps/api usage must stay inside src/api/** or approved host platform facades",
        }));
}

function buildLegacyStoreImportViolations(report) {
    return report.legacyStoreImportFiles.map((file) => ({
        kind: "legacy-store-import",
        relativePath: file.relativePath,
        message: `imports legacy host/store entrypoint (${Array.from(legacyStoreEntrypointModules).join(", ")})`,
    }));
}

function buildDuplicateStoreEntrypointViolations(report) {
    return report.duplicateStoreEntrypoints.map((entrypoint) => ({
        kind: "duplicate-store-entrypoint",
        relativePath: entrypoint.duplicate,
        message: `obsolete compatibility entrypoint duplicates ${entrypoint.canonical}`,
    }));
}

export function buildCodeSimplificationViolations(report) {
    return [
        ...buildLineCountViolations(report),
        ...buildEscapeHatchViolations(report),
        ...buildRawTauriViolations(report),
        ...buildLegacyStoreImportViolations(report),
        ...buildDuplicateStoreEntrypointViolations(report),
    ];
}

function printViolations(violations) {
    console.error("[code-simplification-guard] new simplification debt is not allowed:");
    violations.forEach((violation) => {
        console.error(`  - ${violation.relativePath}: ${violation.kind}: ${violation.message}`);
    });
    console.error("");
    console.error("Run `bun scripts/scan-code-simplification-targets.mjs` to inspect the current backlog before refactoring.");
}

function isMainModule() {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
    const report = buildCodeSimplificationReport(process.cwd(), { topCount: 80 });
    const violations = buildCodeSimplificationViolations(report);

    if (violations.length > 0) {
        printViolations(violations);
        process.exit(1);
    }

    console.info("[code-simplification-guard] passed");
}
