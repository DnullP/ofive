/**
 * @module plugins/markdown-codemirror/editor/MarkdownReadView
 * @description 编辑器阅读态视图：渲染 Markdown 正文，并在阅读态补齐
 *   Frontmatter、图片嵌入、Tag、Highlight、LaTeX 等增强特性。
 * @dependencies
 *  - react
 *  - react-markdown
 *  - remark-gfm
 *  - remark-breaks
 *  - katex
 *  - ../../../../api/vaultApi
 *  - ./markdownReadTransform
 *  - ./pathUtils
 *  - ./syntaxPlugins/wikiLinkSyntaxRenderer
 *
 * @example
 *   <MarkdownReadView content={markdown} currentFilePath={path} containerApi={api} />
 */

import {
    useEffect,
    useMemo,
    useState,
    type ComponentPropsWithoutRef,
    type ReactNode,
} from "react";
import type { DockviewApi } from "dockview";
import katex from "katex";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import i18n from "../../../i18n";
import {
    readVaultBinaryFile,
    resolveMediaEmbedTarget,
} from "../../../api/vaultApi";
import { resolveParentDirectory } from "./pathUtils";
import { openWikiLinkTarget } from "./syntaxPlugins/wikiLinkSyntaxRenderer";
import {
    decodeReadModeBlockLatexHref,
    decodeReadModeHighlightHref,
    decodeReadModeInlineLatexHref,
    decodeReadModeMediaEmbedHref,
    decodeReadModeTagHref,
    decodeReadModeWikiLinkHref,
    prepareMarkdownForReadMode,
    type ReadModeFrontmatterField,
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
    const preparedMarkdown = useMemo(
        () => prepareMarkdownForReadMode(props.content),
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
                {preparedMarkdown.hasFrontmatter ? (
                    <ReadModeFrontmatterPanel frontmatter={preparedMarkdown.frontmatter} />
                ) : null}
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={{
                        p: ({ node, children, ...componentProps }) => {
                            const blockLatexSource = extractBlockLatexFromParagraph(node);
                            if (blockLatexSource) {
                                return <ReadModeLatex latex={blockLatexSource} displayMode />;
                            }

                            return <p {...componentProps}>{children}</p>;
                        },
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
                        img: ({ node: _node, src, alt, ...componentProps }) => {
                            const mediaTarget = decodeReadModeMediaEmbedHref(src);
                            if (mediaTarget) {
                                return (
                                    <ReadModeImageEmbed
                                        alt={alt ?? mediaTarget}
                                        currentFilePath={props.currentFilePath}
                                        rawTarget={mediaTarget}
                                    />
                                );
                            }

                            return (
                                <img
                                    {...componentProps}
                                    alt={alt ?? ""}
                                    className="cm-tab-reader-image"
                                    src={src}
                                />
                            );
                        },
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

                            if (decodeReadModeHighlightHref(href) !== null) {
                                return (
                                    <mark className="cm-rendered-highlight">
                                        {children}
                                    </mark>
                                );
                            }

                            if (decodeReadModeTagHref(href) !== null) {
                                return (
                                    <span className="cm-rendered-tag">
                                        {children}
                                    </span>
                                );
                            }

                            const inlineLatexSource = decodeReadModeInlineLatexHref(href);
                            if (inlineLatexSource !== null) {
                                return <ReadModeLatex latex={inlineLatexSource} displayMode={false} />;
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
                    {preparedMarkdown.renderedMarkdown}
                </ReactMarkdown>
            </div>
        </div>
    );
}

interface ReadModeFrontmatterPanelProps {
    /** 阅读态 frontmatter 字段列表。 */
    frontmatter: ReadModeFrontmatterField[];
}

/**
 * @function ReadModeFrontmatterPanel
 * @description 在阅读态顶部渲染结构化 frontmatter 面板。
 * @param props 面板参数。
 * @returns frontmatter 面板。
 */
function ReadModeFrontmatterPanel(props: ReadModeFrontmatterPanelProps): ReactNode {
    return (
        <section className="cm-read-frontmatter-panel">
            <div className="cm-read-frontmatter-title">{i18n.t("frontmatter.readModeTitle")}</div>
            {props.frontmatter.length > 0 ? (
                <dl className="cm-read-frontmatter-list">
                    {props.frontmatter.map((field) => (
                        <div className="cm-read-frontmatter-row" key={field.key}>
                            <dt className="cm-read-frontmatter-key">{field.key}</dt>
                            <dd className="cm-read-frontmatter-value">{field.value}</dd>
                        </div>
                    ))}
                </dl>
            ) : (
                <div className="cm-read-frontmatter-empty">{i18n.t("frontmatter.emptyFrontmatter")}</div>
            )}
        </section>
    );
}

interface ReadModeImageEmbedProps {
    /** 图片嵌入原始目标。 */
    rawTarget: string;
    /** 当前文档路径。 */
    currentFilePath: string;
    /** 图片 alt 文本。 */
    alt: string;
}

type ReadModeImageState =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; source: string; label: string };

/**
 * @function ReadModeImageEmbed
 * @description 在阅读态中解析并渲染 `![[...]]` 图片嵌入。
 * @param props 图片嵌入参数。
 * @returns 图片嵌入节点。
 */
function ReadModeImageEmbed(props: ReadModeImageEmbedProps): ReactNode {
    const [imageState, setImageState] = useState<ReadModeImageState>({ status: "loading" });

    useEffect(() => {
        let isDisposed = false;
        const currentDirectory = resolveParentDirectory(props.currentFilePath);

        setImageState({ status: "loading" });
        console.info("[markdown-read-view] image embed resolve start", {
            currentDirectory,
            target: props.rawTarget,
        });

        void resolveMediaEmbedTarget(currentDirectory, props.rawTarget)
            .then(async (resolvedTarget) => {
                if (isDisposed) {
                    return;
                }

                if (!resolvedTarget) {
                    console.warn("[markdown-read-view] image embed resolve returned empty", {
                        currentDirectory,
                        target: props.rawTarget,
                    });
                    setImageState({
                        status: "error",
                        message: i18n.t("image.notFound"),
                    });
                    return;
                }

                const binaryResponse = await readVaultBinaryFile(resolvedTarget.relativePath);
                if (!binaryResponse.mimeType.startsWith("image/")) {
                    console.warn("[markdown-read-view] image embed mime unsupported", {
                        mimeType: binaryResponse.mimeType,
                        relativePath: resolvedTarget.relativePath,
                    });
                    setImageState({
                        status: "error",
                        message: i18n.t("image.unsupportedType", { type: binaryResponse.mimeType }),
                    });
                    return;
                }

                setImageState({
                    status: "ready",
                    source: `data:${binaryResponse.mimeType};base64,${binaryResponse.base64Content}`,
                    label: resolvedTarget.relativePath.split("/").pop() ?? resolvedTarget.relativePath,
                });
            })
            .catch((error) => {
                if (isDisposed) {
                    return;
                }

                console.warn("[markdown-read-view] image embed render failed", {
                    message: error instanceof Error ? error.message : String(error),
                    target: props.rawTarget,
                });
                setImageState({
                    status: "error",
                    message: i18n.t("image.loadError", { src: props.rawTarget }),
                });
            });

        return () => {
            isDisposed = true;
        };
    }, [props.currentFilePath, props.rawTarget]);

    if (imageState.status === "ready") {
        return (
            <span className="cm-image-embed-widget">
                <img
                    alt={props.alt}
                    className="cm-image-embed-image"
                    src={imageState.source}
                />
                <span className="cm-image-embed-caption">{imageState.label}</span>
            </span>
        );
    }

    return (
        <span className="cm-image-embed-widget">
            <span className={imageState.status === "loading" ? "cm-image-embed-loading" : "cm-image-embed-error"}>
                {imageState.status === "loading"
                    ? i18n.t("image.loading", { src: props.rawTarget })
                    : imageState.message}
            </span>
        </span>
    );
}

interface ReadModeLatexProps {
    /** LaTeX 公式源码。 */
    latex: string;
    /** 是否以 display 模式渲染。 */
    displayMode: boolean;
}

interface ReadModeLatexRenderResult {
    /** 渲染后的 HTML。 */
    html: string;
    /** 是否渲染失败。 */
    isError: boolean;
}

const readModeLatexCache = new Map<string, ReadModeLatexRenderResult>();

/**
 * @function ReadModeLatex
 * @description 在阅读态中使用 KaTeX 渲染行内或块级数学公式。
 * @param props LaTeX 参数。
 * @returns 数学公式节点。
 */
function ReadModeLatex(props: ReadModeLatexProps): ReactNode {
    const renderResult = useMemo(
        () => renderReadModeLatex(props.latex, props.displayMode),
        [props.displayMode, props.latex],
    );

    if (props.displayMode) {
        return (
            <div
                className={renderResult.isError
                    ? "cm-latex-block-widget cm-latex-block-error"
                    : "cm-latex-block-widget"}
                dangerouslySetInnerHTML={{ __html: renderResult.html }}
            />
        );
    }

    return (
        <span
            className={renderResult.isError
                ? "cm-latex-inline-widget cm-latex-inline-error"
                : "cm-latex-inline-widget"}
            dangerouslySetInnerHTML={{ __html: renderResult.html }}
        />
    );
}

/**
 * @function renderReadModeLatex
 * @description 将 LaTeX 公式缓存并渲染为 HTML。
 * @param latex LaTeX 公式源码。
 * @param displayMode 是否为 display 模式。
 * @returns 渲染结果。
 */
function renderReadModeLatex(latex: string, displayMode: boolean): ReadModeLatexRenderResult {
    const cacheKey = `${displayMode ? "block" : "inline"}::${latex}`;
    const cachedResult = readModeLatexCache.get(cacheKey);
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
        readModeLatexCache.set(cacheKey, renderResult);
        return renderResult;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const renderResult = {
            html: `<span class="cm-latex-error" title="${escapeHtml(errorMessage)}">${escapeHtml(latex)}</span>`,
            isError: true,
        };
        readModeLatexCache.set(cacheKey, renderResult);
        return renderResult;
    }
}

/**
 * @function extractBlockLatexFromParagraph
 * @description 从 React Markdown 段落节点中提取块级 LaTeX 协议链接。
 * @param node 段落节点。
 * @returns 若该段落仅承载块级 LaTeX 协议，则返回 LaTeX 源码。
 */
function extractBlockLatexFromParagraph(node: unknown): string | null {
    if (!node || typeof node !== "object") {
        return null;
    }

    const children = (node as { children?: Array<{ type?: string; tagName?: string; properties?: { href?: string } }> }).children;
    if (!children || children.length !== 1) {
        return null;
    }

    const firstChild = children[0];
    if (firstChild?.type !== "element" || firstChild.tagName !== "a") {
        return null;
    }

    return decodeReadModeBlockLatexHref(firstChild.properties?.href);
}

/**
 * @function escapeHtml
 * @description 转义 HTML 特殊字符，避免错误信息和源码注入 DOM。
 * @param text 原始文本。
 * @returns 转义后的文本。
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}