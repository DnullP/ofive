/**
 * @file scripts/check-persisted-content-guards.mjs
 * @description 防止业务组件绕过持久内容同步服务直接保存文件或发布持久内容事件。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { persistedContentAllowedFilesBySymbol } from "./code-simplification-baseline.config.mjs";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, "src");
const sourceExtensions = new Set([".ts", ".tsx"]);

function toPosixPath(inputPath) {
    return inputPath.split(path.sep).join("/");
}

function listSourceFiles(directory) {
    const files = [];
    for (const entryName of readdirSync(directory)) {
        const entryPath = path.join(directory, entryName);
        const stats = statSync(entryPath);
        if (stats.isDirectory()) {
            files.push(...listSourceFiles(entryPath));
            continue;
        }

        if (sourceExtensions.has(path.extname(entryPath))) {
            files.push(entryPath);
        }
    }

    return files;
}

function shouldIgnoreFile(relativePath) {
    return relativePath.includes(".test.") ||
        relativePath.startsWith("src/test-support/");
}

function stripCodeComments(content) {
    return content
        .replaceAll(/\/\*[\s\S]*?\*\//g, "")
        .replaceAll(/^\s*\/\/.*$/gm, "");
}

function containsSymbol(content, symbol) {
    const pattern = new RegExp(`\\b${symbol}\\b`);
    return pattern.test(content);
}

const violations = [];
for (const filePath of listSourceFiles(sourceRoot)) {
    const relativePath = toPosixPath(path.relative(repoRoot, filePath));
    if (shouldIgnoreFile(relativePath)) {
        continue;
    }

    const content = stripCodeComments(readFileSync(filePath, "utf8"));
    for (const [symbol, allowedFiles] of Object.entries(persistedContentAllowedFilesBySymbol)) {
        if (!containsSymbol(content, symbol) || allowedFiles.has(relativePath)) {
            continue;
        }

        violations.push({
            relativePath,
            symbol,
        });
    }
}

if (violations.length > 0) {
    console.error("[persisted-content-guard] direct persisted content side effects are not allowed:");
    violations.forEach((violation) => {
        console.error(`  - ${violation.relativePath}: ${violation.symbol}`);
    });
    console.error("");
    console.error("Keep saves, renames, moves, deletes, editor snapshots, tab params, autosave state, and persisted.content.updated behind governed mutation services.");
    process.exit(1);
}

console.info("[persisted-content-guard] passed");
