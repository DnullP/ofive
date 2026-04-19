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

import { RangeSet, RangeSetBuilder, type Text } from "@codemirror/state";
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import katex from "katex";
import { rangeIntersectsSelection } from "../syntaxRenderRegistry";
import {
    hiddenBlockLineDecoration,
    hiddenBlockAnchorLineDecoration,
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
}

/** 通过 WeakMap 在 ViewPlugin 实例间共享块级公式范围 */
const blockLatexRangesMap = new WeakMap<EditorView, BlockLatexRange[]>();

/**
 * @interface BlockLatexWidgetPlacement
 * @description 块级公式源码隐藏与 widget 挂载策略。
 */
interface BlockLatexWidgetPlacement {
    /** 需要完全压缩隐藏的源码行号。 */
    hiddenLineNumbers: number[];
    /** 承载 widget 的锚点行号。 */
    anchorLineNumber: number;
    /** widget 挂载偏移。 */
    widgetPos: number;
    /** widget 在锚点位置的 side。 */
    widgetSide: -1 | 1;
}

/**
 * @function resolveLatexBlockWidgetPlacement
 * @description 为块级公式计算源码隐藏范围与 widget 挂载锚点。
 *   closing delimiter 所在行会保留为 anchor line，避免在文末场景下因为整行被压成
 *   `height: 0` 而吞掉 widget。
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
    const hiddenLineNumbers: number[] = [];
    for (let lineNumber = startLineNumber; lineNumber < endLineNumber; lineNumber += 1) {
        hiddenLineNumbers.push(lineNumber);
    }

    return {
        hiddenLineNumbers,
        anchorLineNumber: endLineNumber,
        widgetPos: doc.line(endLineNumber).to,
        widgetSide: -1,
    };
}

/* ─────────────────── 装饰构建 ─────────────────── */

/**
 * @function buildLatexDecorations
 * @description 遍历可见行，检测并构建 LaTeX 公式装饰。
 *   支持三种公式形式：
 *   1. 单行块级：`$$ ... $$`（整行）
 *   2. 多行块级：`$$` 开始行 + 内容行 + `$$` 结束行
 *   3. 行内公式：`$...$`（不能跨行，不能为 `$$`）
 *
 *   当光标处于公式范围内时，跳过渲染（回退源码）。
 *
 * @param view 编辑器视图。
 * @returns 装饰集合。
 */
function buildLatexDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    const blockRanges: BlockLatexRange[] = [];

    /**
     * 收集所有需要渲染的装饰，按 from 排序后再添加到 builder。
     * 这样能保证装饰不交叉、不乱序。
     */
    const pendingDecorations: Array<{
        from: number;
        to: number;
        decoration: Decoration;
        /** 排序优先级：line 装饰放前面，widget 放后面 */
        priority: number;
    }> = [];

    /** 跟踪已被块级公式覆盖的行号，避免这些行再被行内匹配 */
    const blockCoveredLines = new Set<number>();

    /** 收集本次声明的排斥区域 */
    const exclusionZones: Array<{ from: number; to: number }> = [];

    /* ── 第一遍：扫描块级公式 ── */
    let lineIndex = 1;
    while (lineIndex <= doc.lines) {
        const line = doc.line(lineIndex);
        const lineText = line.text;

        /* 单行块级公式 $$ ... $$ */
        const singleLineMatch = lineText.match(BLOCK_LATEX_SINGLE_LINE_PATTERN);
        if (singleLineMatch) {
            const latex = (singleLineMatch[1] ?? "").trim();
            const blockFrom = line.from;
            const blockTo = line.to;

            /* 跳过被更高优先级区域（frontmatter / code-fence）覆盖的范围 */
            if (isRangeInsideHigherPriorityZone(view, blockFrom, blockTo, "latex-block")) {
                lineIndex++;
                continue;
            }

            const isEditing = rangeTouchesBlock({ from: blockFrom, to: blockTo }, view.state.selection.ranges);
            if (!isEditing && latex.length > 0) {
                const rendered = renderLatexToHtml(latex, true);
                const widget = new BlockLatexWidget(latex, rendered.html, rendered.isError);
                const placement = resolveLatexBlockWidgetPlacement(doc, lineIndex, lineIndex);

                const anchorLine = doc.line(placement.anchorLineNumber);
                pendingDecorations.push({
                    from: anchorLine.from,
                    to: anchorLine.from,
                    decoration: hiddenBlockAnchorLineDecoration,
                    priority: 0,
                });

                pendingDecorations.push({
                    from: placement.widgetPos,
                    to: placement.widgetPos,
                    decoration: Decoration.widget({ widget, block: false, side: placement.widgetSide }),
                    priority: 1,
                });

                blockRanges.push({ from: blockFrom, to: blockTo });
                exclusionZones.push({ from: blockFrom, to: blockTo });
                blockCoveredLines.add(lineIndex);
            }

            lineIndex++;
            continue;
        }

        /* 多行块级公式 */
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

                /* 跳过被更高优先级区域覆盖的范围 */
                if (isRangeInsideHigherPriorityZone(view, blockFrom, blockTo, "latex-block")) {
                    lineIndex = closeLineNumber + 1;
                    continue;
                }

                const isEditing = rangeTouchesBlock({ from: blockFrom, to: blockTo }, view.state.selection.ranges);
                if (!isEditing && latex.length > 0) {
                    const rendered = renderLatexToHtml(latex, true);
                    const widget = new BlockLatexWidget(latex, rendered.html, rendered.isError);
                    const placement = resolveLatexBlockWidgetPlacement(
                        doc,
                        openLineNumber,
                        closeLineNumber,
                    );

                    /* 隐藏 closing delimiter 之前的源码行，closing line 保留为 anchor。 */
                    for (const ln of placement.hiddenLineNumbers) {
                        const targetLine = doc.line(ln);
                        pendingDecorations.push({
                            from: targetLine.from,
                            to: targetLine.from,
                            decoration: hiddenBlockLineDecoration,
                            priority: 0,
                        });
                        blockCoveredLines.add(ln);
                    }

                    const anchorLine = doc.line(placement.anchorLineNumber);
                    pendingDecorations.push({
                        from: anchorLine.from,
                        to: anchorLine.from,
                        decoration: hiddenBlockAnchorLineDecoration,
                        priority: 0,
                    });
                    blockCoveredLines.add(placement.anchorLineNumber);

                    pendingDecorations.push({
                        from: placement.widgetPos,
                        to: placement.widgetPos,
                        decoration: Decoration.widget({ widget, block: false, side: placement.widgetSide }),
                        priority: 1,
                    });

                    blockRanges.push({ from: blockFrom, to: blockTo });
                    exclusionZones.push({ from: blockFrom, to: blockTo });
                }

                lineIndex = closeLineNumber + 1;
                continue;
            }
        }

        lineIndex++;
    }

    /* 声明排斥区域 */
    setExclusionZones(view, "latex-block", exclusionZones);

    /* ── 第二遍：扫描行内公式（跳过被块级覆盖的行） ── */
    for (const visibleRange of view.visibleRanges) {
        let currentLine = doc.lineAt(visibleRange.from);
        const endLineNumber = doc.lineAt(visibleRange.to).number;

        while (currentLine.number <= endLineNumber) {
            /* 跳过被块级公式覆盖的行和被更高优先级区域覆盖的行 */
            if (
                !blockCoveredLines.has(currentLine.number) &&
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

                    const isEditing = rangeIntersectsSelection(view, tokenFrom, tokenTo);
                    if (isEditing) {
                        continue;
                    }

                    const rendered = renderLatexToHtml(latex, false);
                    const widget = new InlineLatexWidget(latex, rendered.html, rendered.isError);

                    pendingDecorations.push({
                        from: tokenFrom,
                        to: tokenTo,
                        decoration: Decoration.replace({ widget }),
                        priority: 0,
                    });
                }
            }

            if (currentLine.number === endLineNumber) {
                break;
            }
            currentLine = doc.line(currentLine.number + 1);
        }
    }

    /* ── 排序并添加装饰 ── */
    pendingDecorations.sort((a, b) => {
        if (a.from !== b.from) {
            return a.from - b.from;
        }
        if (a.to !== b.to) {
            return a.to - b.to;
        }
        return a.priority - b.priority;
    });

    for (const item of pendingDecorations) {
        builder.add(item.from, item.to, item.decoration);
    }

    /* 保存块级范围供 atomicRanges 使用 */
    blockLatexRangesMap.set(view, blockRanges);

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
    const plugin = ViewPlugin.fromClass(
        class {
            /** 当前装饰集合 */
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildLatexDecorations(view);
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
                    this.decorations = buildLatexDecorations(update.view);
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

    return [plugin, atomicRanges];
}
