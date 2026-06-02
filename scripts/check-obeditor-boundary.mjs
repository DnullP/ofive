/**
 * @file scripts/check-obeditor-boundary.mjs
 * @description obeditor 边界守卫：防止通用 Markdown editor 插件实现回流到 ofive。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
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

export const forbiddenObeditorImports = new Set([
    "attachPasteImageHandler",
    "createCodeBlockHighlightExtension",
    "createFrontmatterSyntaxExtension",
    "createImageEmbedSyntaxExtension",
    "createLatexSyntaxExtension",
    "createMarkdownTableSyntaxExtension",
    "createPasteImageExtension",
    "createRegisteredLineSyntaxRenderExtension",
    "createTaskCheckboxToggleExtension",
    "createWikiLinkNavigationExtension",
    "createWikiLinkPreviewExtension",
    "ensureBuiltinEditPluginsRegistered",
    "ensureBuiltinSyntaxRenderersRegistered",
    "ensureBuiltinVimHandoffsRegistered",
    "getRegisteredEditPluginExtensions",
]);

export const forbiddenEditorPluginCssPatterns = [
    { label: ".cm-rendered-", pattern: /\.cm-rendered-/u },
    { label: ".cm-wikilink-suggest", pattern: /\.cm-wikilink-suggest/u },
    { label: ".cm-wikilink-preview", pattern: /\.cm-wikilink-preview/u },
    { label: ".cm-latex", pattern: /\.cm-latex/u },
    { label: ".cm-frontmatter-widget", pattern: /\.cm-frontmatter-widget/u },
    { label: ".cm-image-embed", pattern: /\.cm-image-embed/u },
    { label: ".cm-code-block", pattern: /\.cm-code-block/u },
    { label: ".cm-mermaid-widget", pattern: /\.cm-mermaid-widget/u },
    { label: ".cm-hidden-block", pattern: /\.cm-hidden-block/u },
    { label: ".cm-markdown-table-widget", pattern: /\.cm-markdown-table-widget/u },
    { label: ".hljs-", pattern: /\.hljs-/u },
    { label: "katex/dist", pattern: /katex\/dist/u },
];

export const forbiddenEditorPluginDomPatterns = [
    { label: ".fmv-editor", pattern: /\.fmv-editor/u },
    { label: ".cm-frontmatter-widget .fmv-", pattern: /\.cm-frontmatter-widget\s+\.fmv-/u },
    { label: "data-frontmatter-*", pattern: /data-frontmatter-/u },
    { label: "data-markdown-table-*", pattern: /data-markdown-table-/u },
];

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

function parseNamedObeditorImports(source) {
    const imports = [];
    const importPattern = /import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["']obeditor["']/g;
    let match = importPattern.exec(source);
    while (match) {
        const importedNames = (match[1] ?? "")
            .split(",")
            .map((binding) => binding.trim().split(/\s+as\s+/u)[0]?.trim())
            .filter((binding) => Boolean(binding));
        imports.push(...importedNames);
        match = importPattern.exec(source);
    }

    return imports;
}

export function buildObeditorImportViolations(sourceByRelativePath) {
    return Object.entries(sourceByRelativePath).flatMap(([relativePath, source]) => {
        const forbiddenImports = parseNamedObeditorImports(source)
            .filter((binding) => forbiddenObeditorImports.has(binding));
        if (forbiddenImports.length === 0) {
            return [];
        }

        return forbiddenImports.map((binding) => ({
            relativePath,
            reason: `ofive must consume obeditor's default extension pack instead of importing ${binding}`,
        }));
    });
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

export function buildObeditorCssViolations(sourceByRelativePath) {
    return Object.entries(sourceByRelativePath).flatMap(([relativePath, source]) => {
        if (!relativePath.startsWith("src/plugins/markdown-codemirror/editor/")) {
            return [];
        }

        if (!relativePath.endsWith(".css")) {
            return [];
        }

        return forbiddenEditorPluginCssPatterns
            .filter(({ pattern }) => pattern.test(source))
            .map(({ label }) => ({
                relativePath,
                reason: `generic editor plugin CSS selector ${label} must live in ../obeditor/styles.css`,
            }));
    });
}

export function buildObeditorDomContractViolations(sourceByRelativePath) {
    return Object.entries(sourceByRelativePath).flatMap(([relativePath, source]) => {
        if (!relativePath.startsWith("src/plugins/markdown-codemirror/editor/")) {
            return [];
        }

        if (!/\.(?:ts|tsx|js|jsx|mjs)$/u.test(relativePath)) {
            return [];
        }

        if (/\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs)$/u.test(relativePath)) {
            return [];
        }

        return forbiddenEditorPluginDomPatterns
            .filter(({ pattern }) => pattern.test(source))
            .map(({ label }) => ({
                relativePath,
                reason: `ofive must use obeditor exported contracts instead of inspecting plugin DOM ${label}`,
            }));
    });
}

function isMainModule() {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
    const sourceFiles = listFiles(sourceRoot);
    const relativePaths = sourceFiles.map((filePath) => toPosixPath(path.relative(repoRoot, filePath)));
    const sourceByRelativePath = Object.fromEntries(sourceFiles
        .filter((filePath) => /\.(?:ts|tsx|js|jsx|mjs)$/u.test(filePath))
        .map((filePath) => [
            toPosixPath(path.relative(repoRoot, filePath)),
            readFileSync(filePath, "utf8"),
        ]));
    const cssSourceByRelativePath = Object.fromEntries(sourceFiles
        .filter((filePath) => /\.css$/u.test(filePath))
        .map((filePath) => [
            toPosixPath(path.relative(repoRoot, filePath)),
            readFileSync(filePath, "utf8"),
        ]));
    const violations = [
        ...buildObeditorBoundaryViolations(relativePaths),
        ...buildObeditorImportViolations(sourceByRelativePath),
        ...buildObeditorCssViolations(cssSourceByRelativePath),
        ...buildObeditorDomContractViolations(sourceByRelativePath),
    ];

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
