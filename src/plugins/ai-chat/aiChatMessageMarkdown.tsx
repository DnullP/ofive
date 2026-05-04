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
import { decodeReadModeWikiLinkHref } from "../markdown-codemirror/editor/markdownReadTransform";
import { parseWikiLinkParts } from "../markdown-codemirror/editor/syntaxPlugins/wikiLinkParser";

const WIKILINK_PATTERN = /(!)?\[\[([^\]\n]+?)\]\]/g;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;

function escapeMarkdownLinkText(text: string): string {
    return text
        .replace(/\\/g, "\\\\")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");
}

function transformWikiLinksInMarkdown(markdown: string): string {
    const lines = markdown.split("\n");
    let insideFence = false;
    let fenceMarker: string | null = null;

    return lines.map((line) => {
        const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
        if (fenceMatch) {
            const marker = fenceMatch[2] ?? "";
            if (!insideFence) {
                insideFence = true;
                fenceMarker = marker[0] ?? null;
            } else if ((fenceMarker && marker[0] === fenceMarker) || marker.startsWith(fenceMarker ?? "")) {
                insideFence = false;
                fenceMarker = null;
            }
            return line;
        }

        if (insideFence) {
            return line;
        }

        const placeholders: string[] = [];
        const protectedLine = line.replace(INLINE_CODE_PATTERN, (segment) => {
            const token = `@@AI_CHAT_WIKILINK_CODE_${String(placeholders.length)}@@`;
            placeholders.push(segment);
            return token;
        });

        const transformedLine = protectedLine.replace(
            WIKILINK_PATTERN,
            (fullMatch, imagePrefix: string | undefined, rawTarget: string) => {
                if (imagePrefix === "!") {
                    return fullMatch;
                }

                const parsed = parseWikiLinkParts((rawTarget ?? "").trim());
                if (!parsed) {
                    return fullMatch;
                }

                return `[${escapeMarkdownLinkText(parsed.displayText)}](/__ofive_wikilink__/${encodeURIComponent(parsed.target)})`;
            },
        );

        return placeholders.reduce(
            (currentLine, segment, index) => currentLine.replace(`@@AI_CHAT_WIKILINK_CODE_${String(index)}@@`, segment),
            transformedLine,
        );
    }).join("\n");
}

interface AiChatMessageMarkdownProps {
    /** 原始 Markdown 文本。 */
    content: string;
    /** 推理阶段的原始纯文本。 */
    reasoningContent?: string;
    /** 是否仍处于流式输出阶段。 */
    streaming?: boolean;
    /** 消息角色，用于辅助样式区分。 */
    role: "assistant" | "user";
    /** 点击 WikiLink 时由宿主执行打开逻辑。 */
    onOpenWikiLinkTarget?: (target: string) => void;
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
    const renderedContent = transformWikiLinksInMarkdown(normalizedContent);

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
                        (() => {
                            const href = typeof componentProps.href === "string" ? componentProps.href : undefined;
                            const wikiLinkTarget = decodeReadModeWikiLinkHref(href);
                            if (wikiLinkTarget) {
                                return (
                                    <a
                                        {...componentProps}
                                        className="ai-chat-message-link ai-chat-message-wikilink cm-rendered-wikilink"
                                        title={wikiLinkTarget}
                                        href={href}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            props.onOpenWikiLinkTarget?.(wikiLinkTarget);
                                        }}
                                    />
                                );
                            }

                            return (
                                <a
                                    {...componentProps}
                                    className="ai-chat-message-link"
                                    target="_blank"
                                    rel="noreferrer"
                                />
                            );
                        })()
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
                {renderedContent}
            </ReactMarkdown>
            )}
        </div>
    );
}
