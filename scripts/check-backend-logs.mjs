/**
 * @file scripts/check-backend-logs.mjs
 * @description 后端日志守卫：扫描 src-tauri/src 下未接入统一日志系统的原始标准输出调用。
 *
 * 规则：
 * - 默认检查 src-tauri/src 下全部 Rust 源文件。
 * - 禁止业务代码直接使用 println!/eprintln!。
 * - 允许日志底层实现文件 logging.rs 直接写 stdout/stderr，避免 logger 自身递归。
 * - 支持 --fix：将 println! 自动替换为 log::info!，eprintln! 自动替换为 log::warn!。
 */

import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const backendRoot = path.join(workspaceRoot, "src-tauri", "src");
const rawLogMacroPattern = /^(\s*)(e?println!)\s*\(/gm;
const allowList = new Set([path.join(backendRoot, "logging.rs")]);
const fixMode = process.argv.includes("--fix");

/**
 * @function walkRustFiles
 * @description 递归收集目录下全部 Rust 源文件。
 * @param {string} dir 目录绝对路径。
 * @returns {string[]} Rust 文件绝对路径数组。
 */
function walkRustFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkRustFiles(absolutePath));
            continue;
        }

        if (entry.isFile() && absolutePath.endsWith(".rs")) {
            files.push(absolutePath);
        }
    }

    return files;
}

/**
 * @function offsetToLineNumber
 * @description 将字符偏移转换为 1-based 行号。
 * @param {string} content 文件内容。
 * @param {number} offset 字符偏移。
 * @returns {number} 1-based 行号。
 */
function offsetToLineNumber(content, offset) {
    return content.slice(0, offset).split(/\r?\n/).length;
}

/**
 * @function toRelativePath
 * @description 将绝对路径转换为相对工作区路径，便于终端输出定位。
 * @param {string} filePath 文件绝对路径。
 * @returns {string} 工作区相对路径。
 */
function toRelativePath(filePath) {
    return path.relative(workspaceRoot, filePath).replaceAll(path.sep, "/");
}

/**
 * @function findRawLogViolations
 * @description 扫描单个 Rust 文件中的原始标准输出调用。
 * @param {string} filePath 文件绝对路径。
 * @returns {{line:number, macro:string, text:string}[]} 违规项列表。
 */
function findRawLogViolations(filePath) {
    if (allowList.has(filePath)) {
        return [];
    }

    const content = fs.readFileSync(filePath, "utf8");
    const violations = [];

    rawLogMacroPattern.lastIndex = 0;
    let match = rawLogMacroPattern.exec(content);

    while (match) {
        const line = offsetToLineNumber(content, match.index ?? 0);
        const lineText = content.split(/\r?\n/)[line - 1] ?? "";
        violations.push({
            line,
            macro: match[2] ?? "println!",
            text: lineText.trim(),
        });
        match = rawLogMacroPattern.exec(content);
    }

    return violations;
}

/**
 * @function fixRawLogMacros
 * @description 自动修复单个文件中的原始标准输出调用。
 * @param {string} filePath 文件绝对路径。
 * @returns {boolean} 是否发生了修改。
 */
function fixRawLogMacros(filePath) {
    if (allowList.has(filePath)) {
        return false;
    }

    const content = fs.readFileSync(filePath, "utf8");
    const fixed = content.replaceAll(rawLogMacroPattern, (fullMatch, indent, macro) => {
        const replacementMacro = macro === "eprintln!" ? "log::warn!" : "log::info!";
        return `${indent}${replacementMacro}(`;
    });

    if (fixed === content) {
        return false;
    }

    fs.writeFileSync(filePath, fixed);
    return true;
}

const rustFiles = walkRustFiles(backendRoot).sort();

if (fixMode) {
    let fixedCount = 0;
    for (const filePath of rustFiles) {
        if (fixRawLogMacros(filePath)) {
            fixedCount += 1;
        }
    }
    console.log(`[backend-log-guard] autofix updated ${fixedCount} file(s).`);
}

const violationEntries = rustFiles
    .map((filePath) => ({
        filePath,
        violations: findRawLogViolations(filePath),
    }))
    .filter((entry) => entry.violations.length > 0);

if (violationEntries.length === 0) {
    console.log("[backend-log-guard] passed: no raw println!/eprintln! found in backend runtime code.");
    process.exit(0);
}

console.error(
    `[backend-log-guard] failed: found ${violationEntries.reduce((total, entry) => total + entry.violations.length, 0)} raw log call(s).`,
);

for (const entry of violationEntries) {
    for (const violation of entry.violations) {
        console.error(
            `${toRelativePath(entry.filePath)}:${violation.line} ${violation.macro} ${violation.text}`,
        );
    }
}

console.error(
    "[backend-log-guard] replace raw stdout/stderr logging with log::info!/warn!/error! so logs are persisted by src-tauri/src/logging.rs.",
);

process.exit(1);