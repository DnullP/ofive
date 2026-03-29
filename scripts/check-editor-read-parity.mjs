/**
 * @file scripts/check-editor-read-parity.mjs
 * @description 编辑态/阅读态一致性守卫：约束增强渲染特性必须登记到统一契约，并同步接入阅读态 guard 检测。
 *
 * 规则：
 * - 编辑态的增强渲染特性必须在 renderParityContract.ts 中登记。
 * - 每个登记特性都必须在 readModeRenderGuard.ts 中具备检测入口。
 * - 若未来阅读态补齐某项特性，允许继续保留在契约中，但不可绕过契约与 guard。
 */

import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const editorRoot = path.join(workspaceRoot, "src", "plugins", "markdown-codemirror", "editor");
const contractFilePath = path.join(editorRoot, "renderParityContract.ts");
const guardFilePath = path.join(editorRoot, "readModeRenderGuard.ts");

const FEATURE_SPECS = [
    {
        id: "frontmatter",
        label: "frontmatter syntax extension",
        sourceFilePath: path.join(editorRoot, "syntaxPlugins", "frontmatterSyntaxExtension.ts"),
        sourcePatterns: [/createFrontmatterSyntaxExtension/],
        guardPatterns: [/"frontmatter"/],
    },
    {
        id: "image-embed",
        label: "image embed syntax extension",
        sourceFilePath: path.join(editorRoot, "syntaxPlugins", "imageEmbedSyntaxExtension.ts"),
        sourcePatterns: [/createImageEmbedSyntaxExtension/, /IMAGE_EMBED_PATTERN/],
        guardPatterns: [/"image-embed"/, /IMAGE_EMBED_PATTERN/],
    },
    {
        id: "inline-highlight",
        label: "highlight syntax renderer",
        sourceFilePath: path.join(editorRoot, "syntaxPlugins", "highlightSyntaxRenderer.ts"),
        sourcePatterns: [/registerHighlightSyntaxRenderer/, /HIGHLIGHT_INLINE_PATTERN/],
        guardPatterns: [/"inline-highlight"/, /HIGHLIGHT_INLINE_PATTERN/],
    },
    {
        id: "inline-tag",
        label: "tag syntax renderer",
        sourceFilePath: path.join(editorRoot, "syntaxPlugins", "tagSyntaxRenderer.ts"),
        sourcePatterns: [/registerTagSyntaxRenderer/, /TAG_PATTERN/],
        guardPatterns: [/"inline-tag"/, /TAG_PATTERN/],
    },
    {
        id: "latex-inline",
        label: "latex syntax extension (inline)",
        sourceFilePath: path.join(editorRoot, "syntaxPlugins", "latexSyntaxExtension.ts"),
        sourcePatterns: [/createLatexSyntaxExtension/, /INLINE_LATEX_PATTERN/],
        guardPatterns: [/"latex-inline"/, /INLINE_LATEX_PATTERN/],
    },
    {
        id: "latex-block",
        label: "latex syntax extension (block)",
        sourceFilePath: path.join(editorRoot, "syntaxPlugins", "latexSyntaxExtension.ts"),
        sourcePatterns: [/createLatexSyntaxExtension/, /BLOCK_LATEX_OPEN_PATTERN/, /"latex-block"/],
        guardPatterns: [/"latex-block"/],
    },
];

/**
 * @function readFile
 * @description 读取 UTF-8 文本文件。
 * @param filePath 文件绝对路径。
 * @returns 文件内容。
 */
function readFile(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

/**
 * @function assertPatterns
 * @description 判断文件内容是否包含全部指定模式。
 * @param content 文件内容。
 * @param patterns 正则模式数组。
 * @returns 是否全部命中。
 */
function assertPatterns(content, patterns) {
    return patterns.every((pattern) => pattern.test(content));
}

const contractContent = readFile(contractFilePath);
const guardContent = readFile(guardFilePath);
const violations = [];

for (const featureSpec of FEATURE_SPECS) {
    const sourceContent = readFile(featureSpec.sourceFilePath);
    const isSourceFeaturePresent = assertPatterns(sourceContent, featureSpec.sourcePatterns);
    if (!isSourceFeaturePresent) {
        violations.push(
            `${path.relative(workspaceRoot, featureSpec.sourceFilePath)}: expected ${featureSpec.label} markers for feature \"${featureSpec.id}\" were not found.`,
        );
        continue;
    }

    if (!contractContent.includes(`id: "${featureSpec.id}"`)) {
        violations.push(
            `${path.relative(workspaceRoot, contractFilePath)}: missing contract descriptor for feature \"${featureSpec.id}\" (${featureSpec.label}).`,
        );
    }

    if (!assertPatterns(guardContent, featureSpec.guardPatterns)) {
        violations.push(
            `${path.relative(workspaceRoot, guardFilePath)}: missing guard detection coverage for feature \"${featureSpec.id}\" (${featureSpec.label}).`,
        );
    }
}

if (violations.length > 0) {
    console.error("[editor-read-parity-guard] failed: detected render parity contract drift.\n");
    for (const violation of violations) {
        console.error(`- ${violation}`);
    }
    console.error("\n[editor-read-parity-guard] update renderParityContract.ts and readModeRenderGuard.ts together whenever edit-mode enhanced rendering changes.");
    process.exit(1);
}

console.info(`[editor-read-parity-guard] passed (${FEATURE_SPECS.length} enhanced render features checked)`);