/**
 * @module plugins/canvas/CanvasMarkdown
 * @description Canvas 文本节点的 Markdown 展示组件。
 *   该模块负责：
 *   - 将文本节点中的 Markdown 内容渲染为只读 React 视图
 *   - 支持常用 GFM 语法与单换行显示
 *   - 在内容为空时返回占位文本
 *
 * @dependencies
 *   - react
 *   - react-markdown
 *   - remark-gfm
 *   - remark-breaks
 *
 * @example
 *   <CanvasMarkdown content={node.data.text} placeholder={t("canvas.emptyTextNode")} />
 */

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

interface CanvasMarkdownProps {
    /** 原始 Markdown 内容。 */
    content?: string;
    /** 内容为空时显示的占位文本。 */
    placeholder: string;
}

/**
 * @function CanvasMarkdown
 * @description 将文本节点内容渲染为 Markdown 视图。
 * @param props Markdown 渲染属性。
 * @returns Markdown 内容或占位文本。
 */
export function CanvasMarkdown(props: CanvasMarkdownProps): ReactNode {
    const normalizedContent = props.content?.trim() ?? "";

    if (!normalizedContent) {
        return (
            <div className="canvas-tab__markdown canvas-tab__markdown--placeholder">
                {props.placeholder}
            </div>
        );
    }

    return (
        <div className="canvas-tab__markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                {props.content ?? ""}
            </ReactMarkdown>
        </div>
    );
}