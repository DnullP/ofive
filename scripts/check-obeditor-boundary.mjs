/**
 * @file scripts/check-obeditor-boundary.mjs
 * @description obeditor 边界守卫：防止通用 Markdown editor 插件实现回流到 ofive。
 */

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, "src");

export const forbiddenEditorPluginRoots = [
    "src/plugins/markdown-codemirror/editor/components/",
    "src/plugins/markdown-codemirror/editor/editPlugins/",
    "src/plugins/markdown-codemirror/editor/handoff/",
    "src/plugins/markdown-codemirror/editor/syntaxPlugins/",
    "src/plugins/markdown-codemirror/editor/utils/",
];

export const forbiddenEditorImplementationFiles = new Set([
    "src/plugins/markdown-codemirror/editor/editorPasteImageHandler.ts",
    "src/plugins/markdown-codemirror/editor/editorPasteImageHandler.test.ts",
]);

const ignoredPathFragments = new Set([
    ".DS_Store",
]);

function toPosixPath(inputPath) {
    return inputPath.split(path.sep).join("/");
}

function listFiles(directory) {
    const files = [];
    for (const entryName of readdirSync(directory)) {
        const entryPath = path.join(directory, entryName);
        const stats = statSync(entryPath);
        if (stats.isDirectory()) {
            files.push(...listFiles(entryPath));
            continue;
        }

        files.push(entryPath);
    }

    return files;
}

function shouldIgnorePath(relativePath) {
    return [...ignoredPathFragments].some((fragment) => relativePath.includes(fragment));
}

export function buildObeditorBoundaryViolations(relativePaths) {
    return relativePaths
        .filter((relativePath) => !shouldIgnorePath(relativePath))
        .flatMap((relativePath) => {
            if (forbiddenEditorImplementationFiles.has(relativePath)) {
                return [{
                    relativePath,
                    reason: "generic editor implementation must live in ../obeditor",
                }];
            }

            const forbiddenRoot = forbiddenEditorPluginRoots.find((root) => relativePath.startsWith(root));
            if (!forbiddenRoot) {
                return [];
            }

            return [{
                relativePath,
                reason: `generic editor plugin directory is reserved for ../obeditor (${forbiddenRoot})`,
            }];
        });
}

function isMainModule() {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
    const relativePaths = listFiles(sourceRoot)
        .map((filePath) => toPosixPath(path.relative(repoRoot, filePath)));
    const violations = buildObeditorBoundaryViolations(relativePaths);

    if (violations.length > 0) {
        console.error("[obeditor-boundary-guard] generic editor plugin code must live in ../obeditor:");
        violations.forEach((violation) => {
            console.error(`  - ${violation.relativePath}: ${violation.reason}`);
        });
        console.error("");
        console.error("Keep ofive editor code limited to host adapters: vault/wiki/media/i18n/native context menu capability injection, workbench lifecycle, and frontend state synchronization.");
        process.exit(1);
    }

    console.info("[obeditor-boundary-guard] passed");
}
