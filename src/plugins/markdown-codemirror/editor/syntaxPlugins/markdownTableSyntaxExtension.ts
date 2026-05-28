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

import { RangeSet, RangeSetBuilder, StateField } from "@codemirror/state";
import type { EditorState, Extension, Text, Transaction } from "@codemirror/state";
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
import type { WorkbenchContainerApi } from "../../../../host/layout/workbenchContracts";
import i18n from "../../../../i18n";
import { detectExcludedLineRanges } from "../../../../utils/markdownBlockDetector";
import { MarkdownTableVisualEditor } from "../components/MarkdownTableVisualEditor";
import {
    parseMarkdownTableLayoutComment,
    parseMarkdownTableLines,
    serializeMarkdownTableWithLayout,
    type MarkdownTableLayout,
    type MarkdownTableModel,
} from "../markdownTableModel";
import { estimateMarkdownTableWidgetHeight as estimateMarkdownTableWidgetHeightFromModel } from "../markdownTableRowHeightEstimate";
import { MarkdownTableWheelForwarder } from "../markdownTableWheelForwarding";
import {
    type BlockSelectionRange,
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
    /** 表格布局元数据。 */
    layout: MarkdownTableLayout | null;
}

interface MarkdownTableSyntaxExtensionOptions {
    onRequestFocusVimNavigation?: (request: {
        blockFrom: number;
        position: "first" | "last";
    }) => void;
}

interface MarkdownTablePriorityExclusionRange {
    from: number;
    to: number;
}

interface MarkdownTableSyntaxState {
    blocks: MarkdownTableBlock[];
    decorations: DecorationSet;
}

export { resolveMarkdownTableEditorWheelDeltaY } from "../markdownTableWheelForwarding";

/**
 * @function estimateMarkdownTableWidgetHeight
 * @description 为 CodeMirror 的离屏高度图提供 Markdown 表格 widget 的保守高度估算。
 *   大型表格在 React 内容真正挂载前不能被估成一行高，否则滚动到该区域时
 *   CodeMirror 会在测量后大幅修正 scrollTop，表现为漂移或瞬移。
 */
export function estimateMarkdownTableWidgetHeight(
    model: Pick<MarkdownTableModel, "rows">,
    layout: MarkdownTableLayout | null | undefined,
): number {
    return estimateMarkdownTableWidgetHeightFromModel(
        model,
        layout?.columnWidths,
        layout?.rowHeights,
    );
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

function rangeIntersectsMarkdownTablePriorityExclusion(
    ranges: readonly MarkdownTablePriorityExclusionRange[],
    from: number,
    to: number,
): boolean {
    return ranges.some((range) => from <= range.to && to >= range.from);
}

function resolveMarkdownTablePriorityExclusionRanges(doc: Text): MarkdownTablePriorityExclusionRange[] {
    return detectExcludedLineRanges(doc.toString())
        .filter((range) => range.type === "frontmatter" || range.type === "code-fence" || range.type === "latex-block")
        .map((range) => ({
            from: doc.line(range.fromLine).from,
            to: doc.line(range.toLine).to,
        }));
}

/**
 * @function parseMarkdownTableBlocksFromState
 * @description 从编辑器状态中解析全部 Markdown 表格块。
 * @param state 编辑器状态。
 * @param isRangeExcluded 额外排斥区判断。
 * @returns 表格块数组。
 */
function parseMarkdownTableBlocksFromState(
    state: EditorState,
    isRangeExcluded: (from: number, to: number) => boolean = () => false,
): MarkdownTableBlock[] {
    const blocks: MarkdownTableBlock[] = [];
    const priorityExclusionRanges = resolveMarkdownTablePriorityExclusionRanges(state.doc);
    let lineNumber = 1;

    while (lineNumber < state.doc.lines) {
        const line = state.doc.line(lineNumber);
        if (!line.text.includes("|")) {
            lineNumber += 1;
            continue;
        }

        if (
            rangeIntersectsMarkdownTablePriorityExclusion(priorityExclusionRanges, line.from, line.to)
            || isRangeExcluded(line.from, line.to)
        ) {
            lineNumber += 1;
            continue;
        }

        const candidateLines = resolveTableCandidateLines(state, lineNumber);
        const model = parseMarkdownTableLines(candidateLines);
        if (!model) {
            lineNumber += 1;
            continue;
        }

        const tableEndLineNumber = lineNumber + candidateLines.length - 1;
        let blockEndLineNumber = tableEndLineNumber;
        let layout: MarkdownTableLayout | null = null;
        if (tableEndLineNumber < state.doc.lines) {
            const possibleLayoutLine = state.doc.line(tableEndLineNumber + 1);
            layout = parseMarkdownTableLayoutComment(possibleLayoutLine.text);
            if (layout) {
                blockEndLineNumber = tableEndLineNumber + 1;
            }
        }

        const blockEndLine = state.doc.line(blockEndLineNumber);
        if (
            rangeIntersectsMarkdownTablePriorityExclusion(priorityExclusionRanges, line.from, blockEndLine.to)
            || isRangeExcluded(line.from, blockEndLine.to)
        ) {
            lineNumber += 1;
            continue;
        }

        blocks.push({
            from: line.from,
            to: blockEndLine.to,
            startLineNumber: lineNumber,
            endLineNumber: blockEndLineNumber,
            model,
            layout,
        });
        lineNumber = blockEndLineNumber + 1;
    }

    return blocks;
}

/**
 * @function parseMarkdownTableBlocks
 * @description 从当前编辑器视图解析全部 Markdown 表格块。
 * @param view 编辑器视图。
 * @returns 表格块数组。
 */
function parseMarkdownTableBlocks(view: EditorView): MarkdownTableBlock[] {
    return parseMarkdownTableBlocksFromState(
        view.state,
        (from, to) => isRangeInsideHigherPriorityZone(view, from, to, "markdown-table"),
    );
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

function exitMarkdownTableVimNavigation(
    view: EditorView,
    expectedFrom: number,
    direction: "previous" | "next",
): void {
    if (!isViewAlive(view)) {
        return;
    }

    const liveBlock = parseMarkdownTableBlocks(view).find((block) => block.from === expectedFrom);
    if (!liveBlock) {
        return;
    }

    const anchor = direction === "previous"
        ? (liveBlock.startLineNumber > 1
            ? view.state.doc.line(liveBlock.startLineNumber - 1).from
            : 0)
        : (liveBlock.endLineNumber < view.state.doc.lines
            ? view.state.doc.line(liveBlock.endLineNumber + 1).from
            : liveBlock.to);

    view.dispatch({
        selection: { anchor },
        scrollIntoView: true,
    });
    view.focus();
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

    /** 表格布局元数据。 */
    private readonly layout: MarkdownTableLayout | null;

    /** React 根实例。 */
    private root: Root | null = null;

    private wheelEventListener: ((event: WheelEvent) => void) | null = null;

    private wheelForwarder: MarkdownTableWheelForwarder | null = null;

    constructor(
        blockFrom: number,
        model: MarkdownTableModel,
        layout: MarkdownTableLayout | null,
        private readonly containerApi: WorkbenchContainerApi,
        private readonly getCurrentFilePath: () => string,
    ) {
        super();
        this.blockFrom = blockFrom;
        this.model = model;
        this.layout = layout;
    }

    eq(other: MarkdownTableWidget): boolean {
        return this.blockFrom === other.blockFrom
            && serializeMarkdownTableWithLayout(this.model, this.layout)
            === serializeMarkdownTableWithLayout(other.model, other.layout);
    }

    get estimatedHeight(): number {
        return estimateMarkdownTableWidgetHeight(this.model, this.layout);
    }

    toDOM(view: EditorView): HTMLElement {
        const wrapper = document.createElement("section");
        wrapper.className = "cm-markdown-table-widget";
        wrapper.style.height = `${String(estimateMarkdownTableWidgetHeight(this.model, this.layout))}px`;
        const scrollDOM = view.scrollDOM;
        this.wheelForwarder = new MarkdownTableWheelForwarder({
            scrollTarget: scrollDOM,
            getLineHeight: () => view.defaultLineHeight,
            getPageHeight: () => scrollDOM.clientHeight,
            isAlive: () => isViewAlive(view),
            requestFrame: (callback) => window.requestAnimationFrame(callback),
            cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
            createScrollEvent: () => new Event("scroll"),
        });
        const handleWheel = (event: WheelEvent): void => {
            this.wheelForwarder?.handleWheel(event);
        };
        this.wheelEventListener = handleWheel;
        wrapper.addEventListener("wheel", handleWheel, { capture: true, passive: false });

        try {
            this.root = createRoot(wrapper);
            this.root.render(
                createElement(MarkdownTableVisualEditor, {
                    blockFrom: this.blockFrom,
                    initialModel: this.model,
                    initialLayout: this.layout,
                    onCommitMarkdown: (markdownText: string) => saveMarkdownTable(view, this.blockFrom, markdownText),
                    onRequestExitVimNavigation: (direction: "previous" | "next") => {
                        exitMarkdownTableVimNavigation(view, this.blockFrom, direction);
                    },
                    containerApi: this.containerApi,
                    currentFilePath: this.getCurrentFilePath(),
                }),
            );
            window.requestAnimationFrame(() => {
                if (!isViewAlive(view)) {
                    return;
                }

                view.requestMeasure();
            });
        } catch (error) {
            console.error("[markdown-table-syntax-extension] widget render failed", {
                message: error instanceof Error ? error.message : String(error),
            });
            wrapper.textContent = "Markdown table render error";
        }

        return wrapper;
    }

    ignoreEvent(event: Event): boolean {
        return event.type !== "mousemove";
    }

    destroy(dom?: HTMLElement): void {
        if (this.wheelEventListener) {
            dom?.removeEventListener("wheel", this.wheelEventListener, true);
            this.wheelEventListener = null;
        }
        this.wheelForwarder?.destroy();
        this.wheelForwarder = null;
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
}

function buildMarkdownTableDecorations(
    state: EditorState,
    blocks: readonly MarkdownTableBlock[],
    containerApi: WorkbenchContainerApi,
    getCurrentFilePath: () => string,
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();

    blocks.forEach((block) => {
        if (shouldKeepMarkdownTableSourceVisible(block, state.selection.ranges)) {
            return;
        }

        builder.add(
            block.from,
            block.to,
            Decoration.replace({
                widget: new MarkdownTableWidget(
                    block.from,
                    block.model,
                    block.layout,
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

function buildMarkdownTableSyntaxState(
    state: EditorState,
    containerApi: WorkbenchContainerApi,
    getCurrentFilePath: () => string,
): MarkdownTableSyntaxState {
    const blocks = parseMarkdownTableBlocksFromState(state);
    return {
        blocks,
        decorations: buildMarkdownTableDecorations(state, blocks, containerApi, getCurrentFilePath),
    };
}

function shouldRebuildMarkdownTableSyntaxState(transaction: Transaction): boolean {
    return transaction.docChanged || transaction.selection !== undefined;
}

/**
 * @function createMarkdownTableSyntaxExtension
 * @description 创建 Markdown 表格可视化编辑扩展。
 * @returns CodeMirror Extension。
 */
export function createMarkdownTableSyntaxExtension(
    containerApi: WorkbenchContainerApi,
    getCurrentFilePath: () => string,
    options: MarkdownTableSyntaxExtensionOptions = {},
): Extension {
    const syntaxStateField = StateField.define<MarkdownTableSyntaxState>({
        create(state) {
            return buildMarkdownTableSyntaxState(state, containerApi, getCurrentFilePath);
        },
        update(value, transaction) {
            if (!shouldRebuildMarkdownTableSyntaxState(transaction)) {
                return value;
            }

            return buildMarkdownTableSyntaxState(transaction.state, containerApi, getCurrentFilePath);
        },
        compare(left, right) {
            return left.blocks === right.blocks
                && RangeSet.eq([left.decorations], [right.decorations]);
        },
        provide(field) {
            return EditorView.decorations.from(field, (value) => value.decorations);
        },
    });

    const lifecyclePlugin = ViewPlugin.fromClass(
        class {
            blocks: MarkdownTableBlock[];

            constructor(view: EditorView) {
                this.blocks = this.readBlocks(view);
                this.syncExclusionZones(view);
            }

            update(update: ViewUpdate): void {
                this.blocks = this.readBlocks(update.view);
                this.syncExclusionZones(update.view);

                if (update.selectionSet) {
                    const selection = update.view.state.selection.main;
                    if (selection.empty) {
                        const touchedBlock = this.blocks
                            .find((block) => selection.head >= block.from && selection.head < block.to);
                        if (touchedBlock) {
                            queueMicrotask(() => {
                                if (!isViewAlive(update.view)) {
                                    return;
                                }

                                const liveSelection = update.view.state.selection.main;
                                if (!liveSelection.empty) {
                                    return;
                                }

                                const liveBlock = parseMarkdownTableBlocks(update.view)
                                    .find((block) => liveSelection.head >= block.from && liveSelection.head < block.to);
                                if (!liveBlock) {
                                    return;
                                }

                                const anchor = liveBlock.endLineNumber < update.view.state.doc.lines
                                    ? update.view.state.doc.line(liveBlock.endLineNumber + 1).from
                                    : liveBlock.to;
                                update.view.dispatch({
                                    selection: { anchor },
                                    scrollIntoView: true,
                                });
                                options.onRequestFocusVimNavigation?.({
                                    blockFrom: liveBlock.from,
                                    position: "first",
                                });
                            });
                        }
                    }
                }
            }

            private readBlocks(view: EditorView): MarkdownTableBlock[] {
                try {
                    return view.state.field(syntaxStateField).blocks;
                } catch (error) {
                    console.error("[markdown-table-syntax-extension] read syntax state failed", {
                        message: error instanceof Error ? error.message : String(error),
                    });
                    return [];
                }
            }

            private syncExclusionZones(view: EditorView): void {
                if (!isViewAlive(view)) {
                    setExclusionZones(view, "markdown-table", []);
                    return;
                }

                setExclusionZones(view, "markdown-table", this.blocks.map((block) => ({ from: block.from, to: block.to })));
            }
        },
    );

    const atomicRanges = EditorView.atomicRanges.of((view) => {
        const syntaxState = view.state.field(syntaxStateField, false);
        if (!syntaxState || syntaxState.blocks.length === 0) {
            return RangeSet.empty;
        }

        return RangeSet.of(
            syntaxState.blocks
                .filter((block) => !shouldKeepMarkdownTableSourceVisible(block, view.state.selection.ranges))
                .map((block) => markdownTableAtomicMarker.range(block.from, block.to)),
        );
    });

    return [syntaxStateField, lifecyclePlugin, atomicRanges];
}
