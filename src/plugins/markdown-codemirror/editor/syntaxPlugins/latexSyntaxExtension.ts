/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/latexSyntaxExtension
 * @description LaTeX 数学公式语法插件：渲染 `$...$`（行内）和 `$$...$$`（块级）数学公式。
 *   使用 KaTeX 作为渲染引擎，在编辑器中实时预览 LaTeX 数学公式。
 *   - 行内公式：`$E=mc^2$` → 渲染为行内数学公式
 *   - 块级公式：`$$\int_0^\infty ...\,dx$$`（单行）或跨行 `$$...$$` → 渲染为居中块级公式
 *   当光标进入公式范围时，回退到源码编辑模式。
 *
 * @dependencies
 *  - @codemirror/state
 *  - @codemirror/view
 *  - katex
 *  - ../syntaxRenderRegistry（rangeIntersectsSelection）
 *
 * @exports
 *  - createLatexSyntaxExtension: 创建 LaTeX 语法渲染扩展
 */

import { RangeSet, RangeSetBuilder, StateField, type Text } from "@codemirror/state";
import type { EditorState, Transaction } from "@codemirror/state";
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import katex from "katex";
import { detectExcludedLineRanges } from "../../../../utils/markdownBlockDetector";
import { rangeIntersectsSelection } from "../syntaxRenderRegistry";
import {
    rangeTouchesBlock,
    type BlockRange,
} from "./blockWidgetReplace";
import {
    setExclusionZones,
    isRangeInsideHigherPriorityZone,
} from "../syntaxExclusionZones";

/* ─────────────────── 正则表达式 ─────────────────── */

/**
 * 匹配单行块级公式：整行仅包含 `$$...$$`（允许前后空白）。
 * 不匹配空内容 `$$$$`。
 */
const BLOCK_LATEX_SINGLE_LINE_PATTERN = /^\s*\$\$(.+?)\$\$\s*$/;

/**
 * 匹配块级公式开始标记：整行仅包含 `$$`（允许前后空白）。
 */
const BLOCK_LATEX_OPEN_PATTERN = /^\s*\$\$\s*$/;

/**
 * 匹配块级公式结束标记：整行仅包含 `$$`（允许前后空白）。
 */
const BLOCK_LATEX_CLOSE_PATTERN = /^\s*\$\$\s*$/;

/**
 * 匹配行内公式：`$...$`，不匹配 `$$`。
 * 内容不允许为空，不允许包含换行。
 * 使用负向后顾确保不匹配 `$$` 开头，使用负向前瞻确保不匹配 `$$` 结尾。
 */
const INLINE_LATEX_PATTERN = /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g;

const BLOCK_LATEX_WIDGET_BASE_HEIGHT = 60;
const BLOCK_LATEX_WIDGET_EXTRA_LINE_HEIGHT = 20;
const BLOCK_LATEX_WIDGET_TALL_TOKEN_HEIGHT = 8;
const BLOCK_LATEX_WIDGET_MAX_ESTIMATED_HEIGHT = 360;

/* ─────────────────── KaTeX 渲染缓存 ─────────────────── */

/**
 * KaTeX 渲染结果缓存：避免对同一公式反复调用 KaTeX。
 * 键为 `${displayMode}::${latex}`，值为渲染后的 HTML 字符串或错误信息。
 */
interface KatexCacheEntry {
    /** 渲染后的 HTML 字符串 */
    html: string;
    /** 是否渲染失败 */
    isError: boolean;
}

const katexCache = new Map<string, KatexCacheEntry>();

/**
 * @function renderLatexToHtml
 * @description 使用 KaTeX 将 LaTeX 字符串渲染为 HTML。结果会被缓存。
 * @param latex LaTeX 源码字符串。
 * @param displayMode 是否为块级（display）模式。
 * @returns KaTeX 渲染缓存条目（含 HTML 和错误状态）。
 */
function renderLatexToHtml(latex: string, displayMode: boolean): KatexCacheEntry {
    const cacheKey = `${displayMode ? "block" : "inline"}::${latex}`;
    const cached = katexCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    try {
        const html = katex.renderToString(latex, {
            displayMode,
            throwOnError: false,
            strict: false,
            trust: false,
            output: "htmlAndMathml",
        });
        const entry: KatexCacheEntry = { html, isError: false };
        katexCache.set(cacheKey, entry);
        return entry;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorHtml = `<span class="cm-latex-error" title="${escapeHtml(errorMessage)}">${escapeHtml(latex)}</span>`;
        const entry: KatexCacheEntry = { html: errorHtml, isError: true };
        katexCache.set(cacheKey, entry);
        return entry;
    }
}

/**
 * @function escapeHtml
 * @description 转义 HTML 特殊字符，防止 XSS。
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

/**
 * @function estimateBlockLatexWidgetHeight
 * @description 为离屏块级 LaTeX widget 提供保守高度，避免 KaTeX 进入视口后
 *   CodeMirror 大幅修正 scrollHeight。
 */
export function estimateBlockLatexWidgetHeight(latex: string): number {
    const logicalLineCount = Math.max(1, latex.split("\n").length);
    const tallTokenCount = (latex.match(/\\(?:frac|sum|int|prod|sqrt|begin|matrix|cases)/g) ?? []).length;
    return Math.min(
        BLOCK_LATEX_WIDGET_MAX_ESTIMATED_HEIGHT,
        BLOCK_LATEX_WIDGET_BASE_HEIGHT
            + (logicalLineCount - 1) * BLOCK_LATEX_WIDGET_EXTRA_LINE_HEIGHT
            + tallTokenCount * BLOCK_LATEX_WIDGET_TALL_TOKEN_HEIGHT,
    );
}

/* ─────────────────── Widget 类 ─────────────────── */

/**
 * @class InlineLatexWidget
 * @description 行内 LaTeX 公式 Widget：将 `$...$` 替换为 KaTeX 渲染结果。
 * @field latex - LaTeX 源码字符串
 * @field renderedHtml - KaTeX 渲染后的 HTML
 * @field isError - 是否渲染失败
 */
class InlineLatexWidget extends WidgetType {
    /** LaTeX 源码字符串 */
    private readonly latex: string;
    /** KaTeX 渲染后的 HTML */
    private readonly renderedHtml: string;
    /** 是否渲染失败 */
    private readonly isError: boolean;

    constructor(latex: string, renderedHtml: string, isError: boolean) {
        super();
        this.latex = latex;
        this.renderedHtml = renderedHtml;
        this.isError = isError;
    }

    /**
     * @method eq
     * @description 比较两个 Widget 是否相等（避免不必要的 DOM 更新）。
     * @param other 另一个 Widget。
     * @returns 相等返回 true。
     */
    eq(other: InlineLatexWidget): boolean {
        return this.latex === other.latex && this.isError === other.isError;
    }

    /**
     * @method toDOM
     * @description 创建行内公式的 DOM 元素。
     * @returns 渲染后的 HTML 元素。
     */
    toDOM(): HTMLElement {
        /* styles: cm-latex-inline-widget（见 CodeMirrorEditorTab.css） */
        const wrapper = document.createElement("span");
        wrapper.className = this.isError
            ? "cm-latex-inline-widget cm-latex-inline-error"
            : "cm-latex-inline-widget";
        wrapper.innerHTML = this.renderedHtml;
        return wrapper;
    }

    /**
     * @method ignoreEvent
     * @description 不拦截事件，允许点击时光标进入公式范围。
     * @returns false。
     */
    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * @class BlockLatexWidget
 * @description 块级 LaTeX 公式 Widget：将 `$$...$$` 替换为 KaTeX 渲染结果（居中显示）。
 * @field latex - LaTeX 源码字符串
 * @field renderedHtml - KaTeX 渲染后的 HTML
 * @field isError - 是否渲染失败
 */
class BlockLatexWidget extends WidgetType {
    /** LaTeX 源码字符串 */
    private readonly latex: string;
    /** KaTeX 渲染后的 HTML */
    private readonly renderedHtml: string;
    /** 是否渲染失败 */
    private readonly isError: boolean;

    constructor(latex: string, renderedHtml: string, isError: boolean) {
        super();
        this.latex = latex;
        this.renderedHtml = renderedHtml;
        this.isError = isError;
    }

    /**
     * @method eq
     * @description 比较两个 Widget 是否相等。
     * @param other 另一个 Widget。
     * @returns 相等返回 true。
     */
    eq(other: BlockLatexWidget): boolean {
        return this.latex === other.latex && this.isError === other.isError;
    }

    get estimatedHeight(): number {
        return estimateBlockLatexWidgetHeight(this.latex);
    }

    /**
     * @method toDOM
     * @description 创建块级公式的 DOM 元素。
     * @returns 渲染后的 HTML 元素。
     */
    toDOM(): HTMLElement {
        /* styles: cm-latex-block-widget（见 CodeMirrorEditorTab.css） */
        const wrapper = document.createElement("div");
        wrapper.className = this.isError
            ? "cm-latex-block-widget cm-latex-block-error"
            : "cm-latex-block-widget";
        wrapper.style.minHeight = `${String(estimateBlockLatexWidgetHeight(this.latex))}px`;
        wrapper.innerHTML = this.renderedHtml;
        return wrapper;
    }

    /**
     * @method ignoreEvent
     * @description 不拦截事件，允许点击时光标进入公式范围。
     * @returns false。
     */
    ignoreEvent(): boolean {
        return false;
    }
}

/* ─────────────────── 块级公式范围跟踪 ─────────────────── */

/**
 * @interface BlockLatexRange
 * @description 记录块级公式在文档中的范围，用于 atomicRanges。
 */
interface BlockLatexRange {
    /** 范围起始偏移（块级公式第一行 from） */
    from: number;
    /** 范围结束偏移（块级公式最后一行 to） */
    to: number;
    /** LaTeX 源码内容（不含 $$ delimiter）。 */
    latex: string;
    /** 是否渲染失败。 */
    isError: boolean;
    /** KaTeX 渲染后的 HTML。 */
    renderedHtml: string;
}

/** 通过 WeakMap 在 ViewPlugin 实例间共享块级公式范围 */
const blockLatexRangesMap = new WeakMap<EditorView, BlockLatexRange[]>();

interface BlockLatexSyntaxState {
    ranges: BlockLatexRange[];
    decorations: DecorationSet;
}

interface LatexPriorityExclusionRange {
    from: number;
    to: number;
}

export function resolveLatexPriorityExclusionRanges(doc: Text): LatexPriorityExclusionRange[] {
    return detectExcludedLineRanges(doc.toString())
        .filter((range) => range.type === "frontmatter" || range.type === "code-fence")
        .map((range) => ({
            from: doc.line(range.fromLine).from,
            to: doc.line(range.toLine).to,
        }));
}

function rangeIntersectsLatexPriorityExclusion(
    ranges: LatexPriorityExclusionRange[],
    from: number,
    to: number,
): boolean {
    return ranges.some((range) => from <= range.to && to >= range.from);
}

/**
 * @interface BlockLatexWidgetPlacement
 * @description 块级公式源码隐藏与 widget 挂载策略。
 */
interface BlockLatexWidgetPlacement {
    /** replace decoration 起始偏移。 */
    from: number;
    /** replace decoration 结束偏移。 */
    to: number;
}

/**
 * @function resolveLatexBlockWidgetPlacement
 * @description 为块级公式计算整块替换范围。
 * @param doc 编辑器文档。
 * @param startLineNumber 块级公式起始行号。
 * @param endLineNumber 块级公式结束行号。
 * @returns widget 挂载与源码隐藏策略。
 */
export function resolveLatexBlockWidgetPlacement(
    doc: Text,
    startLineNumber: number,
    endLineNumber: number,
): BlockLatexWidgetPlacement {
    return {
        from: doc.line(startLineNumber).from,
        to: doc.line(endLineNumber).to,
    };
}

/* ─────────────────── 装饰构建 ─────────────────── */

function parseBlockLatexRanges(state: EditorState): BlockLatexRange[] {
    const doc = state.doc;
    const blockRanges: BlockLatexRange[] = [];
    const priorityExclusionRanges = resolveLatexPriorityExclusionRanges(doc);
    let lineIndex = 1;

    while (lineIndex <= doc.lines) {
        const line = doc.line(lineIndex);
        const lineText = line.text;

        const singleLineMatch = lineText.match(BLOCK_LATEX_SINGLE_LINE_PATTERN);
        if (singleLineMatch) {
            const latex = (singleLineMatch[1] ?? "").trim();
            const blockFrom = line.from;
            const blockTo = line.to;

            if (rangeIntersectsLatexPriorityExclusion(priorityExclusionRanges, blockFrom, blockTo)) {
                lineIndex++;
                continue;
            }

            if (latex.length > 0) {
                const rendered = renderLatexToHtml(latex, true);
                blockRanges.push({
                    from: blockFrom,
                    to: blockTo,
                    latex,
                    renderedHtml: rendered.html,
                    isError: rendered.isError,
                });
            }

            lineIndex++;
            continue;
        }

        if (BLOCK_LATEX_OPEN_PATTERN.test(lineText)) {
            const openLineNumber = lineIndex;
            const openLine = line;
            let closeLineNumber = -1;
            let contentLines: string[] = [];

            /* 向下搜索关闭标记 */
            for (let searchLine = openLineNumber + 1; searchLine <= doc.lines; searchLine++) {
                const candidateLine = doc.line(searchLine);
                if (BLOCK_LATEX_CLOSE_PATTERN.test(candidateLine.text)) {
                    closeLineNumber = searchLine;
                    break;
                }
                contentLines.push(candidateLine.text);
            }

            if (closeLineNumber > 0) {
                const closeLine = doc.line(closeLineNumber);
                const blockFrom = openLine.from;
                const blockTo = closeLine.to;
                const latex = contentLines.join("\n").trim();

                if (rangeIntersectsLatexPriorityExclusion(priorityExclusionRanges, blockFrom, blockTo)) {
                    lineIndex = closeLineNumber + 1;
                    continue;
                }

                if (latex.length > 0) {
                    const rendered = renderLatexToHtml(latex, true);
                    blockRanges.push({
                        from: blockFrom,
                        to: blockTo,
                        latex,
                        renderedHtml: rendered.html,
                        isError: rendered.isError,
                    });
                }

                lineIndex = closeLineNumber + 1;
                continue;
            }
        }

        lineIndex++;
    }

    return blockRanges;
}

function buildBlockLatexDecorations(
    state: EditorState,
    ranges: readonly BlockLatexRange[],
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();

    for (const range of ranges) {
        if (rangeTouchesBlock(range, state.selection.ranges)) {
            continue;
        }

        builder.add(
            range.from,
            range.to,
            Decoration.replace({
                widget: new BlockLatexWidget(range.latex, range.renderedHtml, range.isError),
                block: false,
                side: -1,
            }),
        );
    }

    return builder.finish();
}

function buildBlockLatexSyntaxState(state: EditorState): BlockLatexSyntaxState {
    const ranges = parseBlockLatexRanges(state);
    return {
        ranges,
        decorations: buildBlockLatexDecorations(state, ranges),
    };
}

function shouldRebuildBlockLatexSyntaxState(transaction: Transaction): boolean {
    return transaction.docChanged || transaction.selection !== undefined;
}

function isLineInsideBlockLatexRange(lineFrom: number, lineTo: number, ranges: readonly BlockLatexRange[]): boolean {
    return ranges.some((range) => lineFrom <= range.to && lineTo >= range.from);
}

/**
 * @function buildInlineLatexDecorations
 * @description 遍历可见行并构建行内 LaTeX 装饰。块级 LaTeX 由 StateField 直接提供，
 *   这里仅处理不改变垂直布局的 `$...$`。
 */
function buildInlineLatexDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    const priorityExclusionRanges = resolveLatexPriorityExclusionRanges(doc);
    const blockRanges = blockLatexRangesMap.get(view) ?? [];

    for (const visibleRange of view.visibleRanges) {
        let currentLine = doc.lineAt(visibleRange.from);
        const endLineNumber = doc.lineAt(visibleRange.to).number;

        while (currentLine.number <= endLineNumber) {
            /* 跳过被块级公式覆盖的行和被更高优先级区域覆盖的行 */
            if (
                !isLineInsideBlockLatexRange(currentLine.from, currentLine.to, blockRanges) &&
                !rangeIntersectsLatexPriorityExclusion(
                    priorityExclusionRanges,
                    currentLine.from,
                    currentLine.to,
                ) &&
                !isRangeInsideHigherPriorityZone(
                    view,
                    currentLine.from,
                    currentLine.to,
                    "latex-block",
                )
            ) {
                const matches = Array.from(currentLine.text.matchAll(INLINE_LATEX_PATTERN));
                for (const match of matches) {
                    const fullMatch = match[0] ?? "";
                    const latex = (match[1] ?? "").trim();
                    const matchIndex = match.index ?? -1;

                    if (matchIndex < 0 || latex.length === 0) {
                        continue;
                    }

                    const tokenFrom = currentLine.from + matchIndex;
                    const tokenTo = tokenFrom + fullMatch.length;

                    if (
                        rangeIntersectsLatexPriorityExclusion(
                            priorityExclusionRanges,
                            tokenFrom,
                            tokenTo,
                        )
                    ) {
                        continue;
                    }

                    const isEditing = rangeIntersectsSelection(view, tokenFrom, tokenTo);
                    if (isEditing) {
                        continue;
                    }

                    const rendered = renderLatexToHtml(latex, false);
                    const widget = new InlineLatexWidget(latex, rendered.html, rendered.isError);

                    builder.add(tokenFrom, tokenTo, Decoration.replace({ widget }));
                }
            }

            if (currentLine.number === endLineNumber) {
                break;
            }
            currentLine = doc.line(currentLine.number + 1);
        }
    }

    return builder.finish();
}

/* ─────────────────── 扩展工厂 ─────────────────── */

/**
 * @function createLatexSyntaxExtension
 * @description 创建 LaTeX 语法渲染扩展，返回 CodeMirror 扩展数组。
 *   包含：
 *   1. ViewPlugin — 负责构建行内和块级公式的装饰。
 *   2. atomicRanges — 将块级公式范围标记为原子区域，防止光标进入隐藏源码。
 *
 * @returns CodeMirror Extension 数组。
 * @example
 *   const extensions = [
 *     ...createLatexSyntaxExtension(),
 *   ];
 */
export function createLatexSyntaxExtension() {
    const blockSyntaxStateField = StateField.define<BlockLatexSyntaxState>({
        create(state) {
            return buildBlockLatexSyntaxState(state);
        },
        update(value, transaction) {
            if (!shouldRebuildBlockLatexSyntaxState(transaction)) {
                return value;
            }

            return buildBlockLatexSyntaxState(transaction.state);
        },
        provide(field) {
            return EditorView.decorations.from(field, (value) => value.decorations);
        },
    });

    const lifecyclePlugin = ViewPlugin.fromClass(
        class {
            constructor(view: EditorView) {
                this.syncBlockRanges(view);
            }

            update(update: ViewUpdate): void {
                if (update.docChanged || update.selectionSet) {
                    this.syncBlockRanges(update.view);
                }
            }

            private syncBlockRanges(view: EditorView): void {
                const state = view.state.field(blockSyntaxStateField, false);
                const ranges = state?.ranges ?? [];
                blockLatexRangesMap.set(view, ranges);
                setExclusionZones(view, "latex-block", ranges.map((range) => ({
                    from: range.from,
                    to: range.to,
                })));
            }
        },
    );

    const inlinePlugin = ViewPlugin.fromClass(
        class {
            /** 当前装饰集合 */
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildInlineLatexDecorations(view);
            }

            /**
             * @method update
             * @description 在文档变化、光标移动、视口变化或焦点变化时重新构建装饰。
             * @param update 视图更新事件。
             */
            update(update: ViewUpdate): void {
                if (
                    update.docChanged ||
                    update.selectionSet ||
                    update.viewportChanged ||
                    update.focusChanged
                ) {
                    this.decorations = buildInlineLatexDecorations(update.view);
                }
            }
        },
        {
            decorations: (instance) => instance.decorations,
        },
    );

    const atomicRanges = EditorView.atomicRanges.of((view) => {
        const ranges = blockLatexRangesMap.get(view);
        if (!ranges || ranges.length === 0) {
            return RangeSet.empty;
        }

        const hiddenRanges = ranges.filter((range) => !rangeTouchesBlock(range, view.state.selection.ranges));
        if (hiddenRanges.length === 0) {
            return RangeSet.empty;
        }

        return RangeSet.of(hiddenRanges.map((range: BlockRange) => Decoration.mark({}).range(range.from, range.to)));
    });

    return [blockSyntaxStateField, lifecyclePlugin, inlinePlugin, atomicRanges];
}
