/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/codeBlockHighlightExtension
 * @description 代码块内联语法高亮扩展：使用 highlight.js 为围栏代码块提供行内语法着色。
 *
 *   设计理念——代码块是文档的自然组成部分，而非独立窗口：
 *   - 代码内容行始终可见且可直接编辑，光标可通过方向键或鼠标自由进出。
 *   - 语法高亮通过 Mark 装饰施加到代码文本上，编辑时同样生效。
 *   - 围栏标记行（```）在光标不在代码块内时自动隐藏，光标进入后展开。
 *   - 代码块首行右上角提供轻量 Copy 浮动按钮。
 *
 * @dependencies
 *   - @codemirror/state
 *   - @codemirror/view
 *   - highlight.js
 *   - ./blockWidgetReplace (hiddenBlockLineDecoration)
 *
 * @example
 *   import { createCodeBlockHighlightExtension } from "./codeBlockHighlightExtension";
 *   extensions: [ createCodeBlockHighlightExtension(), ... ]
 *
 * @exports
 *   - createCodeBlockHighlightExtension — 创建代码块内联高亮 CodeMirror 扩展
 */

import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import hljs from "highlight.js";
import { hiddenBlockLineDecoration } from "./blockWidgetReplace";
import {
    setExclusionZones,
    isRangeInsideHigherPriorityZone,
} from "../syntaxExclusionZones";

/* ================================================================== */
/*  类型定义                                                           */
/* ================================================================== */

/**
 * @interface CodeBlock
 * @description 从文档中解析到的围栏代码块信息。
 *   - from / to     文档偏移范围（含首尾围栏行）
 *   - startLine / endLine  行号（1-based）
 *   - language      围栏声明的语言标识
 *   - code          代码内容（不含围栏行）
 *   - codeFrom      第一行代码内容在文档中的偏移
 */
interface CodeBlock {
    /** 代码块起始偏移（含开围栏行）。 */
    from: number;
    /** 代码块结束偏移（含关围栏行末尾）。 */
    to: number;
    /** 开围栏行号（1-based）。 */
    startLine: number;
    /** 关围栏行号（1-based）。 */
    endLine: number;
    /** 围栏声明的语言标识（如 "javascript"）；未声明时为空字符串。 */
    language: string;
    /** 代码内容文本（不含首尾围栏行）。 */
    code: string;
    /** 第一行代码内容在文档中的起始偏移。 */
    codeFrom: number;
}

/**
 * @interface CodeToken
 * @description highlight.js 解析出的单个语法 Token。
 *   偏移相对于 CodeBlock.code 字符串。
 */
interface CodeToken {
    /** Token 起始偏移（含）。 */
    from: number;
    /** Token 结束偏移（不含）。 */
    to: number;
    /** CSS 类名（如 "hljs-keyword"）。 */
    className: string;
}

/**
 * @interface DecoRange
 * @description 待排序并写入 RangeSetBuilder 的装饰范围。
 */
interface DecoRange {
    /** 文档起始偏移。 */
    from: number;
    /** 文档结束偏移。 */
    to: number;
    /** CodeMirror 装饰对象。 */
    decoration: Decoration;
}

/* ================================================================== */
/*  围栏代码块解析                                                     */
/* ================================================================== */

/** 匹配围栏开始行（```lang 或 ~~~lang） */
const FENCE_OPEN_RE = /^(`{3,}|~{3,})\s*(\S*)\s*$/;

/**
 * @function parseCodeBlocks
 * @description 从编辑器文档中解析所有围栏代码块。
 * @param state 编辑器状态。
 * @returns 代码块列表（按文档顺序）。
 */
function parseCodeBlocks(state: EditorView["state"]): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const doc = state.doc;
    const totalLines = doc.lines;

    try {
        let lineNumber = 1;
        while (lineNumber <= totalLines) {
            const line = doc.line(lineNumber);
            const openMatch = line.text.match(FENCE_OPEN_RE);
            if (!openMatch) {
                lineNumber += 1;
                continue;
            }

            const fenceChar = (openMatch[1] ?? "```").charAt(0);
            const fenceLength = (openMatch[1] ?? "```").length;
            const language = (openMatch[2] ?? "").trim();
            const startLine = lineNumber;
            const blockFrom = line.from;

            let endLine = -1;
            const codeLines: string[] = [];
            for (let ln = lineNumber + 1; ln <= totalLines; ln += 1) {
                const candidate = doc.line(ln);
                const closeRe = new RegExp(
                    `^${fenceChar === "\`" ? "`" : "~"}{${fenceLength},}\\s*$`,
                );
                if (closeRe.test(candidate.text)) {
                    endLine = ln;
                    break;
                }
                codeLines.push(candidate.text);
            }

            if (endLine < 0) {
                lineNumber += 1;
                continue;
            }

            const endLineObj = doc.line(endLine);
            const firstContentLine = startLine + 1;
            const codeFrom =
                firstContentLine < endLine
                    ? doc.line(firstContentLine).from
                    : endLineObj.from;

            blocks.push({
                from: blockFrom,
                to: endLineObj.to,
                startLine,
                endLine,
                language,
                code: codeLines.join("\n"),
                codeFrom,
            });

            lineNumber = endLine + 1;
        }
    } catch (error) {
        console.error("[code-highlight] parse failed", {
            message: error instanceof Error ? error.message : String(error),
        });
    }

    return blocks;
}

/* ================================================================== */
/*  光标位置判断                                                       */
/* ================================================================== */

/**
 * @function isCursorInsideBlock
 * @description 判断光标/选区是否处于代码块范围内。
 * @param view 编辑器视图。
 * @param block 代码块。
 * @returns 光标在块内时返回 true。
 */
function isCursorInsideBlock(view: EditorView, block: CodeBlock): boolean {
    if (!view.hasFocus) {
        return false;
    }
    return view.state.selection.ranges.some((range) => {
        if (range.empty) {
            return range.from >= block.from && range.from <= block.to;
        }
        return range.from <= block.to && range.to >= block.from;
    });
}

/* ================================================================== */
/*  highlight.js 高亮 + Token 解析                                     */
/* ================================================================== */

/**
 * @function highlightToHtml
 * @description 使用 highlight.js 生成高亮 HTML。
 * @param code 代码文本。
 * @param language 语言标识（可为空）。
 * @returns 高亮 HTML 字符串。
 */
function highlightToHtml(code: string, language: string): string {
    if (language && hljs.getLanguage(language)) {
        try {
            return hljs.highlight(code, { language }).value;
        } catch {
            /* 降级 */
        }
    }
    try {
        return hljs.highlightAuto(code).value;
    } catch {
        return code
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }
}

/**
 * @function parseHljsTokens
 * @description 解析 highlight.js HTML 输出为 CodeToken 列表。
 *   通过栈式解析处理嵌套 `<span>` 和 HTML 实体。
 * @param html highlight.js 输出的 HTML 字符串。
 * @returns Token 列表（偏移相对于原始代码文本）。
 */
function parseHljsTokens(html: string): CodeToken[] {
    const tokens: CodeToken[] = [];
    const classStack: string[] = [];
    let textPos = 0;
    let i = 0;

    while (i < html.length) {
        const ch = html.charCodeAt(i);

        if (ch === 60) {
            /* '<' — 标签 */
            const gt = html.indexOf(">", i);
            if (gt < 0) break;
            const tag = html.substring(i + 1, gt);
            if (tag.charCodeAt(0) === 47) {
                /* 闭合标签 </span> */
                classStack.pop();
            } else {
                /* 开标签 <span class="..."> */
                const m = tag.match(/class="([^"]+)"/);
                classStack.push(m ? m[1] : "");
            }
            i = gt + 1;
        } else if (ch === 38) {
            /* '&' — HTML 实体（&lt; &gt; &amp; &quot;） */
            const semi = html.indexOf(";", i);
            if (semi < 0) break;
            const cls =
                classStack.length > 0
                    ? classStack[classStack.length - 1]
                    : "";
            if (cls) {
                tokens.push({ from: textPos, to: textPos + 1, className: cls });
            }
            textPos += 1;
            i = semi + 1;
        } else {
            /* 普通文本字符 */
            const cls =
                classStack.length > 0
                    ? classStack[classStack.length - 1]
                    : "";
            const start = textPos;
            while (
                i < html.length &&
                html.charCodeAt(i) !== 60 &&
                html.charCodeAt(i) !== 38
            ) {
                textPos += 1;
                i += 1;
            }
            if (cls && textPos > start) {
                tokens.push({ from: start, to: textPos, className: cls });
            }
        }
    }

    /* 合并相邻同类 Token */
    const merged: CodeToken[] = [];
    for (const tok of tokens) {
        const last = merged.length > 0 ? merged[merged.length - 1] : null;
        if (last && last.to === tok.from && last.className === tok.className) {
            last.to = tok.to;
        } else {
            merged.push({ from: tok.from, to: tok.to, className: tok.className });
        }
    }
    return merged;
}

/* Token 缓存：以 "language\0code" 为键，避免重复高亮计算 */
const tokenCache = new Map<string, CodeToken[]>();

/**
 * @function getTokens
 * @description 获取代码的语法 Token（带缓存）。
 * @param code 代码文本。
 * @param language 语言标识。
 * @returns Token 列表。
 */
function getTokens(code: string, language: string): CodeToken[] {
    const key = `${language}\0${code}`;
    const cached = tokenCache.get(key);
    if (cached) return cached;

    const tokens = parseHljsTokens(highlightToHtml(code, language));
    tokenCache.set(key, tokens);

    /* 限制缓存大小 */
    if (tokenCache.size > 200) {
        const first = tokenCache.keys().next().value;
        if (first !== undefined) tokenCache.delete(first);
    }
    return tokens;
}

/* ================================================================== */
/*  Copy 按钮 Widget                                                  */
/* ================================================================== */

/**
 * @class CopyButtonWidget
 * @description 代码块 Copy 按钮：以 float:right 悬浮在首行右上角。
 *   - code  待复制的代码文本
 */
class CopyButtonWidget extends WidgetType {
    /** 待复制的代码文本。 */
    private readonly code: string;

    constructor(code: string) {
        super();
        this.code = code;
    }

    eq(other: CopyButtonWidget): boolean {
        return this.code === other.code;
    }

    /**
     * @method toDOM
     * @description 创建 Copy 按钮 DOM。
     *   样式类：cm-code-block-copy-btn
     */
    toDOM(): HTMLElement {
        const btn = document.createElement("button");
        /* 样式类：cm-code-block-copy-btn（float:right 悬浮） */
        btn.className = "cm-code-block-copy-btn";
        btn.textContent = "Copy";
        btn.type = "button";
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            void navigator.clipboard.writeText(this.code).then(() => {
                btn.textContent = "Copied!";
                setTimeout(() => {
                    btn.textContent = "Copy";
                }, 2000);
            });
        });
        return btn;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

/* ================================================================== */
/*  Decoration.line 常量                                               */
/* ================================================================== */

/** 代码内容行装饰：等宽字体 + 背景色 */
const codeBlockLineDeco = Decoration.line({ class: "cm-code-block-line" });

/** 代码内容首行装饰：padding-top 留白 + position:relative 供 Copy 按钮定位 */
const codeBlockFirstLineDeco = Decoration.line({
    class: "cm-code-block-line cm-code-block-first-line",
});

/** 代码内容末行装饰：padding-bottom 留白 */
const codeBlockLastLineDeco = Decoration.line({
    class: "cm-code-block-line cm-code-block-last-line",
});

/** 代码块仅一行时首末合一装饰 */
const codeBlockOnlyLineDeco = Decoration.line({
    class: "cm-code-block-line cm-code-block-first-line cm-code-block-last-line",
});

/** 围栏行可见态装饰：光标在块内时展示的柔和样式 */
const fenceVisibleDeco = Decoration.line({ class: "cm-code-fence-visible" });

/* ================================================================== */
/*  扩展工厂                                                           */
/* ================================================================== */

/**
 * @function isViewAlive
 * @description 编辑器 DOM 是否仍挂载。
 */
function isViewAlive(view: EditorView): boolean {
    return view.dom.isConnected;
}

/**
 * @function createCodeBlockHighlightExtension
 * @description 创建代码块内联高亮 CodeMirror 扩展。
 *
 *   机制：
 *   1. ViewPlugin 在文档/选区/视口/焦点变化时重新构建装饰。
 *   2. 代码内容行始终可见，通过 Decoration.line 施加背景和等宽字体。
 *   3. 通过 Decoration.mark 将 highlight.js Token 映射为行内着色 span。
 *   4. 围栏行在光标不在块内时通过 hiddenBlockLineDecoration 隐藏，进入时恢复。
 *   5. 首行通过 Decoration.widget 插入 float:right 的 Copy 按钮。
 *   6. 不使用 atomicRanges，光标可自由通过方向键进出代码块。
 *
 * @returns CodeMirror Extension。
 */
export function createCodeBlockHighlightExtension(): Extension {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = this.safeBuild(view);
            }

            update(update: ViewUpdate): void {
                if (
                    update.docChanged ||
                    update.selectionSet ||
                    update.viewportChanged ||
                    update.focusChanged
                ) {
                    this.decorations = this.safeBuild(update.view);
                }
            }

            private safeBuild(view: EditorView): DecorationSet {
                try {
                    return this.build(view);
                } catch (error) {
                    console.error("[code-highlight] build failed", {
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                    return new RangeSetBuilder<Decoration>().finish();
                }
            }

            /**
             * 构建所有代码块的装饰集合。
             * 收集 → 排序 → 写入 RangeSetBuilder。
             */
            private build(view: EditorView): DecorationSet {
                if (!isViewAlive(view)) {
                    return new RangeSetBuilder<Decoration>().finish();
                }

                const allBlocks = parseCodeBlocks(view.state);
                if (allBlocks.length === 0) {
                    setExclusionZones(view, "code-fence", []);
                    return new RangeSetBuilder<Decoration>().finish();
                }

                /* 过滤掉被更高优先级排斥区域（如 frontmatter）覆盖的代码块 */
                const blocks = allBlocks.filter(
                    (b) =>
                        !isRangeInsideHigherPriorityZone(
                            view,
                            b.from,
                            b.to,
                            "code-fence",
                        ),
                );

                /* 声明排斥区域，供 latex / 行级渲染器跳过 */
                setExclusionZones(
                    view,
                    "code-fence",
                    blocks.map((b) => ({ from: b.from, to: b.to })),
                );

                if (blocks.length === 0) {
                    return new RangeSetBuilder<Decoration>().finish();
                }

                const ranges: DecoRange[] = [];
                const doc = view.state.doc;

                for (const block of blocks) {
                    const cursorIn = isCursorInsideBlock(view, block);
                    const openLine = doc.line(block.startLine);
                    const closeLine = doc.line(block.endLine);
                    const firstContent = block.startLine + 1;
                    const lastContent = block.endLine - 1;

                    /* ---- 围栏行 ---- */
                    if (cursorIn) {
                        /* 光标在块内：围栏可见，施加柔和样式 */
                        ranges.push({
                            from: openLine.from,
                            to: openLine.from,
                            decoration: fenceVisibleDeco,
                        });
                        ranges.push({
                            from: closeLine.from,
                            to: closeLine.from,
                            decoration: fenceVisibleDeco,
                        });
                    } else {
                        /* 光标在块外：围栏隐藏（height:0） */
                        ranges.push({
                            from: openLine.from,
                            to: openLine.from,
                            decoration: hiddenBlockLineDecoration,
                        });
                        ranges.push({
                            from: closeLine.from,
                            to: closeLine.from,
                            decoration: hiddenBlockLineDecoration,
                        });
                    }

                    /* ---- 代码内容行：背景 + 等宽字体 + 首尾留白 ---- */
                    for (let ln = firstContent; ln <= lastContent; ln += 1) {
                        const line = doc.line(ln);
                        let deco: Decoration;
                        if (firstContent === lastContent) {
                            /* 仅一行内容：首末合一 */
                            deco = codeBlockOnlyLineDeco;
                        } else if (ln === firstContent) {
                            deco = codeBlockFirstLineDeco;
                        } else if (ln === lastContent) {
                            deco = codeBlockLastLineDeco;
                        } else {
                            deco = codeBlockLineDeco;
                        }
                        ranges.push({
                            from: line.from,
                            to: line.from,
                            decoration: deco,
                        });
                    }

                    /* ---- Copy 按钮（首行 widget） ---- */
                    if (firstContent <= lastContent) {
                        const firstLine = doc.line(firstContent);
                        ranges.push({
                            from: firstLine.from,
                            to: firstLine.from,
                            decoration: Decoration.widget({
                                widget: new CopyButtonWidget(block.code),
                                side: -1,
                            }),
                        });
                    }

                    /* ---- 语法 Token Mark 装饰 ---- */
                    if (block.code.length > 0 && firstContent <= lastContent) {
                        const tokens = getTokens(block.code, block.language);
                        const codeStart = block.codeFrom;
                        for (const tok of tokens) {
                            const from = codeStart + tok.from;
                            const to = codeStart + tok.to;
                            if (from >= 0 && to <= doc.length && from < to) {
                                ranges.push({
                                    from,
                                    to,
                                    decoration: Decoration.mark({
                                        class: tok.className,
                                    }),
                                });
                            }
                        }
                    }
                }

                /* 按文档位置排序后写入 builder */
                ranges.sort((a, b) => a.from - b.from || a.to - b.to);
                const builder = new RangeSetBuilder<Decoration>();
                for (const r of ranges) {
                    builder.add(r.from, r.to, r.decoration);
                }
                return builder.finish();
            }
        },
        { decorations: (p) => p.decorations },
    );
}
