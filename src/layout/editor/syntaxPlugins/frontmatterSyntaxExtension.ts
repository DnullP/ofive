/**
 * @module layout/editor/syntaxPlugins/frontmatterSyntaxExtension
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
 * @param state 编辑器状态。
 * @returns frontmatter 区块；若不存在则返回 null。
 * @throws 无显式异常；异常场景返回 null 并记录日志。
 */
function parseFrontmatterBlock(state: EditorView["state"]): FrontmatterBlock | null {
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
        const trailing = state.doc.sliceString(endLine.to, endLine.to + 1);
        const blockTo = trailing === "\n" ? endLine.to + 1 : endLine.to;

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
        const message = parsedDocument.errors[0]?.message ?? "YAML 格式错误";
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
            message: "编辑器已关闭，无法同步。",
        };
    }

    const liveBlock = parseFrontmatterBlock(view.state);
    if (!liveBlock) {
        console.warn("[editor-frontmatter] save skipped: block missing");
        return {
            success: false,
            message: "未检测到 frontmatter 区块。",
        };
    }

    try {
        const normalizedYamlText = normalizeYamlText(rawYamlText);
        const nextFrontmatterText = `---\n${normalizedYamlText}\n---\n`;

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
            message: "frontmatter 已同步到文档，保存由统一调度负责。",
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

        this.root = createRoot(wrapper);
        this.root.render(
            createElement(FrontmatterYamlVisualEditor, {
                initialYamlText: this.yamlText,
                onCommitYaml: (yamlText: string) => this.onSave(yamlText),
            }),
        );

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
 * @returns CodeMirror 视图扩展。
 * @throws 无显式异常；内部异常将降级为空装饰并记录日志。
 */
export function createFrontmatterSyntaxExtension(): ReturnType<typeof ViewPlugin.fromClass> {
    return ViewPlugin.fromClass(
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
                    return builder.finish();
                }

                // frontmatter 始终以可视化组件显示，不提供源码展开能力。
                // 编辑通过 widget 内的表单完成，修改回写到文档。

                const hiddenLineDecoration = Decoration.line({
                    class: "cm-frontmatter-source-hidden-line",
                });
                for (let lineNumber = block.startLineNumber; lineNumber <= block.endLineNumber; lineNumber += 1) {
                    const line = view.state.doc.line(lineNumber);
                    builder.add(line.from, line.from, hiddenLineDecoration);
                }

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
            decorations: (plugin) => plugin.decorations,
        },
    );
}
