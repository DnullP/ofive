/**
 * @file scripts/run-unit-tests-with-summary.mjs
 * @description 前端单测包装脚本：保留 Bun 默认测试输出，并在失败后补充失败 case 与原因摘要，
 *   便于在 GitHub Actions 折叠日志中快速定位失败用例。
 *
 * 使用方式：
 * - `node scripts/run-unit-tests-with-summary.mjs`
 * - `node scripts/run-unit-tests-with-summary.mjs src/foo.test.ts`
 */

import { spawn } from "node:child_process";

const bunArgs = ["test", ...process.argv.slice(2)];

/**
 * @function stripAnsi
 * @description 移除终端 ANSI 颜色控制字符，便于解析 Bun 输出。
 * @param {string} value 原始终端文本。
 * @returns {string} 去除 ANSI 后的文本。
 */
function stripAnsi(value) {
    return String(value).replaceAll(/\u001B\[[0-9;]*m/g, "");
}

/**
 * @function isTestFileHeaderLine
 * @description 判断当前行是否为 Bun 输出中的测试文件标题。
 * @param {string} line 单行文本。
 * @returns {boolean} 是否为测试文件标题。
 */
function isTestFileHeaderLine(line) {
    return /(?:^|\s)([^\s]+\.test\.[cm]?[jt]sx?):$/.test(line.trim());
}

/**
 * @function parseTestFileFromHeader
 * @description 从测试文件标题行提取文件路径。
 * @param {string} line 单行文本。
 * @returns {string|null} 测试文件路径。
 */
function parseTestFileFromHeader(line) {
    const match = line.trim().match(/([^\s]+\.test\.[cm]?[jt]sx?):$/);
    return match?.[1] ?? null;
}

/**
 * @function isFailedCaseLine
 * @description 判断当前行是否为失败测试 case 结果行。
 * @param {string} line 单行文本。
 * @returns {boolean} 是否为失败 case 行。
 */
function isFailedCaseLine(line) {
    const trimmed = line.trim();
    return /^✗\s+.+\[[^\]]+\]$/.test(trimmed)
        || /^\(fail\)\s+.+\[[^\]]+\]$/.test(trimmed);
}

/**
 * @function parseFailedCaseName
 * @description 从失败 case 行提取测试名称。
 * @param {string} line 单行文本。
 * @returns {string} 测试名称。
 */
function parseFailedCaseName(line) {
    return line
        .trim()
        .replace(/^✗\s+/, "")
        .replace(/^\(fail\)\s+/, "")
        .replace(/\s+\[[^\]]+\]$/, "")
        .trim();
}

/**
 * @function normalizeReasonLines
 * @description 从 Bun 原始失败输出中提取对人类可读的失败原因摘要。
 * @param {string[]} blockLines 单个失败 case 之前的原始输出块。
 * @returns {string[]} 清洗后的原因摘要行。
 */
function normalizeReasonLines(blockLines) {
    const lines = blockLines
        .map((line) => stripAnsi(line).replace(/\r/g, ""))
        .map((line) => line.replace(/\s+$/, ""));

    const filteredLines = lines.filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            return false;
        }

        if (/^[✓›>]/.test(trimmed)) {
            return false;
        }

        if (/^\d+\s*\|/.test(trimmed)) {
            return false;
        }

        if (/^\^+$/.test(trimmed)) {
            return false;
        }

        return true;
    });

    const errorStartIndex = filteredLines.findIndex((line) => {
        const trimmed = line.trimStart();
        return (
            trimmed.startsWith("error:")
            || trimmed.startsWith("Error:")
            || trimmed.startsWith("TypeError:")
            || trimmed.startsWith("ReferenceError:")
            || trimmed.startsWith("SyntaxError:")
            || trimmed.startsWith("RangeError:")
            || trimmed.startsWith("AssertionError")
        );
    });

    const relevantLines = errorStartIndex >= 0
        ? filteredLines.slice(errorStartIndex)
        : filteredLines.slice(-8);

    return relevantLines.slice(0, 12);
}

/**
 * @function parseFailureSummary
 * @description 解析 Bun 默认输出中的失败 case 与原因。
 * @param {string} output Bun 完整终端输出。
 * @returns {{filePath:string,testName:string,reasonLines:string[]}[]} 失败摘要列表。
 */
function parseFailureSummary(output) {
    const lines = stripAnsi(output).split(/\r?\n/);
    const failures = [];
    let currentFilePath = null;
    let currentBlock = [];

    for (const line of lines) {
        if (isTestFileHeaderLine(line)) {
            currentFilePath = parseTestFileFromHeader(line);
            currentBlock = [];
            continue;
        }

        if (isFailedCaseLine(line)) {
            failures.push({
                filePath: currentFilePath ?? "unknown-file",
                testName: parseFailedCaseName(line),
                reasonLines: normalizeReasonLines(currentBlock),
            });
            currentBlock = [];
            continue;
        }

        if (currentFilePath) {
            currentBlock.push(line);
        }
    }

    return failures;
}

/**
 * @function printFailureSummary
 * @description 将失败摘要输出到终端末尾，避免在 CI 折叠日志中难以定位。
 * @param {{filePath:string,testName:string,reasonLines:string[]}[]} failures 失败摘要列表。
 */
function printFailureSummary(failures) {
    if (failures.length === 0) {
        return;
    }

    console.error("\n[unit-test-summary] failed test cases");
    failures.forEach((failure, index) => {
        console.error(
            `\n[unit-test-summary] ${String(index + 1)}. ${failure.filePath} :: ${failure.testName}`,
        );

        if (failure.reasonLines.length === 0) {
            console.error("[unit-test-summary] reason: unavailable from bun output");
            return;
        }

        failure.reasonLines.forEach((line) => {
            console.error(`[unit-test-summary] ${line}`);
        });
    });
    console.error(`\n[unit-test-summary] total failed cases: ${String(failures.length)}`);
}

const child = spawn("bun", bunArgs, {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
});

let combinedOutput = "";

child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    combinedOutput += text;
    process.stdout.write(text);
});

child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    combinedOutput += text;
    process.stderr.write(text);
});

child.on("close", (code, signal) => {
    if (signal) {
        console.error(`[unit-test-summary] bun test terminated by signal: ${signal}`);
        process.exit(1);
    }

    if ((code ?? 0) !== 0) {
        printFailureSummary(parseFailureSummary(combinedOutput));
    }

    process.exit(code ?? 0);
});
