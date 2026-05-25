/**
 * @file scripts/scan-code-simplification-targets.mjs
 * @description 扫描代码简化对象：超大文件、复杂 React 表面、边界逃逸和持久化 mutation 入口。
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
    codeSimplificationIgnoredDirectoryNames,
    codeSimplificationScanRoots,
    codeSimplificationSourceExtensions,
    duplicateStoreEntrypointPairs,
    lineCountThresholds,
    persistedContentAllowedFilesBySymbol,
} from "./code-simplification-baseline.config.mjs";

const HOOK_PATTERNS = {
    useCallback: /\buseCallback\s*\(/g,
    useEffect: /\buseEffect\s*\(/g,
    useMemo: /\buseMemo\s*\(/g,
    useState: /\buseState\s*\(/g,
    useSyncExternalStore: /\buseSyncExternalStore\s*\(/g,
};

const TYPE_ESCAPE_HATCH_PATTERN = /\bas\s+any\b|\bas\s+unknown\s+as\b/g;
const COMMENT_ESCAPE_HATCH_PATTERN = /@ts-ignore|@ts-expect-error|eslint-disable|no-explicit-any/g;
const LEGACY_STORE_IMPORT_PATTERN = /(?:from\s+["'][^"']*host\/store\/(?:configStore|shortcutStore|themeStore|vaultStore)|import\s*\(\s*["'][^"']*host\/store\/(?:configStore|shortcutStore|themeStore|vaultStore))/g;
const RAW_TAURI_PATTERN = /(?:from\s+["']@tauri-apps\/api|import\s*\(\s*["']@tauri-apps\/api)/g;

export function toPosixPath(inputPath) {
    return inputPath.split(path.sep).join("/");
}

export function isTestFile(relativePath) {
    return relativePath.startsWith("src/test-support/") ||
        relativePath.startsWith("src-tauri/tests/") ||
        relativePath.startsWith("tests/") ||
        /\.(test|e2e|perf)\.(mjs|rs|ts|tsx)$/.test(relativePath);
}

export function getLineCountThreshold(relativePath) {
    const extension = path.extname(relativePath);

    if (isTestFile(relativePath)) {
        return lineCountThresholds.test;
    }

    if (extension === ".css") {
        return lineCountThresholds.css;
    }

    if (extension === ".mjs") {
        return lineCountThresholds.script;
    }

    if (extension === ".go" || extension === ".rs") {
        return lineCountThresholds.backendSource;
    }

    return lineCountThresholds.source;
}

export function stripCodeComments(content) {
    return content
        .replaceAll(/\/\*[\s\S]*?\*\//g, "")
        .replaceAll(/^\s*\/\/.*$/gm, "");
}

function listCodeFilesInDirectory(directory) {
    if (!existsSync(directory)) {
        return [];
    }

    const files = [];
    for (const entryName of readdirSync(directory)) {
        const entryPath = path.join(directory, entryName);
        const stats = statSync(entryPath);

        if (stats.isDirectory()) {
            if (!codeSimplificationIgnoredDirectoryNames.has(entryName)) {
                files.push(...listCodeFilesInDirectory(entryPath));
            }
            continue;
        }

        if (codeSimplificationSourceExtensions.has(path.extname(entryPath))) {
            files.push(entryPath);
        }
    }

    return files;
}

function countMatches(content, pattern) {
    pattern.lastIndex = 0;
    return Array.from(content.matchAll(pattern)).length;
}

function countHooks(content) {
    const hooks = {};
    for (const [hookName, pattern] of Object.entries(HOOK_PATTERNS)) {
        hooks[hookName] = countMatches(content, pattern);
    }

    return hooks;
}

function countPersistedMutations(content) {
    const counts = {};
    for (const symbol of Object.keys(persistedContentAllowedFilesBySymbol).sort()) {
        const pattern = new RegExp(`\\b${symbol}\\b`, "g");
        counts[symbol] = countMatches(content, pattern);
    }

    return counts;
}

function emptyPersistedMutationCounts() {
    const counts = {};
    for (const symbol of Object.keys(persistedContentAllowedFilesBySymbol).sort()) {
        counts[symbol] = 0;
    }

    return counts;
}

function shouldCountPersistedMutations(relativePath) {
    return relativePath.startsWith("src/");
}

function countEscapeHatches(relativePath, content, codeOnlyContent) {
    const extension = path.extname(relativePath);
    if (extension !== ".ts" && extension !== ".tsx") {
        return 0;
    }

    return countMatches(codeOnlyContent, TYPE_ESCAPE_HATCH_PATTERN) +
        countMatches(content, COMMENT_ESCAPE_HATCH_PATTERN);
}

function sumObjectValues(value) {
    return Object.values(value).reduce((total, item) => total + item, 0);
}

function calculateSimplificationScore(metrics) {
    return metrics.lineCount +
        metrics.hooks.useEffect * 90 +
        metrics.hooks.useState * 45 +
        metrics.hooks.useMemo * 20 +
        metrics.hooks.useCallback * 25 +
        metrics.hooks.useSyncExternalStore * 30 +
        metrics.escapeHatchCount * 35 +
        metrics.todoCount * 60 +
        metrics.rawTauriApiCount * 50 +
        metrics.persistedMutationCount * 80 +
        metrics.legacyStoreImportCount * 60;
}

export function collectCodeSimplificationMetrics(repoRoot = process.cwd()) {
    const files = [];

    for (const scanRoot of codeSimplificationScanRoots) {
        const absoluteScanRoot = path.join(repoRoot, scanRoot);
        for (const filePath of listCodeFilesInDirectory(absoluteScanRoot)) {
            const relativePath = toPosixPath(path.relative(repoRoot, filePath));
            const content = readFileSync(filePath, "utf8");
            const codeOnlyContent = stripCodeComments(content);
            const hooks = countHooks(codeOnlyContent);
            const persistedMutationCounts = shouldCountPersistedMutations(relativePath)
                ? countPersistedMutations(codeOnlyContent)
                : emptyPersistedMutationCounts();
            const lineCount = content.split(/\r?\n/).length;
            const threshold = getLineCountThreshold(relativePath);

            files.push({
                relativePath,
                extension: path.extname(relativePath),
                isTest: isTestFile(relativePath),
                lineCount,
                lineThreshold: threshold,
                lineOverflow: Math.max(0, lineCount - threshold),
                hooks,
                hookCount: sumObjectValues(hooks),
                escapeHatchCount: countEscapeHatches(relativePath, content, codeOnlyContent),
                rawTauriApiCount: countMatches(codeOnlyContent, RAW_TAURI_PATTERN),
                todoCount: countMatches(content, /\b(TODO|FIXME|HACK|XXX)\b/g),
                legacyStoreImportCount: countMatches(codeOnlyContent, LEGACY_STORE_IMPORT_PATTERN),
                persistedMutationCounts,
                persistedMutationCount: sumObjectValues(persistedMutationCounts),
            });
        }
    }

    return files.map((metrics) => ({
        ...metrics,
        simplificationScore: calculateSimplificationScore(metrics),
    }));
}

function buildDuplicateStoreEntrypoints(repoRoot) {
    return duplicateStoreEntrypointPairs
        .map((pair) => ({
            ...pair,
            canonicalExists: existsSync(path.join(repoRoot, pair.canonical)),
            duplicateExists: existsSync(path.join(repoRoot, pair.duplicate)),
        }))
        .filter((pair) => pair.duplicateExists);
}

function buildMissingGovernanceReferences(repoRoot) {
    const references = [
        {
            source: "AGENTS.md",
            target: "docs/wiki/ofive-code-simplification-governance.md",
            reason: "AGENTS.md links code governance instructions that must stay available.",
        },
    ];

    return references.filter((reference) => {
        return existsSync(path.join(repoRoot, reference.source)) &&
            !existsSync(path.join(repoRoot, reference.target));
    });
}

export function buildCodeSimplificationReport(repoRoot = process.cwd(), options = {}) {
    const topCount = Number.isInteger(options.topCount) ? options.topCount : 30;
    const files = collectCodeSimplificationMetrics(repoRoot);
    const sortedTargets = [...files]
        .filter((file) => !file.isTest)
        .sort((left, right) => right.simplificationScore - left.simplificationScore);

    return {
        generatedAt: new Date().toISOString(),
        repoRoot,
        summary: {
            scannedFiles: files.length,
            oversizedFiles: files.filter((file) => file.lineOverflow > 0).length,
            rawTauriFiles: files.filter((file) => file.rawTauriApiCount > 0).length,
            escapeHatchFiles: files.filter((file) => file.escapeHatchCount > 0 && !file.isTest).length,
            persistedMutationFiles: files.filter((file) => file.persistedMutationCount > 0).length,
        },
        topTargets: sortedTargets.slice(0, topCount),
        oversizedFiles: files
            .filter((file) => file.lineOverflow > 0)
            .sort((left, right) => right.lineOverflow - left.lineOverflow),
        rawTauriFiles: files
            .filter((file) => file.rawTauriApiCount > 0)
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
        escapeHatchFiles: files
            .filter((file) => file.escapeHatchCount > 0 && !file.isTest)
            .sort((left, right) => right.escapeHatchCount - left.escapeHatchCount),
        legacyStoreImportFiles: files
            .filter((file) => file.legacyStoreImportCount > 0 && !file.isTest)
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
        persistedMutationFiles: files
            .filter((file) => file.persistedMutationCount > 0)
            .sort((left, right) => right.persistedMutationCount - left.persistedMutationCount),
        duplicateStoreEntrypoints: buildDuplicateStoreEntrypoints(repoRoot),
        missingGovernanceReferences: buildMissingGovernanceReferences(repoRoot),
    };
}

function formatTargetLine(file) {
    const hooks = `${file.hooks.useEffect}/${file.hooks.useState}/${file.hooks.useMemo}/${file.hooks.useCallback}`;
    return `${String(Math.round(file.simplificationScore)).padStart(5)} ` +
        `${String(file.lineCount).padStart(4)} hooks:${hooks} ` +
        `escape:${file.escapeHatchCount} tauri:${file.rawTauriApiCount} ` +
        `vault:${file.persistedMutationCount} ${file.relativePath}`;
}

function formatTextReport(report) {
    const lines = [
        `[code-simplification-scan] scanned ${report.summary.scannedFiles} files`,
        `[code-simplification-scan] oversized=${report.summary.oversizedFiles} rawTauri=${report.summary.rawTauriFiles} escapeHatches=${report.summary.escapeHatchFiles} persistedMutations=${report.summary.persistedMutationFiles}`,
        "",
        "Top simplification targets:",
        ...report.topTargets.map(formatTargetLine),
        "",
        "Oversized files:",
        ...report.oversizedFiles.slice(0, 40).map((file) => {
            return `  - ${file.relativePath}: ${file.lineCount}/${file.lineThreshold} (+${file.lineOverflow})`;
        }),
        "",
    ];

    if (report.duplicateStoreEntrypoints.length > 0) {
        lines.push(
            "",
            "Duplicate store entrypoints:",
            ...report.duplicateStoreEntrypoints.map((item) => {
                return `  - ${item.canonical} <-> ${item.duplicate}`;
            }),
        );
    }

    if (report.missingGovernanceReferences.length > 0) {
        lines.push("", "Missing governance references:");
        report.missingGovernanceReferences.forEach((reference) => {
            lines.push(`  - ${reference.source} -> ${reference.target}: ${reference.reason}`);
        });
    }

    return `${lines.join("\n")}\n`;
}

function formatMarkdownReport(report) {
    const rows = report.topTargets.map((file) => {
        return `| ${file.relativePath} | ${Math.round(file.simplificationScore)} | ${file.lineCount} | ${file.hookCount} | ${file.escapeHatchCount} | ${file.persistedMutationCount} |`;
    });

    return [
        "# Code Simplification Targets",
        "",
        `Generated: ${report.generatedAt}`,
        "",
        `Scanned ${report.summary.scannedFiles} files. Oversized: ${report.summary.oversizedFiles}. Escape hatch files: ${report.summary.escapeHatchFiles}.`,
        "",
        "| File | Score | Lines | Hooks | Escapes | Vault Mutations |",
        "|---|---:|---:|---:|---:|---:|",
        ...rows,
        "",
    ].join("\n");
}

function parseCliOptions(argv) {
    const options = {
        format: "text",
        topCount: 30,
    };

    argv.forEach((arg) => {
        if (arg.startsWith("--format=")) {
            options.format = arg.slice("--format=".length);
        }
        if (arg.startsWith("--top=")) {
            options.topCount = Number(arg.slice("--top=".length));
        }
    });

    return options;
}

function printReport(report, format) {
    if (format === "json") {
        console.info(JSON.stringify(report, null, 2));
        return;
    }

    if (format === "markdown") {
        console.info(formatMarkdownReport(report));
        return;
    }

    console.info(formatTextReport(report));
}

function isMainModule() {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
    const options = parseCliOptions(process.argv.slice(2));
    const report = buildCodeSimplificationReport(process.cwd(), options);
    printReport(report, options.format);
}
