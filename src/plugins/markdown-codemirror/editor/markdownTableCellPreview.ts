/**
 * @module plugins/markdown-codemirror/editor/markdownTableCellPreview
 * @description Markdown 表格单元格预览预处理：复用阅读态增强语法转换，并处理表格内转义管道符。
 * @dependencies
 *  - ./markdownReadTransform
 */

import { transformMarkdownForReadMode } from "./markdownReadTransform";

const ESCAPED_TABLE_PIPE_PATTERN = /\\\|/g;

/**
 * @function normalizeMarkdownTableCellPreviewSource
 * @description 将表格源码中用于保列的转义管道符恢复为单元格内容。
 * @param value 单元格源码文本。
 * @returns 用于预览渲染的 Markdown 文本。
 */
export function normalizeMarkdownTableCellPreviewSource(value: string): string {
    return value.replace(ESCAPED_TABLE_PIPE_PATTERN, "|");
}

/**
 * @function prepareMarkdownTableCellPreviewMarkdown
 * @description 将单元格 Markdown 转换为 ReactMarkdown 可消费的增强预览 Markdown。
 * @param value 单元格源码文本。
 * @returns 预览 Markdown。
 */
export function prepareMarkdownTableCellPreviewMarkdown(value: string): string {
    return transformMarkdownForReadMode(normalizeMarkdownTableCellPreviewSource(value));
}
