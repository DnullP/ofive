/**
 * @module plugins/markdown-codemirror/editor/MarkdownReadView
 * @description 编辑器阅读态视图：使用独立 Markdown 渲染器呈现文档结果，并复用 WikiLink 跳转能力。
 * @dependencies
 *  - react
 *  - react-markdown
 *  - remark-gfm
 *  - remark-breaks
 *  - ./markdownReadTransform
 *  - ./syntaxPlugins/wikiLinkSyntaxRenderer
 *
 * @example
 *   <MarkdownReadView content={markdown} currentFilePath={path} containerApi={api} />
 */

import { useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import type { DockviewApi } from "dockview";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { openWikiLinkTarget } from "./syntaxPlugins/wikiLinkSyntaxRenderer";
import {
    decodeReadModeWikiLinkHref,
    transformMarkdownForReadMode,
} from "./markdownReadTransform";
import { shouldSkipWikiLinkNavigationForSelection } from "./readModeSelectionPolicy";

interface MarkdownReadViewProps {
    /** 阅读态 Markdown 正文。 */
    content: string;
    /** 当前文件相对路径。 */
    currentFilePath: string;
    /** Dockview 容器 API。 */
    containerApi: DockviewApi;
}

/**
 * @function MarkdownReadView
 * @description 渲染阅读态 Markdown 内容，并为 WikiLink 提供点击跳转。
 * @param props 组件参数。
 * @returns React 节点。
 */
export function MarkdownReadView(props: MarkdownReadViewProps): ReactNode {
    const renderedMarkdown = useMemo(
        () => transformMarkdownForReadMode(props.content),
        [props.content],
    );

    const renderInlineCode = (
        componentProps: ComponentPropsWithoutRef<"code">,
    ): ReactNode => {
        const { className, children, ...restProps } = componentProps;

        return (
            <code className={`cm-rendered-inline-code ${className ?? ""}`.trim()} {...restProps}>
                {children}
            </code>
        );
    };

    return (
        <div className="cm-tab-reader">
            <div className="cm-tab-reader-content">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                        h1: ({ node: _node, ...componentProps }) => <h1 className="cm-rendered-header cm-rendered-header-h1" {...componentProps} />,
                        h2: ({ node: _node, ...componentProps }) => <h2 className="cm-rendered-header cm-rendered-header-h2" {...componentProps} />,
                        h3: ({ node: _node, ...componentProps }) => <h3 className="cm-rendered-header cm-rendered-header-h3" {...componentProps} />,
                        h4: ({ node: _node, ...componentProps }) => <h4 className="cm-rendered-header cm-rendered-header-h4" {...componentProps} />,
                        h5: ({ node: _node, ...componentProps }) => <h5 className="cm-rendered-header cm-rendered-header-h5" {...componentProps} />,
                        h6: ({ node: _node, ...componentProps }) => <h6 className="cm-rendered-header cm-rendered-header-h6" {...componentProps} />,
                        strong: ({ node: _node, ...componentProps }) => <strong className="cm-rendered-bold" {...componentProps} />,
                        em: ({ node: _node, ...componentProps }) => <em className="cm-rendered-italic" {...componentProps} />,
                        del: ({ node: _node, ...componentProps }) => <del className="cm-rendered-strikethrough" {...componentProps} />,
                        blockquote: ({ node: _node, ...componentProps }) => <blockquote className="cm-rendered-blockquote" {...componentProps} />,
                        hr: ({ node: _node, ...componentProps }) => <hr className="cm-rendered-horizontal-rule" {...componentProps} />,
                        code: ({ node: _node, className, children, ...componentProps }: ComponentPropsWithoutRef<"code"> & { node?: unknown }) => {
                            const isInline = !String(className ?? "").includes("language-");
                            if (isInline) {
                                return renderInlineCode({
                                    className,
                                    children,
                                    ...componentProps,
                                });
                            }

                            return (
                                <code className={`cm-tab-reader-code ${className ?? ""}`.trim()} {...componentProps}>
                                    {children}
                                </code>
                            );
                        },
                        pre: ({ node: _node, ...componentProps }) => <pre className="cm-tab-reader-pre" {...componentProps} />,
                        ul: ({ node: _node, ...componentProps }) => <ul className="cm-tab-reader-list cm-tab-reader-list-unordered" {...componentProps} />,
                        ol: ({ node: _node, ...componentProps }) => <ol className="cm-tab-reader-list cm-tab-reader-list-ordered" {...componentProps} />,
                        li: ({ node: _node, className, ...componentProps }) => (
                            <li
                                className={className
                                    ? `cm-tab-reader-list-item ${className}`
                                    : "cm-tab-reader-list-item"}
                                {...componentProps}
                            />
                        ),
                        a: ({ node: _node, href, children, ...componentProps }) => {
                            const wikiLinkTarget = decodeReadModeWikiLinkHref(href);
                            if (wikiLinkTarget) {
                                return (
                                    <a
                                        {...componentProps}
                                        href={href}
                                        className="cm-rendered-wikilink"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            if (shouldSkipWikiLinkNavigationForSelection(
                                                window.getSelection(),
                                                event.currentTarget,
                                            )) {
                                                return;
                                            }
                                            void openWikiLinkTarget(
                                                props.containerApi,
                                                () => props.currentFilePath,
                                                wikiLinkTarget,
                                            );
                                        }}
                                    >
                                        {children}
                                    </a>
                                );
                            }

                            return (
                                <a
                                    {...componentProps}
                                    href={href}
                                    className="cm-rendered-link"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    {children}
                                </a>
                            );
                        },
                    }}
                >
                    {renderedMarkdown}
                </ReactMarkdown>
            </div>
        </div>
    );
}