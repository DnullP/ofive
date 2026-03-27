/**
 * @file scripts/check-i18n-copy.mjs
 * @description i18n 文案守卫：在构建前阻止插件内运行时文案注入与常见 JSX 硬编码文本回流。
 *
 * 规则：
 * - 禁止在 src 下 TS/TSX 源文件中使用 i18n.addResourceBundle。
 * - 禁止在 src 下 TSX 中对 placeholder/title/aria-label 直接写字符串字面量。
 * - 禁止在 src 下 TSX 中直接写 JSX 文本节点字面量。
 * - 支持单行忽略：在目标行上一行添加 i18n-guard-ignore-next-line 注释。
 */

import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const srcRoot = path.join(workspaceRoot, "src");
const textAttributePattern = /\b(?:placeholder|title|aria-label)\s*=\s*"([^"{][^"]*)"/g;
const jsxLiteralTextPattern = /<[A-Za-z][^>\n]*>([^<>{\n]*[A-Za-z\u4e00-\u9fff][^<>{\n]*)<\/[A-Za-z][^>\n]*>/g;

/**
 * @function walkFilesByExtension
 * @description 递归收集目录下指定后缀文件。
 * @param dir 目录绝对路径。
 * @param extensions 后缀集合。
 * @returns 文件绝对路径数组。
 */
function walkFilesByExtension(dir, extensions) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFilesByExtension(absolutePath, extensions));
            continue;
        }

        if (entry.isFile() && extensions.some((extension) => absolutePath.endsWith(extension))) {
            files.push(absolutePath);
        }
    }

    return files;
}

/**
 * @function offsetToLineNumber
 * @description 将字符偏移转换为 1-based 行号。
 * @param content 文件内容。
 * @param offset 字符偏移。
 * @returns 行号。
 */
function offsetToLineNumber(content, offset) {
    return content.slice(0, offset).split(/\r?\n/).length;
}

/**
 * @function shouldIgnoreLine
 * @description 判断当前违规是否被上一行 ignore 注释显式豁免。
 * @param lines 文件行数组。
 * @param line 1-based 行号。
 * @returns 是否忽略。
 */
function shouldIgnoreLine(lines, line) {
    return (lines[line - 2] ?? "").includes("i18n-guard-ignore-next-line");
}

/**
 * @function maskCommentsPreserveOffsets
 * @description 将源码中的注释替换为空白字符，保留换行和偏移，避免误报同时不破坏行号定位。
 * @param content 原始源码。
 * @returns 去注释但保留偏移结构的源码。
 */
function maskCommentsPreserveOffsets(content) {
    return content
        .replace(/\/\*[\s\S]*?\*\//g, (segment) => segment.replace(/[^\n]/g, " "))
        .replace(/\/\/.*$/gm, (segment) => segment.replace(/[^\n]/g, " "));
}

/**
 * @function checkSourceFile
 * @description 校验单个源文件中的 i18n 违规项。
 * @param filePath 文件绝对路径。
 * @returns 违规项数组。
 */
function checkSourceFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const maskedContent = maskCommentsPreserveOffsets(content);
    const lines = content.split(/\r?\n/);
    const violations = [];

    const addResourceBundleMatches = Array.from(maskedContent.matchAll(/\bi18n\.addResourceBundle\s*\(/g));
    for (const match of addResourceBundleMatches) {
        const line = offsetToLineNumber(content, match.index ?? 0);
        if (shouldIgnoreLine(lines, line)) {
            continue;
        }

        violations.push({
            line,
            value: "i18n.addResourceBundle",
            text: "禁止在功能模块内动态注入文案，请改为维护在 src/i18n/locales/*.ts 与共享 UI 语言层。",
        });
    }

    if (!filePath.endsWith(".tsx")) {
        return violations;
    }

    const textAttributeMatches = Array.from(maskedContent.matchAll(textAttributePattern));
    for (const match of textAttributeMatches) {
        const line = offsetToLineNumber(content, match.index ?? 0);
        if (shouldIgnoreLine(lines, line)) {
            continue;
        }

        violations.push({
            line,
            value: match[0],
            text: "禁止直接写 UI 属性字面量，请改为使用 i18n key 或共享 UI 语言 key。",
        });
    }

    const jsxLiteralMatches = Array.from(maskedContent.matchAll(jsxLiteralTextPattern));
    for (const match of jsxLiteralMatches) {
        const rawText = (match[1] ?? "").trim();
        if (!rawText) {
            continue;
        }

        const line = offsetToLineNumber(content, match.index ?? 0);
        if (shouldIgnoreLine(lines, line)) {
            continue;
        }

        violations.push({
            line,
            value: rawText,
            text: "禁止直接写 JSX 文本字面量，请改为使用 i18n key 或共享 UI 语言 key。",
        });
    }

    return violations;
}

const sourceFiles = walkFilesByExtension(srcRoot, [".ts", ".tsx"]);
const allViolations = [];

for (const sourceFile of sourceFiles) {
    const violations = checkSourceFile(sourceFile);
    if (violations.length > 0) {
        allViolations.push({ filePath: sourceFile, violations });
    }
}

if (allViolations.length > 0) {
    console.error("[i18n-guard] 检测到未纳入统一文案系统的文本：\n");

    for (const fileIssue of allViolations) {
        const relativeFilePath = path.relative(workspaceRoot, fileIssue.filePath);
        console.error(`- ${relativeFilePath}`);
        for (const violation of fileIssue.violations) {
            console.error(`  L${violation.line}: ${violation.value} -> ${violation.text}`);
        }
        console.error("");
    }

    console.error("[i18n-guard] 请将文案收敛到 src/i18n/locales/*.ts 或 src/i18n/uiLanguage.ts；若确需例外，可在上一行添加 i18n-guard-ignore-next-line 注释。");
    process.exit(1);
}

console.info(`[i18n-guard] passed (${sourceFiles.length} source files checked)`);