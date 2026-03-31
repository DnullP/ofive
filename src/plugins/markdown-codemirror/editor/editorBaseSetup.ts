/**
 * @module plugins/markdown-codemirror/editor/editorBaseSetup
 * @description 项目内统一维护的 CodeMirror 基础扩展集合。
 *   该模块复制 `codemirror` 包内 `basicSetup` 的核心能力，但移除了默认
 *   `lineNumbers()`，以便由业务层通过独立 Compartment 统一控制
 *   `off | absolute | relative` 三种行号模式，避免默认绝对行号与相对行号扩展冲突。
 *
 * @dependencies
 *  - @codemirror/state
 *  - @codemirror/view
 *  - @codemirror/language
 *  - @codemirror/commands
 *  - @codemirror/search
 *  - @codemirror/autocomplete
 *  - @codemirror/lint
 *
 * @usage
 * ```ts
 * import { editorBaseSetup } from "./editorBaseSetup";
 *
 * const state = EditorState.create({
 *   doc: "# Demo",
 *   extensions: [
 *     editorBaseSetup,
 *     lineNumbersCompartment.of(buildLineNumbersExtension("absolute")),
 *   ],
 * });
 * ```
 *
 * @exports
 *  - editorBaseSetup - 不包含默认行号的基础编辑器扩展集合
 */

import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import {
    crosshairCursor,
    drawSelection,
    dropCursor,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    rectangularSelection,
} from "@codemirror/view";
import {
    bracketMatching,
    defaultHighlightStyle,
    foldGutter,
    foldKeymap,
    indentOnInput,
    syntaxHighlighting,
} from "@codemirror/language";
import {
    defaultKeymap,
    history,
    historyKeymap,
} from "@codemirror/commands";
import {
    highlightSelectionMatches,
    searchKeymap,
} from "@codemirror/search";
import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
} from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";

/**
 * @constant editorBaseSetup
 * @description 不包含默认 `lineNumbers()` 的基础编辑器扩展。
 *   保留 active line gutter 高亮，以便在绝对/相对行号模式下仍维持当前行 gutter 高亮样式。
 */
export const editorBaseSetup: Extension = [
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
    ]),
];