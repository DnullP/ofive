/**
 * @module plugins/markdown-codemirror/editor/markdownFormattingCommands
 * @description Markdown 格式编辑命令集合：提供加粗、斜体、删除线、行内代码、高亮、链接等格式切换能力。
 *
 *   每个命令支持两种使用方式：
 *   1. **有选区**：对选中文本包裹 / 移除格式标记
 *   2. **无选区**：对光标所在的"当前词"包裹 / 移除格式标记
 *
 *   "当前词"的判定：从光标位置向两侧扫描至空白字符或行首/行尾。
 *
 * @dependencies
 *  - codemirror (EditorView)
 *
 * @exports
 *  - toggleBold         — 切换加粗 `**text**`
 *  - toggleItalic       — 切换斜体 `*text*`
 *  - toggleStrikethrough — 切换删除线 `~~text~~`
 *  - toggleInlineCode   — 切换行内代码 `` `text` ``
 *  - toggleHighlight    — 切换高亮 `==text==`
 *  - insertLink         — 插入/包裹链接 `[text](url)`
 *  - insertTask         — 在当前光标或选区快速创建任务 `- [ ] content`
 *  - insertFrontmatter  — 若文档缺少 frontmatter，则在顶部插入空 frontmatter 模板
 */

import type { EditorView } from "codemirror";

/* ================================================================== */
/*  内部工具函数                                                       */
/* ================================================================== */

/**
 * @function resolveWordRange
 * @description 从光标位置向两侧扩展到"当前词"边界（非空白字符序列）。
 * @param view 编辑器视图。
 * @returns [from, to] 词范围；若光标在空白处返回 [cursor, cursor]。
 */
function resolveWordRange(view: EditorView): [number, number] {
    const cursor = view.state.selection.main.head;
    const line = view.state.doc.lineAt(cursor);
    const lineOffset = cursor - line.from;
    const text = line.text;

    /* 光标在空白处 → 空范围 */
    if (lineOffset > 0 && lineOffset <= text.length) {
        const charBefore = text.charAt(lineOffset - 1);
        const charAfter = lineOffset < text.length ? text.charAt(lineOffset) : " ";
        if (/\s/.test(charBefore) && /\s/.test(charAfter)) {
            return [cursor, cursor];
        }
    }

    let wordStart = lineOffset;
    while (wordStart > 0 && !/\s/.test(text.charAt(wordStart - 1))) {
        wordStart -= 1;
    }

    let wordEnd = lineOffset;
    while (wordEnd < text.length && !/\s/.test(text.charAt(wordEnd))) {
        wordEnd += 1;
    }

    return [line.from + wordStart, line.from + wordEnd];
}

/**
 * @function resolveLineIndent
 * @description 提取当前行的前导缩进，供任务模板复用。
 * @param text 当前行文本。
 * @returns 前导空白字符串。
 */
function resolveLineIndent(text: string): string {
    const match = text.match(/^(\s*)/);
    return match?.[1] ?? "";
}

/**
 * @function resolveTaskContentInsertRange
 * @description 计算快速创建任务时应替换的文本范围与初始正文。
 *   - 有选区：使用选区文本作为任务正文
 *   - 空选区且当前行非空：使用整行文本作为任务正文
 *   - 空选区且当前行为空：插入占位正文 `task`
 * @param view 编辑器视图。
 * @returns 任务替换范围、缩进与正文。
 */
function resolveTaskContentInsertRange(view: EditorView): {
    from: number;
    to: number;
    indent: string;
    content: string;
    shouldSelectPlaceholder: boolean;
} {
    const selection = view.state.selection.main;

    if (!selection.empty) {
        const selectedText = view.state.doc.sliceString(selection.from, selection.to).trim();
        return {
            from: selection.from,
            to: selection.to,
            indent: "",
            content: selectedText || "task",
            shouldSelectPlaceholder: selectedText.length === 0,
        };
    }

    const line = view.state.doc.lineAt(selection.head);
    const indent = resolveLineIndent(line.text);
    const trimmedLine = line.text.trim();
    if (trimmedLine.length > 0) {
        return {
            from: line.from,
            to: line.to,
            indent,
            content: trimmedLine,
            shouldSelectPlaceholder: false,
        };
    }

    return {
        from: line.from,
        to: line.to,
        indent,
        content: "task",
        shouldSelectPlaceholder: true,
    };
}

/**
 * @function hasFrontmatterBlock
 * @description 判断文档顶部是否已存在 frontmatter 区块。
 * @param docText 当前文档全文。
 * @returns 若检测到合法开头 frontmatter，返回 true。
 */
function hasFrontmatterBlock(docText: string): boolean {
    const lines = docText.split("\n");
    if (lines.length < 2 || lines[0]?.trim() !== "---") {
        return false;
    }

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
        if (lines[lineIndex]?.trim() === "---") {
            return true;
        }
    }

    return false;
}

/**
 * @function toggleDelimiter
 * @description 通用分隔符切换逻辑：如果已被包裹则移除，否则添加。
 * @param view 编辑器视图。
 * @param delimiter 分隔符字符串（如 `**`、`*`、`~~`、`` ` ``、`==`）。
 * @returns 是否成功执行。
 */
function toggleDelimiter(view: EditorView, delimiter: string): boolean {
    const selection = view.state.selection.main;
    const dLen = delimiter.length;

    let from: number;
    let to: number;

    if (selection.empty) {
        [from, to] = resolveWordRange(view);
    } else {
        from = selection.from;
        to = selection.to;
    }

    const selectedText = view.state.doc.sliceString(from, to);

    /* 检查是否已经被包裹：选区内部包含分隔符 */
    if (
        selectedText.length >= dLen * 2 &&
        selectedText.startsWith(delimiter) &&
        selectedText.endsWith(delimiter)
    ) {
        /* 移除内部分隔符 */
        const inner = selectedText.slice(dLen, selectedText.length - dLen);
        view.dispatch({
            changes: { from, to, insert: inner },
            selection: { anchor: from, head: from + inner.length },
        });
        return true;
    }

    /* 检查外部是否已包裹 */
    const outerFrom = from - dLen;
    const outerTo = to + dLen;
    if (
        outerFrom >= 0 &&
        outerTo <= view.state.doc.length &&
        view.state.doc.sliceString(outerFrom, from) === delimiter &&
        view.state.doc.sliceString(to, outerTo) === delimiter
    ) {
        /* 移除外部分隔符 */
        view.dispatch({
            changes: [
                { from: outerFrom, to: from, insert: "" },
                { from: to, to: outerTo, insert: "" },
            ],
            selection: { anchor: outerFrom, head: outerFrom + (to - from) },
        });
        return true;
    }

    /* 添加分隔符 */
    if (from === to) {
        /* 空选区：插入分隔符对并将光标放在中间 */
        const insertText = delimiter + delimiter;
        view.dispatch({
            changes: { from, to, insert: insertText },
            selection: { anchor: from + dLen },
        });
    } else {
        const wrappedText = delimiter + selectedText + delimiter;
        view.dispatch({
            changes: { from, to, insert: wrappedText },
            selection: { anchor: from + dLen, head: from + dLen + selectedText.length },
        });
    }

    return true;
}

/* ================================================================== */
/*  导出命令函数                                                       */
/* ================================================================== */

/**
 * @function toggleBold
 * @description 切换加粗格式 `**text**`。
 * @param view 编辑器视图。
 * @returns 是否执行成功。
 */
export function toggleBold(view: EditorView): boolean {
    return toggleDelimiter(view, "**");
}

/**
 * @function toggleItalic
 * @description 切换斜体格式 `*text*`。
 * @param view 编辑器视图。
 * @returns 是否执行成功。
 */
export function toggleItalic(view: EditorView): boolean {
    return toggleDelimiter(view, "*");
}

/**
 * @function toggleStrikethrough
 * @description 切换删除线格式 `~~text~~`。
 * @param view 编辑器视图。
 * @returns 是否执行成功。
 */
export function toggleStrikethrough(view: EditorView): boolean {
    return toggleDelimiter(view, "~~");
}

/**
 * @function toggleInlineCode
 * @description 切换行内代码格式 `` `text` ``。
 * @param view 编辑器视图。
 * @returns 是否执行成功。
 */
export function toggleInlineCode(view: EditorView): boolean {
    return toggleDelimiter(view, "`");
}

/**
 * @function toggleHighlight
 * @description 切换高亮格式 `==text==`。
 * @param view 编辑器视图。
 * @returns 是否执行成功。
 */
export function toggleHighlight(view: EditorView): boolean {
    return toggleDelimiter(view, "==");
}

/**
 * @function insertLink
 * @description 插入或包裹链接格式 `[text](url)`。
 *   有选区时将选中文本作为链接文字：`[selected](url)`，光标定位到 url 位置。
 *   无选区时插入 `[](url)` 模板，光标定位到链接文字位置。
 * @param view 编辑器视图。
 * @returns 是否执行成功。
 */
export function insertLink(view: EditorView): boolean {
    const selection = view.state.selection.main;

    if (selection.empty) {
        const template = "[](url)";
        view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: template },
            selection: { anchor: selection.from + 1 },
        });
    } else {
        const selectedText = view.state.doc.sliceString(selection.from, selection.to);
        const wrapped = `[${selectedText}](url)`;
        const urlStart = selection.from + 1 + selectedText.length + 2; // after `[text](`
        view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: wrapped },
            selection: { anchor: urlStart, head: urlStart + 3 }, // select "url"
        });
    }

    return true;
}

/**
 * @function insertTask
 * @description 在当前光标位置快速创建任务看板语法。
 *   有选区时使用选中文本作为任务正文；当前行已有内容时将整行转换为任务；
 *   否则插入 `task` 占位符并选中，便于立即改写。
 * @param view 编辑器视图。
 * @returns 是否执行成功。
 */
export function insertTask(view: EditorView): boolean {
    const resolved = resolveTaskContentInsertRange(view);
    const insertText = `${resolved.indent}- [ ] ${resolved.content}`;
    const contentStart = resolved.indent.length + "- [ ] ".length;
    const contentEnd = contentStart + resolved.content.length;

    view.dispatch({
        changes: {
            from: resolved.from,
            to: resolved.to,
            insert: insertText,
        },
        selection: resolved.shouldSelectPlaceholder
            ? {
                anchor: resolved.from + contentStart,
                head: resolved.from + contentEnd,
            }
            : {
                anchor: resolved.from + insertText.length,
            },
    });

    return true;
}

/**
 * @function insertFrontmatter
 * @description 若当前文档缺少 frontmatter，则在文档顶部插入空 frontmatter 模板。
 *   已存在 frontmatter 时不修改正文。
 * @param view 编辑器视图。
 * @returns 是否完成处理。
 */
export function insertFrontmatter(view: EditorView): boolean {
    const docText = view.state.doc.sliceString(0, view.state.doc.length);
    if (hasFrontmatterBlock(docText)) {
        return true;
    }

    const insertText = "---\n\n---\n\n";
    view.dispatch({
        changes: {
            from: 0,
            to: 0,
            insert: insertText,
        },
        selection: {
            anchor: insertText.length,
        },
    });

    return true;
}
