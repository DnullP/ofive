/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/frontmatterSyntaxExtension
 * @description Frontmatter 语法插件：将文档顶部 frontmatter 渲染为可编辑 YAML 组件。
 * @dependencies
 *  - @codemirror/state
 *  - @codemirror/view
 *  - yaml
 *  - ../syntaxRenderRegistry
 *
 * @example
 *   const extension = createFrontmatterSyntaxExtension()
 *   // 在 CodeMirror extensions 中注入 extension
 */

import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import i18n from "../../../../i18n";
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
import YAML from "yaml";
import { FrontmatterYamlVisualEditor } from "../components/FrontmatterYamlVisualEditor";
import {
    createBlockAtomicRangesExtension,
    hiddenBlockAnchorLineDecoration,
    hiddenBlockLineDecoration,
} from "./blockWidgetReplace";
import { setExclusionZones } from "../syntaxExclusionZones";

/**
 * @interface FrontmatterBlock
 * @description frontmatter 区块信息。
 */
interface FrontmatterBlock {
    /** 区块在文档中的起始偏移。 */
    from: number;
    /** 区块在文档中的结束偏移（开区间）。 */
    to: number;
    /** 区块起始行号（1-based）。 */
    startLineNumber: number;
    /** 区块结束行号（1-based）。 */
    endLineNumber: number;
    /** frontmatter 内容（不包含首尾分隔线）。 */
    yamlText: string;
}

/**
 * @interface SaveFrontmatterResult
 * @description frontmatter 保存结果。
 */
interface SaveFrontmatterResult {
    /** 保存是否成功。 */
    success: boolean;
    /** 失败时错误信息。 */
    message: string;
}

const FRONTMATTER_DELIMITER = "---";

/**
 * @function isViewAlive
 * @description 判断编辑器视图是否仍处于可安全操作状态。
 * @param view 编辑器视图。
 * @returns 若视图 DOM 仍挂载，返回 true。
 * @throws 无显式异常。
 */
function isViewAlive(view: EditorView): boolean {
    return view.dom.isConnected;
}

/**
 * @function parseFrontmatterBlock
 * @description 从编辑器状态中解析文档顶部 frontmatter 区块。
 *   区块结束位置停在 closing delimiter 末尾，不吞掉其后的换行；
 *   这样可确保 widget 挂载在 frontmatter 本体之后，而不是错误占据下一行的起始位置。
 * @param state 编辑器状态。
 * @returns frontmatter 区块；若不存在则返回 null。
 * @throws 无显式异常；异常场景返回 null 并记录日志。
 */
export function parseFrontmatterBlock(state: EditorView["state"]): FrontmatterBlock | null {
    try {
        if (state.doc.lines < 2) {
            return null;
        }

        const firstLine = state.doc.line(1);
        if (firstLine.text.trim() !== FRONTMATTER_DELIMITER) {
            return null;
        }

        let endLineNumber = -1;
        for (let lineNumber = 2; lineNumber <= state.doc.lines; lineNumber += 1) {
            const line = state.doc.line(lineNumber);
            if (line.text.trim() === FRONTMATTER_DELIMITER) {
                endLineNumber = lineNumber;
                break;
            }
        }

        if (endLineNumber < 2) {
            console.warn("[editor-frontmatter] closing delimiter not found");
            return null;
        }

        const blockFrom = firstLine.from;
        const endLine = state.doc.line(endLineNumber);
        const blockTo = endLine.to;

        const yamlLines: string[] = [];
        for (let lineNumber = 2; lineNumber < endLineNumber; lineNumber += 1) {
            yamlLines.push(state.doc.line(lineNumber).text);
        }

        return {
            from: blockFrom,
            to: blockTo,
            startLineNumber: 1,
            endLineNumber,
            yamlText: yamlLines.join("\n"),
        };
    } catch (error) {
        console.error("[editor-frontmatter] parse block failed", {
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * @function normalizeYamlText
 * @description 校验并规范化 YAML 文本。
 * @param rawText 原始 YAML 文本。
 * @returns 规范化后的 YAML 文本（不包含 frontmatter 分隔线）。
 * @throws 当 YAML 非法时抛出异常。
 */
function normalizeYamlText(rawText: string): string {
    const parsedDocument = YAML.parseDocument(rawText, {
        prettyErrors: true,
    });

    if (parsedDocument.errors.length > 0) {
        const message = parsedDocument.errors[0]?.message ?? i18n.t("frontmatter.yamlError");
        throw new Error(message);
    }

    const parsedData = parsedDocument.toJSON() ?? {};
    return YAML.stringify(parsedData, {
        lineWidth: 0,
    }).trimEnd();
}

/**
 * @function saveFrontmatterYaml
 * @description 将 YAML 文本写回 frontmatter 区块。
 * @param view 编辑器视图。
 * @param rawYamlText 待保存 YAML 文本。
 * @returns 保存结果。
 * @throws 无显式异常；失败时通过返回值透出原因。
 */
function saveFrontmatterYaml(view: EditorView, rawYamlText: string): SaveFrontmatterResult {
    if (!isViewAlive(view)) {
        console.warn("[editor-frontmatter] save skipped: view disconnected");
        return {
            success: false,
            message: i18n.t("frontmatter.editorClosed"),
        };
    }

    const liveBlock = parseFrontmatterBlock(view.state);
    if (!liveBlock) {
        console.warn("[editor-frontmatter] save skipped: block missing");
        return {
            success: false,
            message: i18n.t("frontmatter.noFrontmatterBlock"),
        };
    }

    try {
        const normalizedYamlText = normalizeYamlText(rawYamlText);
        const nextFrontmatterText = `---\n${normalizedYamlText}\n---`;

        console.info("[editor-frontmatter] save start", {
            from: liveBlock.from,
            to: liveBlock.to,
            inputLength: rawYamlText.length,
        });

        view.dispatch({
            changes: {
                from: liveBlock.from,
                to: liveBlock.to,
                insert: nextFrontmatterText,
            },
        });

        console.info("[editor-frontmatter] save success", {
            from: liveBlock.from,
            to: liveBlock.to,
            outputLength: nextFrontmatterText.length,
        });

        return {
            success: true,
            message: i18n.t("frontmatter.frontmatterSynced"),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[editor-frontmatter] save failed", {
            message,
        });
        return {
            success: false,
            message,
        };
    }
}

/**
 * @class FrontmatterYamlWidget
 * @description Frontmatter YAML 编辑组件：基于标准 YAML 文本编辑和保存。
 */
class FrontmatterYamlWidget extends WidgetType {
    /** YAML 初始文本。 */
    private readonly yamlText: string;

    /** 保存回调。 */
    private readonly onSave: (yamlText: string) => SaveFrontmatterResult;

    /** React 根实例。 */
    private root: Root | null = null;

    constructor(yamlText: string, onSave: (yamlText: string) => SaveFrontmatterResult) {
        super();
        this.yamlText = yamlText;
        this.onSave = onSave;
    }

    eq(other: FrontmatterYamlWidget): boolean {
        return this.yamlText === other.yamlText;
    }

    toDOM(): HTMLElement {
        const wrapper = document.createElement("section");
        wrapper.className = "cm-frontmatter-widget";

        // React root 创建和渲染必须在 try-catch 中执行：
        // toDOM() 在 CM6 DocView 构造期间被调用，此时 EditorView.docView 尚未赋值。
        // 若此处抛出异常，DocView 构造中断，docView 永远不被赋值，
        // 而已调度的 cursorLayer RAF 会访问 undefined 的 docView 导致 TypeError。
        try {
            this.root = createRoot(wrapper);
            this.root.render(
                createElement(FrontmatterYamlVisualEditor, {
                    initialYamlText: this.yamlText,
                    onCommitYaml: (yamlText: string) => this.onSave(yamlText),
                }),
            );
        } catch (error) {
            console.error("[editor-frontmatter] widget toDOM render failed", {
                message: error instanceof Error ? error.message : String(error),
            });
            wrapper.textContent = "Frontmatter render error";
        }

        return wrapper;
    }

    destroy(): void {
        this.root?.unmount();
        this.root = null;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

/**
 * @function createFrontmatterSyntaxExtension
 * @description 创建 frontmatter 渲染扩展：用 YAML 编辑器组件显示并编辑顶部 frontmatter。
 * 内部通过以下机制协作：
 * 1. `Decoration.line` 将 frontmatter 源码行隐藏（CSS `height:0`）；
 *    对应的 gutter 元素通过 CSS `overflow:hidden` 自动随行高折叠为 0 并裁剪溢出行号。
 * 2. `Decoration.widget` 在隐藏行之后插入可视化编辑组件；
 * 3. `atomicRanges` 阻止光标通过键盘导航进入隐藏区域。
 *
 * 注意：widget 使用 `block: false`（行内模式），
 * 不使用 `block: true` 或 `gutterLineClass/StateField`，
 * 因为这两者会在 EditorView 构造/销毁的 React 生命周期窗口中
 * 触发额外的 gutter measure 调度，导致 `cursorLayer.markers` 在
 * `docView` 尚未就绪时调用 `coordsAtPos` 抛出空引用异常。
 *
 * @returns CodeMirror Extension 数组（ViewPlugin + atomicRanges）。
 * @throws 无显式异常；内部异常将降级为空装饰并记录日志。
 */
export function createFrontmatterSyntaxExtension(): Extension {
    const plugin = ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
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
                    console.error("[editor-frontmatter] build decorations failed", {
                        message: error instanceof Error ? error.message : String(error),
                    });
                    return new RangeSetBuilder<Decoration>().finish();
                }
            }

            private buildDecorations(view: EditorView): DecorationSet {
                const builder = new RangeSetBuilder<Decoration>();
                if (!isViewAlive(view)) {
                    return builder.finish();
                }

                const block = parseFrontmatterBlock(view.state);
                if (!block) {
                    /* 无 frontmatter：清空排斥区域 */
                    setExclusionZones(view, "frontmatter", []);
                    return builder.finish();
                }

                /* 声明排斥区域，供其他插件（code-fence / latex / 行级渲染器）跳过 */
                setExclusionZones(view, "frontmatter", [
                    { from: block.from, to: block.to },
                ]);

                // 通过 Decoration.line 为每行添加隐藏类，CSS 将行高设为 0。
                // 对应的 gutter 元素通过 CSS overflow:hidden 自动裁剪溢出行号。
                for (let lineNumber = block.startLineNumber; lineNumber < block.endLineNumber; lineNumber += 1) {
                    const line = view.state.doc.line(lineNumber);
                    builder.add(line.from, line.from, hiddenBlockLineDecoration);
                }

                const anchorLine = view.state.doc.line(block.endLineNumber);
                builder.add(anchorLine.from, anchorLine.from, hiddenBlockAnchorLineDecoration);

                // 在隐藏行之后插入 Widget（行内模式，避免 block widget 引发 measure 异常）。
                builder.add(
                    block.to,
                    block.to,
                    Decoration.widget({
                        widget: new FrontmatterYamlWidget(block.yamlText, (nextYamlText) =>
                            saveFrontmatterYaml(view, nextYamlText),
                        ),
                        block: false,
                        side: -1,
                    }),
                );

                return builder.finish();
            }
        },
        {
            decorations: (p) => p.decorations,
        },
    );

    // atomicRanges 阻止光标通过键盘导航进入 frontmatter 隐藏范围。
    const atomicRanges = createBlockAtomicRangesExtension((view) => {
        const block = parseFrontmatterBlock(view.state);
        if (!block) {
            return null;
        }
        return { from: block.from, to: block.to };
    });

    return [plugin, atomicRanges];
}
