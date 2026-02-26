/**
 * @module layout/editor/syntaxRenderRegistry
 * @description 编辑器语法渲染注册中心：通过“注册 + 插件”机制统一承载光标进入时回退源码的渲染能力。
 * @dependencies
 *  - @codemirror/state
 *  - @codemirror/view
 *
 * @example
 *   registerLineSyntaxRenderer({ id: "tag", applyLineDecorations: (...) => {} })
 *   const extension = createRegisteredLineSyntaxRenderExtension()
 */

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { isInsideExclusionZone } from "./syntaxExclusionZones";

/**
 * @interface SyntaxDecorationRange
 * @description 待写入 RangeSetBuilder 的装饰范围。
 */
export interface SyntaxDecorationRange {
    /** 范围起始偏移（闭区间） */
    from: number;
    /** 范围结束偏移（开区间） */
    to: number;
    /** CodeMirror 装饰对象 */
    decoration: Decoration;
}

/**
 * @interface LineSyntaxDecorationContext
 * @description 单行语法渲染回调上下文。
 */
export interface LineSyntaxDecorationContext {
    /** 编辑器视图 */
    view: EditorView;
    /** 当前行文本 */
    lineText: string;
    /** 当前行起始偏移 */
    lineFrom: number;
    /** 装饰范围收集器 */
    ranges: SyntaxDecorationRange[];
}

/**
 * @interface LineSyntaxRendererRegistration
 * @description 单行语法渲染注册项。
 */
export interface LineSyntaxRendererRegistration {
    /** 注册项唯一标识 */
    id: string;
    /** 处理单行装饰生成 */
    applyLineDecorations: (context: LineSyntaxDecorationContext) => void;
}

const lineSyntaxRendererMap = new Map<string, LineSyntaxRendererRegistration>();

/**
 * @function registerLineSyntaxRenderer
 * @description 注册单行语法渲染器；同 id 再次注册时会覆盖。
 * @param registration 注册项。
 * @returns 取消注册函数。
 */
export function registerLineSyntaxRenderer(
    registration: LineSyntaxRendererRegistration,
): () => void {
    lineSyntaxRendererMap.set(registration.id, registration);

    return () => {
        if (!lineSyntaxRendererMap.has(registration.id)) {
            return;
        }
        lineSyntaxRendererMap.delete(registration.id);
    };
}

/**
 * @function getLineSyntaxRendererSnapshot
 * @description 获取当前语法渲染器快照。
 * @returns 已注册渲染器列表。
 */
export function getLineSyntaxRendererSnapshot(): LineSyntaxRendererRegistration[] {
    return Array.from(lineSyntaxRendererMap.values());
}

/**
 * @function pushSyntaxDecorationRange
 * @description 写入装饰范围（过滤空区间）。
 * @param ranges 装饰范围集合。
 * @param from 起始偏移。
 * @param to 结束偏移。
 * @param decoration 装饰对象。
 */
export function pushSyntaxDecorationRange(
    ranges: SyntaxDecorationRange[],
    from: number,
    to: number,
    decoration: Decoration,
): void {
    if (to <= from) {
        return;
    }

    ranges.push({
        from,
        to,
        decoration,
    });
}

/**
 * @function rangeIntersectsSelection
 * @description 判断范围是否与当前光标/选择重叠。
 * @param view 编辑器视图。
 * @param from 起始偏移。
 * @param to 结束偏移。
 * @returns 若重叠返回 true。
 */
export function rangeIntersectsSelection(
    view: EditorView,
    from: number,
    to: number,
): boolean {
    return view.state.selection.ranges.some((range) => {
        if (range.empty) {
            return range.from >= from && range.from <= to;
        }
        return range.from <= to && range.to >= from;
    });
}

/**
 * @function addInlineSyntaxDecoration
 * @description 为行内 token 添加装饰；当光标进入 token 时回退源码（不施加装饰）。
 * @param context 语法渲染上下文。
 * @param tokenStartInLine token 在行内起始位置。
 * @param fullText token 完整文本。
 * @param contentClass token 渲染样式类名。
 */
export function addInlineSyntaxDecoration(
    context: LineSyntaxDecorationContext,
    tokenStartInLine: number,
    fullText: string,
    contentClass: string,
): void {
    if (tokenStartInLine < 0 || fullText.length === 0) {
        return;
    }

    const tokenFrom = context.lineFrom + tokenStartInLine;
    const tokenTo = tokenFrom + fullText.length;
    const isEditingToken = context.view.hasFocus && rangeIntersectsSelection(context.view, tokenFrom, tokenTo);
    if (isEditingToken) {
        return;
    }

    pushSyntaxDecorationRange(
        context.ranges,
        tokenFrom,
        tokenTo,
        Decoration.mark({
            class: contentClass,
        }),
    );
}

/**
 * @function addDelimitedInlineSyntaxDecoration
 * @description 为带左右标记的行内语法添加装饰：非编辑态通过 Decoration.replace 隐藏标记，仅渲染内容区。
 *   使用 Decoration.replace 而非 font-size:0 的 Decoration.mark，以确保 CM6 的
 *   posAtCoords / coordsAtPos 位置映射正确，避免点击后光标偏移。
 * @param context 语法渲染上下文。
 * @param tokenStartInLine token 在行内起始位置。
 * @param fullText token 完整文本。
 * @param leftMarkerLength 左侧标记长度。
 * @param rightMarkerLength 右侧标记长度。
 * @param contentClass 内容样式类名。
 */
export function addDelimitedInlineSyntaxDecoration(
    context: LineSyntaxDecorationContext,
    tokenStartInLine: number,
    fullText: string,
    leftMarkerLength: number,
    rightMarkerLength: number,
    contentClass: string,
): void {
    if (tokenStartInLine < 0 || fullText.length <= leftMarkerLength + rightMarkerLength) {
        return;
    }

    const tokenFrom = context.lineFrom + tokenStartInLine;
    const tokenTo = tokenFrom + fullText.length;
    const contentFrom = tokenFrom + leftMarkerLength;
    const contentTo = tokenTo - rightMarkerLength;
    const isEditingToken = context.view.hasFocus && rangeIntersectsSelection(context.view, tokenFrom, tokenTo);
    if (isEditingToken) {
        return;
    }

    const markerDecoration = Decoration.replace({});
    const contentDecoration = Decoration.mark({
        class: contentClass,
    });

    pushSyntaxDecorationRange(context.ranges, tokenFrom, contentFrom, markerDecoration);
    pushSyntaxDecorationRange(context.ranges, contentFrom, contentTo, contentDecoration);
    pushSyntaxDecorationRange(context.ranges, contentTo, tokenTo, markerDecoration);
}

/**
 * @function buildRegisteredSyntaxDecorations
 * @description 依据注册中心构建当前 viewport 内的装饰集合。
 *   通过排斥区域（syntaxExclusionZones）跳过被块级插件（frontmatter / code-fence /
 *   latex-block）管辖的行，避免行级渲染器对这些行产生冲突装饰。
 * @param view 编辑器视图。
 * @returns 装饰集合。
 */
function buildRegisteredSyntaxDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const ranges: SyntaxDecorationRange[] = [];
    const renderers = getLineSyntaxRendererSnapshot();
    if (renderers.length === 0) {
        return builder.finish();
    }

    for (const visibleRange of view.visibleRanges) {
        let currentLine = view.state.doc.lineAt(visibleRange.from);
        const endLineNumber = view.state.doc.lineAt(visibleRange.to).number;

        while (currentLine.number <= endLineNumber) {
            /* 若当前行起始位置处于任何排斥区域内，则跳过行级语法渲染 */
            if (!isInsideExclusionZone(view, currentLine.from)) {
                renderers.forEach((renderer) => {
                    renderer.applyLineDecorations({
                        view,
                        lineText: currentLine.text,
                        lineFrom: currentLine.from,
                        ranges,
                    });
                });
            }

            if (currentLine.number === endLineNumber) {
                break;
            }
            currentLine = view.state.doc.line(currentLine.number + 1);
        }
    }

    ranges
        .sort((left, right) => {
            if (left.from !== right.from) {
                return left.from - right.from;
            }
            if (left.to !== right.to) {
                return left.to - right.to;
            }
            return 0;
        })
        .forEach((range) => {
            builder.add(range.from, range.to, range.decoration);
        });

    return builder.finish();
}

/**
 * @function createRegisteredLineSyntaxRenderExtension
 * @description 创建注册语法渲染插件扩展。
 * @returns CodeMirror 扩展。
 */
export function createRegisteredLineSyntaxRenderExtension() {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildRegisteredSyntaxDecorations(view);
            }

            update(update: ViewUpdate): void {
                if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
                    this.decorations = buildRegisteredSyntaxDecorations(update.view);
                }
            }
        },
        {
            decorations: (plugin) => plugin.decorations,
        },
    );
}
