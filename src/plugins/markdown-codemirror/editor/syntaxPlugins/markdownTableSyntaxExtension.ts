/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/markdownTableSyntaxExtension
 * @description Markdown 表格块语法扩展：将 GFM 风格表格渲染为可视化编辑 widget。
 * @dependencies
 *  - @codemirror/state
 *  - @codemirror/view
 *  - react
 *  - react-dom/client
 *  - ../markdownTableModel
 *  - ../components/MarkdownTableVisualEditor
 *  - ./blockWidgetReplace
 *  - ../syntaxExclusionZones
 */

import { RangeSet, RangeSetBuilder } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DockviewApi } from "dockview";
import i18n from "../../../../i18n";
import { MarkdownTableVisualEditor } from "../components/MarkdownTableVisualEditor";
import {
    parseMarkdownTableLines,
    serializeMarkdownTable,
    type MarkdownTableModel,
} from "../markdownTableModel";
import {
    type BlockSelectionRange,
    hiddenBlockAnchorLineDecoration,
    hiddenBlockLineDecoration,
    rangeTouchesBlock,
} from "./blockWidgetReplace";
import {
    isRangeInsideHigherPriorityZone,
    setExclusionZones,
} from "../syntaxExclusionZones";

/**
 * @interface MarkdownTableBlock
 * @description Markdown 表格块信息。
 */
interface MarkdownTableBlock {
    /** 区块起始偏移。 */
    from: number;
    /** 区块结束偏移（开区间）。 */
    to: number;
    /** 起始行号（1-based）。 */
    startLineNumber: number;
    /** 结束行号（1-based）。 */
    endLineNumber: number;
    /** 结构化表格模型。 */
    model: MarkdownTableModel;
}

/**
 * @function shouldKeepMarkdownTableSourceVisible
 * @description 当底层选区仍停留在表格源码范围里时，保留源码显示，
 *   避免 widget 替换后 selection 指向不可映射位置。
 * @param block 表格块。
 * @param ranges 当前选区集合。
 * @returns 若应回退源码显示，返回 true。
 */
export function shouldKeepMarkdownTableSourceVisible(
    block: Pick<MarkdownTableBlock, "from" | "to">,
    ranges: readonly BlockSelectionRange[],
): boolean {
    return rangeTouchesBlock(block, ranges);
}

/** 表格原子范围标记。 */
const markdownTableAtomicMarker = Decoration.mark({});

/**
 * @function isViewAlive
 * @description 判断视图是否仍然挂载。
 * @param view 编辑器视图。
 * @returns 若视图仍挂载则返回 true。
 */
function isViewAlive(view: EditorView): boolean {
    return view.dom.isConnected;
}

/**
 * @function resolveTableCandidateLines
 * @description 从起始行号向下收集连续表格候选行。
 * @param state 编辑器状态。
 * @param startLineNumber 起始行号。
 * @returns 表格候选行数组。
 */
function resolveTableCandidateLines(
    state: EditorState,
    startLineNumber: number,
): string[] {
    const headerLine = state.doc.line(startLineNumber);
    const separatorLine = state.doc.line(startLineNumber + 1);
    const lines = [headerLine.text, separatorLine.text];

    for (let lineNumber = startLineNumber + 2; lineNumber <= state.doc.lines; lineNumber += 1) {
        const line = state.doc.line(lineNumber);
        if (line.text.trim().length === 0 || !line.text.includes("|")) {
            break;
        }
        lines.push(line.text);
    }

    return lines;
}

/**
 * @function parseMarkdownTableBlocks
 * @description 从文档中解析全部 Markdown 表格块。
 * @param view 编辑器视图。
 * @returns 表格块数组。
 */
function parseMarkdownTableBlocks(view: EditorView): MarkdownTableBlock[] {
    const blocks: MarkdownTableBlock[] = [];
    let lineNumber = 1;

    while (lineNumber < view.state.doc.lines) {
        const line = view.state.doc.line(lineNumber);
        if (!line.text.includes("|")) {
            lineNumber += 1;
            continue;
        }

        if (isRangeInsideHigherPriorityZone(view, line.from, line.to, "markdown-table")) {
            lineNumber += 1;
            continue;
        }

        const candidateLines = resolveTableCandidateLines(view.state, lineNumber);
        const model = parseMarkdownTableLines(candidateLines);
        if (!model) {
            lineNumber += 1;
            continue;
        }

        const endLineNumber = lineNumber + candidateLines.length - 1;
        const endLine = view.state.doc.line(endLineNumber);
        if (isRangeInsideHigherPriorityZone(view, line.from, endLine.to, "markdown-table")) {
            lineNumber += 1;
            continue;
        }

        blocks.push({
            from: line.from,
            to: endLine.to,
            startLineNumber: lineNumber,
            endLineNumber,
            model,
        });
        lineNumber = endLineNumber + 1;
    }

    return blocks;
}

/**
 * @function saveMarkdownTable
 * @description 将表格 markdown 写回当前块。
 * @param view 编辑器视图。
 * @param expectedFrom 预期起始偏移。
 * @param markdownText 表格 markdown 文本。
 * @returns 保存结果。
 */
function saveMarkdownTable(
    view: EditorView,
    expectedFrom: number,
    markdownText: string,
): { success: boolean; message: string } {
    if (!isViewAlive(view)) {
        console.warn("[markdown-table-syntax-extension] save skipped: view disconnected");
        return {
            success: false,
            message: i18n.t("markdownTable.editorClosed"),
        };
    }

    const liveBlock = parseMarkdownTableBlocks(view).find((block) => block.from === expectedFrom);
    if (!liveBlock) {
        console.warn("[markdown-table-syntax-extension] save skipped: block missing", {
            expectedFrom,
        });
        return {
            success: false,
            message: i18n.t("markdownTable.blockMissing"),
        };
    }

    view.dispatch({
        changes: {
            from: liveBlock.from,
            to: liveBlock.to,
            insert: markdownText,
        },
    });

    console.info("[markdown-table-syntax-extension] table synced", {
        from: liveBlock.from,
        to: liveBlock.to,
        bytes: markdownText.length,
    });

    return {
        success: true,
        message: i18n.t("markdownTable.synced"),
    };
}

/**
 * @class MarkdownTableWidget
 * @description Markdown 表格 widget：将表格块挂接为可视化 React 编辑组件。
 */
class MarkdownTableWidget extends WidgetType {
    /** 表格块起始偏移。 */
    private readonly blockFrom: number;

    /** 表格模型。 */
    private readonly model: MarkdownTableModel;

    /** React 根实例。 */
    private root: Root | null = null;

    constructor(
        blockFrom: number,
        model: MarkdownTableModel,
        private readonly view: EditorView,
        private readonly containerApi: DockviewApi,
        private readonly getCurrentFilePath: () => string,
    ) {
        super();
        this.blockFrom = blockFrom;
        this.model = model;
    }

    eq(other: MarkdownTableWidget): boolean {
        return this.blockFrom === other.blockFrom && serializeMarkdownTable(this.model) === serializeMarkdownTable(other.model);
    }

    toDOM(): HTMLElement {
        const wrapper = document.createElement("section");
        wrapper.className = "cm-markdown-table-widget";

        try {
            this.root = createRoot(wrapper);
            this.root.render(
                createElement(MarkdownTableVisualEditor, {
                    initialModel: this.model,
                    onCommitMarkdown: (markdownText: string) => saveMarkdownTable(this.view, this.blockFrom, markdownText),
                    containerApi: this.containerApi,
                    currentFilePath: this.getCurrentFilePath(),
                }),
            );
        } catch (error) {
            console.error("[markdown-table-syntax-extension] widget render failed", {
                message: error instanceof Error ? error.message : String(error),
            });
            wrapper.textContent = "Markdown table render error";
        }

        return wrapper;
    }

    destroy(): void {
        const root = this.root;
        if (root !== null) {
            queueMicrotask(() => {
                try {
                    root.unmount();
                } catch (error) {
                    console.warn("[markdown-table-syntax-extension] widget unmount failed", {
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            });
        }
        this.root = null;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

/**
 * @function createMarkdownTableSyntaxExtension
 * @description 创建 Markdown 表格可视化编辑扩展。
 * @returns CodeMirror Extension。
 */
export function createMarkdownTableSyntaxExtension(
    containerApi: DockviewApi,
    getCurrentFilePath: () => string,
): Extension {
    const plugin = ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            blocks: MarkdownTableBlock[];

            constructor(view: EditorView) {
                this.blocks = [];
                this.decorations = this.safeBuildDecorations(view);
            }

            update(update: ViewUpdate): void {
                if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
                    this.decorations = this.safeBuildDecorations(update.view);
                }
            }

            private safeBuildDecorations(view: EditorView): DecorationSet {
                try {
                    return this.buildDecorations(view);
                } catch (error) {
                    console.error("[markdown-table-syntax-extension] build decorations failed", {
                        message: error instanceof Error ? error.message : String(error),
                    });
                    this.blocks = [];
                    setExclusionZones(view, "markdown-table", []);
                    return new RangeSetBuilder<Decoration>().finish();
                }
            }

            private buildDecorations(view: EditorView): DecorationSet {
                const builder = new RangeSetBuilder<Decoration>();
                if (!isViewAlive(view)) {
                    this.blocks = [];
                    return builder.finish();
                }

                const blocks = parseMarkdownTableBlocks(view);
                this.blocks = blocks;
                setExclusionZones(view, "markdown-table", blocks.map((block) => ({ from: block.from, to: block.to })));

                blocks.forEach((block) => {
                    if (shouldKeepMarkdownTableSourceVisible(block, view.state.selection.ranges)) {
                        return;
                    }

                    for (let lineNumber = block.startLineNumber; lineNumber < block.endLineNumber; lineNumber += 1) {
                        const line = view.state.doc.line(lineNumber);
                        builder.add(line.from, line.from, hiddenBlockLineDecoration);
                    }

                    const anchorLine = view.state.doc.line(block.endLineNumber);
                    builder.add(anchorLine.from, anchorLine.from, hiddenBlockAnchorLineDecoration);
                    builder.add(
                        block.to,
                        block.to,
                        Decoration.widget({
                            widget: new MarkdownTableWidget(
                                block.from,
                                block.model,
                                view,
                                containerApi,
                                getCurrentFilePath,
                            ),
                            side: -1,
                            block: false,
                        }),
                    );
                });

                return builder.finish();
            }
        },
        {
            decorations: (instance) => instance.decorations,
        },
    );

    const atomicRanges = EditorView.atomicRanges.of((view) => {
        const pluginValue = view.plugin(plugin);
        if (!pluginValue || pluginValue.blocks.length === 0) {
            return RangeSet.empty;
        }

        return RangeSet.of(
            pluginValue.blocks
                .filter((block) => !shouldKeepMarkdownTableSourceVisible(block, view.state.selection.ranges))
                .map((block) => markdownTableAtomicMarker.range(block.from, block.to)),
        );
    });

    return [plugin, atomicRanges];
}