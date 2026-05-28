/**
 * @module plugins/markdown-codemirror/editor/components/MarkdownTableCellLatex
 * @description Markdown 表格单元格内的 LaTeX 预览渲染。
 */

import { useMemo, type ReactNode } from "react";
import katex from "katex";

interface TableCellLatexProps {
    /** LaTeX 公式源码。 */
    latex: string;
    /** 是否按 display 模式排版。 */
    displayMode: boolean;
}

interface TableCellLatexRenderResult {
    /** KaTeX 渲染后的 HTML。 */
    html: string;
    /** 是否渲染失败。 */
    isError: boolean;
}

const tableCellLatexCache = new Map<string, TableCellLatexRenderResult>();

function renderTableCellLatex(latex: string, displayMode: boolean): TableCellLatexRenderResult {
    const cacheKey = `${displayMode ? "block" : "inline"}::${latex}`;
    const cachedResult = tableCellLatexCache.get(cacheKey);
    if (cachedResult) {
        return cachedResult;
    }

    try {
        const html = katex.renderToString(latex, {
            displayMode,
            throwOnError: false,
            strict: false,
            trust: false,
            output: "htmlAndMathml",
        });
        const renderResult = { html, isError: false };
        tableCellLatexCache.set(cacheKey, renderResult);
        return renderResult;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const renderResult = {
            // i18n-guard-ignore-next-line -- KaTeX provides the dynamic diagnostic text.
            html: `<span class="cm-latex-error" title="${escapeHtml(errorMessage)}">${escapeHtml(latex)}</span>`,
            isError: true,
        };
        tableCellLatexCache.set(cacheKey, renderResult);
        return renderResult;
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * @function TableCellLatex
 * @description 在表格单元格预览中渲染 LaTeX。
 * @param props 公式参数。
 * @returns 公式节点。
 */
export function TableCellLatex(props: TableCellLatexProps): ReactNode {
    const renderResult = useMemo(
        () => renderTableCellLatex(props.latex, props.displayMode),
        [props.displayMode, props.latex],
    );

    return (
        <span
            className={[
                props.displayMode ? "mtv-cell-latex-display" : "cm-latex-inline-widget",
                renderResult.isError ? "cm-latex-inline-error" : "",
            ].filter(Boolean).join(" ")}
            dangerouslySetInnerHTML={{ __html: renderResult.html }}
        />
    );
}
