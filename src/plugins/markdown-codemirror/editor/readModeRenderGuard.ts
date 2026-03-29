/**
 * @module plugins/markdown-codemirror/editor/readModeRenderGuard
 * @description 阅读态渲染 guard：检测当前 Markdown 是否使用了阅读态尚未对齐的增强渲染特性，并在切换前阻止不一致渲染。
 * @dependencies
 *  - ../../../utils/markdownBlockDetector
 *  - ./renderParityContract
 */

import { detectExcludedLineRanges, isLineExcluded } from "../../../utils/markdownBlockDetector";
import {
    getReadModeUnsupportedFeatures,
    type EditorRenderFeature,
} from "./renderParityContract";

const IMAGE_EMBED_PATTERN = /!\[\[([^\]\n]+?)\]\]/g;
const HIGHLIGHT_INLINE_PATTERN = /(==)(?=\S)(.+?)(?<=\S)\1/g;
const TAG_PATTERN = /(^|[\s([{])(#(?!\s)[\p{L}\p{N}_-]+)/gu;
const INLINE_LATEX_PATTERN = /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g;

/**
 * @interface ReadModeRenderGuardResult
 * @description 阅读态 guard 检测结果。
 */
export interface ReadModeRenderGuardResult {
    /** 当前文档是否允许切换到阅读态。 */
    canRenderReadMode: boolean;
    /** 当前文档命中的阅读态未对齐特性。 */
    unsupportedFeatures: EditorRenderFeature[];
}

/**
 * @function evaluateReadModeRenderGuard
 * @description 评估当前 Markdown 在阅读态下是否满足渲染一致性契约。
 * @param markdown 当前 Markdown 文本。
 * @returns 阅读态 guard 结果。
 */
export function evaluateReadModeRenderGuard(
    markdown: string,
): ReadModeRenderGuardResult {
    const usedFeatures = detectUsedEnhancedRenderFeatures(markdown);
    const unsupportedFeatureSet = new Set(getReadModeUnsupportedFeatures());
    const unsupportedFeatures = usedFeatures.filter((feature) => unsupportedFeatureSet.has(feature));

    return {
        canRenderReadMode: unsupportedFeatures.length === 0,
        unsupportedFeatures,
    };
}

/**
 * @function detectUsedEnhancedRenderFeatures
 * @description 检测 Markdown 中使用到的增强渲染特性。
 * @param markdown 当前 Markdown 文本。
 * @returns 命中的增强渲染特性列表。
 */
export function detectUsedEnhancedRenderFeatures(markdown: string): EditorRenderFeature[] {
    const ranges = detectExcludedLineRanges(markdown);
    const features = new Set<EditorRenderFeature>();
    const lines = markdown.split("\n");

    ranges.forEach((range) => {
        if (range.type === "frontmatter") {
            features.add("frontmatter");
        }
        if (range.type === "latex-block") {
            features.add("latex-block");
        }
    });

    lines.forEach((lineText, index) => {
        const lineNumber = index + 1;
        if (isLineExcluded(lineNumber, ranges)) {
            return;
        }

        if (IMAGE_EMBED_PATTERN.test(lineText)) {
            features.add("image-embed");
        }
        IMAGE_EMBED_PATTERN.lastIndex = 0;

        if (HIGHLIGHT_INLINE_PATTERN.test(lineText)) {
            features.add("inline-highlight");
        }
        HIGHLIGHT_INLINE_PATTERN.lastIndex = 0;

        if (TAG_PATTERN.test(lineText)) {
            features.add("inline-tag");
        }
        TAG_PATTERN.lastIndex = 0;

        if (INLINE_LATEX_PATTERN.test(lineText)) {
            features.add("latex-inline");
        }
        INLINE_LATEX_PATTERN.lastIndex = 0;
    });

    return Array.from(features);
}