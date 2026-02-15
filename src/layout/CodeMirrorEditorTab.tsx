/**
 * @module layout/CodeMirrorEditorTab
 * @description 基于 CodeMirror 6 的编辑器 Tab 组件，用于在 Dockview 中承载可编辑文本内容。
 * @dependencies
 *  - react
 *  - dockview
 *  - codemirror
 *  - @codemirror/lang-markdown
 *  - @codemirror/theme-one-dark
 */

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { IDockviewPanelProps } from "dockview";
import { EditorView } from "codemirror";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup } from "codemirror";
import "./CodeMirrorEditorTab.css";

/**
 * @constant HEADER_PATTERN
 * @description Markdown 标题匹配规则，支持 1-6 级标题。
 */
const HEADER_PATTERN = /^(#{1,6})\s+(.+)$/;

/**
 * @constant BOLD_INLINE_PATTERN
 * @description Markdown 粗体匹配规则，支持 **text** 与 __text__。
 */
const BOLD_INLINE_PATTERN = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;

/**
 * @constant ITALIC_STAR_INLINE_PATTERN
 * @description Markdown 斜体匹配规则，支持 *text*（排除 **bold**）。
 */
const ITALIC_STAR_INLINE_PATTERN = /(?<!\*)\*(?=\S)(.+?)(?<=\S)\*(?!\*)/g;

/**
 * @constant ITALIC_UNDERSCORE_INLINE_PATTERN
 * @description Markdown 斜体匹配规则，支持 _text_（排除 __bold__）。
 */
const ITALIC_UNDERSCORE_INLINE_PATTERN = /(?<!_)_(?=\S)(.+?)(?<=\S)_(?!_)/g;

/**
 * @constant STRIKETHROUGH_INLINE_PATTERN
 * @description Markdown 删除线匹配规则，支持 ~~text~~。
 */
const STRIKETHROUGH_INLINE_PATTERN = /(~~)(?=\S)(.+?)(?<=\S)\1/g;

/**
 * @constant INLINE_CODE_PATTERN
 * @description Markdown 行内代码匹配规则，支持 `code`。
 */
const INLINE_CODE_PATTERN = /(`)([^`\n]+?)\1/g;

/**
 * @constant WIKI_LINK_PATTERN
 * @description Wiki Link 匹配规则，支持 [[Page Name]]。
 */
const WIKI_LINK_PATTERN = /(\[\[)([^\]\n]+?)(\]\])/g;

/**
 * @function rangeIntersectsSelection
 * @description 判断某个范围是否与当前选择或光标重合。
 * @param state 编辑器状态。
 * @param from 范围起始偏移。
 * @param to 范围结束偏移。
 * @returns 若与选择/光标重合返回 true。
 */
function rangeIntersectsSelection(state: EditorState, from: number, to: number): boolean {
    return state.selection.ranges.some((range) => {
        if (range.empty) {
            return range.from >= from && range.from <= to;
        }
        return range.from <= to && range.to >= from;
    });
}

/**
 * @function addInlineTokenDecoration
 * @description 为行内 token 添加渲染装饰：光标不在 token 内时隐藏标记并应用内容样式。
 * @param builder 装饰构建器。
 * @param lineFrom 当前行起始偏移。
 * @param matchIndex token 在当前行中的起始位置。
 * @param fullText token 完整文本。
 * @param leftMarkerLength 左侧标记长度。
 * @param rightMarkerLength 右侧标记长度。
 * @param contentClass 渲染内容样式类名。
 * @param view 编辑器视图。
 */
function addInlineTokenDecoration(
    builder: RangeSetBuilder<Decoration>,
    lineFrom: number,
    matchIndex: number,
    fullText: string,
    leftMarkerLength: number,
    rightMarkerLength: number,
    contentClass: string,
    view: EditorView,
): void {
    if (matchIndex < 0 || fullText.length <= leftMarkerLength + rightMarkerLength) {
        return;
    }

    const tokenFrom = lineFrom + matchIndex;
    const tokenTo = tokenFrom + fullText.length;
    const contentFrom = tokenFrom + leftMarkerLength;
    const contentTo = tokenTo - rightMarkerLength;
    const isEditingToken = view.hasFocus && rangeIntersectsSelection(view.state, tokenFrom, tokenTo);

    if (isEditingToken) {
        return;
    }

    const markerDecoration = Decoration.mark({
        class: "cm-inline-marker-hidden",
    });
    const contentDecoration = Decoration.mark({
        class: contentClass,
    });

    if (contentFrom > tokenFrom) {
        builder.add(tokenFrom, contentFrom, markerDecoration);
    }
    if (contentTo > contentFrom) {
        builder.add(contentFrom, contentTo, contentDecoration);
    }
    if (tokenTo > contentTo) {
        builder.add(contentTo, tokenTo, markerDecoration);
    }
}

/**
 * @function buildHeaderDecorations
 * @description 为标题构建 WYSIWYG 装饰：非光标行渲染为标题，光标进入时恢复源码。
 * @param view CodeMirror 视图实例。
 * @returns 标题装饰集合。
 */
function buildHeaderDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const activeLineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;

    for (const visibleRange of view.visibleRanges) {
        let currentLine = view.state.doc.lineAt(visibleRange.from);
        const endLineNumber = view.state.doc.lineAt(visibleRange.to).number;

        while (currentLine.number <= endLineNumber) {
            const lineText = currentLine.text;
            const match = lineText.match(HEADER_PATTERN);
            const isEditingCurrentLine = view.hasFocus && currentLine.number === activeLineNumber;

            if (match && !isEditingCurrentLine) {
                const hashes = match[1] ?? "#";
                const level = Math.min(6, Math.max(1, hashes.length));
                const markerLength = hashes.length + 1;
                const markerEnd = Math.min(currentLine.to, currentLine.from + markerLength);

                const markerDecoration = Decoration.mark({
                    class: "cm-header-marker-hidden",
                });
                const headerDecoration = Decoration.mark({
                    class: `cm-rendered-header cm-rendered-header-h${String(level)}`,
                });

                if (markerEnd > currentLine.from) {
                    builder.add(currentLine.from, markerEnd, markerDecoration);
                }
                if (currentLine.to > markerEnd) {
                    builder.add(markerEnd, currentLine.to, headerDecoration);
                }
            }

            const boldMatches = Array.from(lineText.matchAll(BOLD_INLINE_PATTERN));
            for (const match of boldMatches) {
                const fullText = match[0] ?? "";
                const delimiter = match[1] ?? "**";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    builder,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-bold",
                    view,
                );
            }

            const italicStarMatches = Array.from(lineText.matchAll(ITALIC_STAR_INLINE_PATTERN));
            for (const match of italicStarMatches) {
                const fullText = match[0] ?? "";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    builder,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    1,
                    1,
                    "cm-rendered-italic",
                    view,
                );
            }

            const italicUnderscoreMatches = Array.from(lineText.matchAll(ITALIC_UNDERSCORE_INLINE_PATTERN));
            for (const match of italicUnderscoreMatches) {
                const fullText = match[0] ?? "";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    builder,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    1,
                    1,
                    "cm-rendered-italic",
                    view,
                );
            }

            const strikethroughMatches = Array.from(lineText.matchAll(STRIKETHROUGH_INLINE_PATTERN));
            for (const match of strikethroughMatches) {
                const fullText = match[0] ?? "";
                const delimiter = match[1] ?? "~~";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    builder,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-strikethrough",
                    view,
                );
            }

            const inlineCodeMatches = Array.from(lineText.matchAll(INLINE_CODE_PATTERN));
            for (const match of inlineCodeMatches) {
                const fullText = match[0] ?? "";
                const delimiter = match[1] ?? "`";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    builder,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-inline-code",
                    view,
                );
            }

            const wikiLinkMatches = Array.from(lineText.matchAll(WIKI_LINK_PATTERN));
            for (const match of wikiLinkMatches) {
                const fullText = match[0] ?? "";
                const leftDelimiter = match[1] ?? "[[";
                const rightDelimiter = match[3] ?? "]]";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    builder,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    leftDelimiter.length,
                    rightDelimiter.length,
                    "cm-rendered-wikilink",
                    view,
                );
            }

            if (currentLine.number === endLineNumber) {
                break;
            }
            currentLine = view.state.doc.line(currentLine.number + 1);
        }
    }

    return builder.finish();
}

/**
 * @constant headerWysiwygExtension
 * @description 标题所见即所得扩展：离开光标渲染、进入光标还原源码。
 */
const headerWysiwygExtension = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildHeaderDecorations(view);
        }

        update(update: ViewUpdate): void {
            if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
                this.decorations = buildHeaderDecorations(update.view);
            }
        }
    },
    {
        decorations: (plugin) => plugin.decorations,
    },
);

/**
 * @function buildDefaultContent
 * @description 根据文件路径构建默认内容。
 * @param filePath 文件路径。
 * @returns 编辑器默认文本。
 */
function buildDefaultContent(filePath: string): string {
    return `# ${filePath.split("/").pop() ?? filePath}\n\n> 这是基于 CodeMirror 6 的编辑器示例内容。\n\n- 支持基础编辑\n- 支持 Markdown 语法高亮\n- 支持后续扩展语言和 LSP`;
}

/**
 * @function CodeMirrorEditorTab
 * @description Dockview Tab 渲染函数，挂载并管理 CodeMirror 实例生命周期。
 * @param props Dockview 面板参数，支持 params.path 与 params.content。
 * @returns 编辑器 Tab 视图。
 */
export function CodeMirrorEditorTab(props: IDockviewPanelProps<Record<string, unknown>>): ReactNode {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);

    const filePath = String(props.params.path ?? "未命名.md");
    const initialDoc = useMemo(() => {
        const content = props.params.content;
        if (typeof content === "string" && content.length > 0) {
            return content;
        }
        return buildDefaultContent(filePath);
    }, [props.params.content, filePath]);

    useEffect(() => {
        if (!hostRef.current || viewRef.current) {
            return;
        }

        const state = EditorState.create({
            doc: initialDoc,
            extensions: [
                basicSetup,
                markdown(),
                oneDark,
                EditorView.lineWrapping,
                headerWysiwygExtension,
                EditorView.theme({
                    "&": { height: "100%" },
                }),
            ],
        });

        viewRef.current = new EditorView({
            state,
            parent: hostRef.current,
        });

        return () => {
            viewRef.current?.destroy();
            viewRef.current = null;
        };
    }, [initialDoc]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        const currentDoc = view.state.doc.toString();
        if (currentDoc === initialDoc) {
            return;
        }

        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: initialDoc,
            },
        });
    }, [initialDoc]);

    return (
        <div className="cm-tab">
            <div className="cm-tab-header">{filePath}</div>
            <div ref={hostRef} className="cm-tab-editor" />
        </div>
    );
}
