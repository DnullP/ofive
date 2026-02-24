/**
 * @file scripts/check-theme-colors.mjs
 * @description 主题色守卫：在构建前检查 src 下 CSS 是否出现硬编码颜色，强制走主题变量。
 *
 * 规则：
 * - 仅允许 `src/App.css` 声明颜色字面量（主题 token 定义处）。
 * - 其余 src 下的 CSS 文件一旦出现颜色字面量（hex/rgb/hsl/white/black）即报错。
 * - src 下 TSX 的 style={{...}} 内禁止直接写颜色字面量。
 * - 禁止直接引入 `@codemirror/theme-one-dark`。
 * - 禁止在统一适配文件外直接使用 `EditorView.theme(...)`。
 * - 支持单行忽略：在目标行上一行添加 `theme-guard-ignore-next-line` 注释。
 */

import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const srcRoot = path.join(workspaceRoot, "src");
const cssAllowList = new Set([path.join(srcRoot, "App.css")]);
const colorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|(?:^|[\s:(,])(white|black)(?=$|[\s);,])/g;
const inlineStyleBlockPattern = /style=\{\{[\s\S]*?\}\}/g;
const inlineStyleColorPattern = /\b(?:color|background|backgroundColor|borderColor|outlineColor|fill|stroke|textDecorationColor|boxShadow)\s*:\s*(['"`])(?:#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|white|black)\1/g;
const codemirrorThemeAdapterAllowList = new Set([
    path.join(srcRoot, "layout", "editor", "codemirrorTheme.ts"),
]);

/**
 * @function walkCssFiles
 * @description 递归收集目录下全部 CSS 文件。
 * @param dir 目录绝对路径。
 * @returns CSS 文件绝对路径数组。
 */
function walkCssFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkCssFiles(absolutePath));
            continue;
        }

        if (entry.isFile() && absolutePath.endsWith(".css")) {
            files.push(absolutePath);
        }
    }

    return files;
}

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
 * @function stripInlineCssComments
 * @description 去除单行中的 CSS 块注释片段，减少误报。
 * @param line 原始行文本。
 * @returns 去注释后的文本。
 */
function stripInlineCssComments(line) {
    return line.replace(/\/\*.*?\*\//g, "");
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
 * @function checkFile
 * @description 校验单个 CSS 文件中是否存在违规颜色字面量。
 * @param filePath 文件绝对路径。
 * @returns 违规项数组。
 */
function checkFile(filePath) {
    if (cssAllowList.has(filePath)) {
        return [];
    }

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const violations = [];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const previousLine = lines[index - 1] ?? "";

        if (previousLine.includes("theme-guard-ignore-next-line")) {
            continue;
        }

        const scannedLine = stripInlineCssComments(line);
        colorPattern.lastIndex = 0;
        const matched = colorPattern.exec(scannedLine);
        if (!matched) {
            continue;
        }

        violations.push({
            line: index + 1,
            value: matched[0],
            text: scannedLine.trim(),
        });
    }

    return violations;
}

/**
 * @function checkTsxFileInlineStyle
 * @description 校验 TSX style={{...}} 中是否出现硬编码颜色字面量。
 * @param filePath 文件绝对路径。
 * @returns 违规项数组。
 */
function checkTsxFileInlineStyle(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    const violations = [];

    inlineStyleBlockPattern.lastIndex = 0;
    let styleBlockMatch = inlineStyleBlockPattern.exec(content);

    while (styleBlockMatch) {
        const styleBlockText = styleBlockMatch[0] ?? "";
        const styleBlockOffset = styleBlockMatch.index ?? 0;
        const styleStartLine = offsetToLineNumber(content, styleBlockOffset);
        const previousLine = lines[styleStartLine - 2] ?? "";

        if (!previousLine.includes("theme-guard-ignore-next-line")) {
            inlineStyleColorPattern.lastIndex = 0;
            const colorMatch = inlineStyleColorPattern.exec(styleBlockText);
            if (colorMatch) {
                const violationOffset = styleBlockOffset + (colorMatch.index ?? 0);
                const line = offsetToLineNumber(content, violationOffset);

                violations.push({
                    line,
                    value: colorMatch[0],
                    text: styleBlockText.split(/\r?\n/)[0]?.trim() ?? "style={{...}}",
                });
            }
        }

        styleBlockMatch = inlineStyleBlockPattern.exec(content);
    }

    return violations;
}

/**
 * @function checkCodeMirrorThemeUsage
 * @description 校验 TS/TSX 是否绕过统一 CodeMirror 主题接入层。
 * @param filePath 文件绝对路径。
 * @returns 违规项数组。
 */
function checkCodeMirrorThemeUsage(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const violations = [];

    const importOneDarkMatch = content.match(/@codemirror\/theme-one-dark|\boneDark\b/);
    if (importOneDarkMatch) {
        const line = offsetToLineNumber(content, importOneDarkMatch.index ?? 0);
        violations.push({
            line,
            value: importOneDarkMatch[0],
            text: "禁止直接使用固定暗色主题，请改为统一主题适配模块。",
        });
    }

    if (!codemirrorThemeAdapterAllowList.has(filePath)) {
        const directThemeMatch = content.match(/EditorView\.theme\s*\(/);
        if (directThemeMatch) {
            const line = offsetToLineNumber(content, directThemeMatch.index ?? 0);
            violations.push({
                line,
                value: directThemeMatch[0],
                text: "禁止直接定义 EditorView.theme，请使用 layout/editor/codemirrorTheme.ts。",
            });
        }
    }

    return violations;
}

const cssFiles = walkCssFiles(srcRoot);
const tsxFiles = walkFilesByExtension(srcRoot, [".tsx"]);
const sourceFiles = walkFilesByExtension(srcRoot, [".ts", ".tsx"]);
const allViolations = [];

for (const cssFile of cssFiles) {
    const violations = checkFile(cssFile);
    if (violations.length > 0) {
        allViolations.push({ filePath: cssFile, violations });
    }
}

for (const tsxFile of tsxFiles) {
    const violations = checkTsxFileInlineStyle(tsxFile);
    if (violations.length > 0) {
        allViolations.push({ filePath: tsxFile, violations });
    }
}

for (const sourceFile of sourceFiles) {
    const violations = checkCodeMirrorThemeUsage(sourceFile);
    if (violations.length > 0) {
        allViolations.push({ filePath: sourceFile, violations });
    }
}

if (allViolations.length > 0) {
    console.error("[theme-guard] 检测到未接入主题系统的颜色字面量：\n");

    for (const fileIssue of allViolations) {
        const relativeFilePath = path.relative(workspaceRoot, fileIssue.filePath);
        console.error(`- ${relativeFilePath}`);
        for (const violation of fileIssue.violations) {
            console.error(
                `  L${violation.line}: ${violation.value} -> ${violation.text}`,
            );
        }
        console.error("");
    }

    console.error("[theme-guard] 请改为使用 var(--token)。若确需例外，可在上一行添加 theme-guard-ignore-next-line 注释。");
    process.exit(1);
}

console.info(`[theme-guard] passed (${cssFiles.length} css + ${tsxFiles.length} tsx + ${sourceFiles.length} source files checked)`);
