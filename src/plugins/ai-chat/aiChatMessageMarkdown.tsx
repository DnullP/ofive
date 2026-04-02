/**
 * @module plugins/ai-chat/aiChatMessageMarkdown
 * @description AI 聊天气泡 Markdown 渲染组件：负责将消息正文以只读 Markdown 形式输出，支持常见 GFM 语法、换行、代码块与安全外链。
 * @dependencies
 *   - react
 *   - react-markdown
 *   - remark-gfm
 *   - remark-breaks
 *
 * @example
 *   <AiChatMessageMarkdown content="**summary**\n- item" role="assistant" />
 *
 * @exports
 *   - AiChatMessageMarkdown
 */

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";

interface AiChatMessageMarkdownProps {
    /** 原始 Markdown 文本。 */
    content: string;
    /** 推理阶段的原始纯文本。 */
    reasoningContent?: string;
    /** 是否仍处于流式输出阶段。 */
    streaming?: boolean;
    /** 消息角色，用于辅助样式区分。 */
    role: "assistant" | "user";
}

/**
 * @function AiChatMessageMarkdown
 * @description 将聊天消息内容渲染为安全的 Markdown 视图。
 * @param props 消息 Markdown 渲染参数。
 * @returns 消息正文 React 节点。
 */
export function AiChatMessageMarkdown(
    props: AiChatMessageMarkdownProps,
): ReactNode {
    const { t } = useTranslation();
    const normalizedContent = props.content.trim();
    const normalizedReasoningContent = (props.reasoningContent ?? "").trim();
    const shouldKeepReasoningExpanded = !normalizedContent;

    const renderInlineCode = (
        componentProps: ComponentPropsWithoutRef<"code">,
    ): ReactNode => {
        const { className, children, ...restProps } = componentProps;

        return (
            <code
                className={[
                    "ai-chat-message-inline-code",
                    className ?? "",
                ].join(" ").trim()}
                {...restProps}
            >
                {children}
            </code>
        );
    };

    if (!normalizedContent) {
        if (normalizedReasoningContent) {
            return (
                <div className="ai-chat-message-markdown ai-chat-message-markdown-reasoning-only">
                    <details className="ai-chat-message-reasoning-panel" open>
                        <summary className="ai-chat-message-reasoning-summary">{t("aiChatPlugin.reasoningSummary")}</summary>
                        <pre className="ai-chat-message-reasoning">{normalizedReasoningContent}</pre>
                    </details>
                </div>
            );
        }

        return <span className="ai-chat-message-placeholder">...</span>;
    }

    return (
        <div
            className={[
                "ai-chat-message-markdown",
                props.streaming ? "ai-chat-message-markdown-streaming" : "",
                `ai-chat-message-markdown-${props.role}`,
            ].join(" ")}
        >
            {normalizedReasoningContent ? (
                <details
                    className="ai-chat-message-reasoning-panel"
                    open={shouldKeepReasoningExpanded}
                >
                    <summary className="ai-chat-message-reasoning-summary">{t("aiChatPlugin.reasoningSummary")}</summary>
                    <pre className="ai-chat-message-reasoning">{normalizedReasoningContent}</pre>
                </details>
            ) : null}
            {props.streaming ? (
                <div className="ai-chat-message-streaming-text">{props.content}</div>
            ) : (
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                    p: ({ node: _node, ...componentProps }) => (
                        <p className="ai-chat-message-paragraph" {...componentProps} />
                    ),
                    h1: ({ node: _node, ...componentProps }) => (
                        <h1 className="ai-chat-message-heading ai-chat-message-heading-h1" {...componentProps} />
                    ),
                    h2: ({ node: _node, ...componentProps }) => (
                        <h2 className="ai-chat-message-heading ai-chat-message-heading-h2" {...componentProps} />
                    ),
                    h3: ({ node: _node, ...componentProps }) => (
                        <h3 className="ai-chat-message-heading ai-chat-message-heading-h3" {...componentProps} />
                    ),
                    h4: ({ node: _node, ...componentProps }) => (
                        <h4 className="ai-chat-message-heading ai-chat-message-heading-h4" {...componentProps} />
                    ),
                    h5: ({ node: _node, ...componentProps }) => (
                        <h5 className="ai-chat-message-heading ai-chat-message-heading-h5" {...componentProps} />
                    ),
                    h6: ({ node: _node, ...componentProps }) => (
                        <h6 className="ai-chat-message-heading ai-chat-message-heading-h6" {...componentProps} />
                    ),
                    ul: ({ node: _node, ...componentProps }) => (
                        <ul className="ai-chat-message-list ai-chat-message-list-unordered" {...componentProps} />
                    ),
                    ol: ({ node: _node, ...componentProps }) => (
                        <ol className="ai-chat-message-list ai-chat-message-list-ordered" {...componentProps} />
                    ),
                    li: ({ node: _node, ...componentProps }) => (
                        <li className="ai-chat-message-list-item" {...componentProps} />
                    ),
                    blockquote: ({ node: _node, ...componentProps }) => (
                        <blockquote className="ai-chat-message-blockquote" {...componentProps} />
                    ),
                    a: ({ node: _node, ...componentProps }) => (
                        <a
                            className="ai-chat-message-link"
                            target="_blank"
                            rel="noreferrer"
                            {...componentProps}
                        />
                    ),
                    code: ({
                        node: _node,
                        className,
                        children,
                        ...componentProps
                    }: ComponentPropsWithoutRef<"code"> & { node?: unknown }) => {
                        const isInline = !String(className ?? "").includes("language-");
                        if (isInline) {
                            return renderInlineCode({
                                className,
                                children,
                                ...componentProps,
                            });
                        }

                        return (
                            <code
                                className={[
                                    "ai-chat-message-code-block",
                                    className ?? "",
                                ].join(" ").trim()}
                                {...componentProps}
                            >
                                {children}
                            </code>
                        );
                    },
                    pre: ({ node: _node, ...componentProps }) => (
                        <pre className="ai-chat-message-pre" {...componentProps} />
                    ),
                    hr: ({ node: _node, ...componentProps }) => (
                        <hr className="ai-chat-message-rule" {...componentProps} />
                    ),
                }}
            >
                {normalizedContent}
            </ReactMarkdown>
            )}
        </div>
    );
}