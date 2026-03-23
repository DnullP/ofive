/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/listSyntaxRenderer
 * @description Markdown 列表行语法渲染插件：支持无序列表、有序列表与 task list。
 *   非编辑态下将列表 marker 替换为可视化 marker widget，并为内容区添加列表样式。
 * @dependencies
 *  - @codemirror/view
 *  - ../syntaxRenderRegistry
 *
 * @example
 *   registerListSyntaxRenderer();
 *
 * @exports
 *   - detectMarkdownListLine 解析单行列表语法
 *   - registerListSyntaxRenderer 注册列表渲染器
 */

import { type EditorSelection, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import {
    pushSyntaxDecorationRange,
    rangeIntersectsSelection,
    registerLineSyntaxRenderer,
} from "../syntaxRenderRegistry";

/**
 * @type MarkdownListKind
 * @description Markdown 列表类型。
 */
export type MarkdownListKind = "unordered" | "ordered" | "task";

/**
 * @type MarkdownTaskState
 * @description Task list 勾选状态。
 */
export type MarkdownTaskState = "checked" | "unchecked";

/**
 * @interface MarkdownListLineMatch
 * @description 单行 Markdown 列表解析结果。
 */
export interface MarkdownListLineMatch {
    /** 列表类型。 */
    kind: MarkdownListKind;
    /** 行首缩进文本。 */
    indentText: string;
    /** 原始列表 marker，如 `-`、`1.`。 */
    markerText: string;
    /** marker 在行内的起始位置。 */
    markerStart: number;
    /** 内容区在行内的起始位置。 */
    contentStart: number;
    /** task list 勾选状态；非 task list 为 null。 */
    taskState: MarkdownTaskState | null;
    /** task state 字符（空格或 x）在行内的起始位置；非 task list 为 null。 */
    taskStateMarkerStart: number | null;
}

/**
 * @interface TaskCheckboxToggleSpec
 * @description task checkbox 切换所需的最小事务描述。
 */
export interface TaskCheckboxToggleSpec {
    /** 需要替换的状态字符起始偏移。 */
    from: number;
    /** 需要替换的状态字符结束偏移。 */
    to: number;
    /** 切换后的状态字符。 */
    insert: " " | "x";
    /** 切换后应恢复的原 selection。 */
    selection: EditorSelection;
}

const LIST_LINE_PATTERN = /^(\s*)(\d{1,9}[.)]|[*+-])(\s+)(?:\[([ xX])\](\s+))?(.*)$/;

/**
 * @class ListMarkerWidget
 * @description 列表 marker widget：将源码 marker 渲染为更稳定的可视化标记。
 */
class ListMarkerWidget extends WidgetType {
    private readonly kind: MarkdownListKind;
    private readonly markerText: string;
    private readonly taskState: MarkdownTaskState | null;

    constructor(
        kind: MarkdownListKind,
        markerText: string,
        taskState: MarkdownTaskState | null,
    ) {
        super();
        this.kind = kind;
        this.markerText = markerText;
        this.taskState = taskState;
    }

    eq(other: ListMarkerWidget): boolean {
        return (
            this.kind === other.kind &&
            this.markerText === other.markerText &&
            this.taskState === other.taskState
        );
    }

    toDOM(): HTMLElement {
        const wrapperElement = document.createElement("span");
        wrapperElement.className = [
            "cm-rendered-list-marker",
            `cm-rendered-list-marker-${this.kind}`,
        ].join(" ");

        if (this.kind === "unordered") {
            const bulletElement = document.createElement("span");
            bulletElement.className = "cm-rendered-list-bullet";
            wrapperElement.appendChild(bulletElement);
            return wrapperElement;
        }

        if (this.kind === "ordered") {
            wrapperElement.textContent = this.markerText;
            return wrapperElement;
        }

        const checkboxElement = document.createElement("span");
        checkboxElement.className = [
            "cm-rendered-task-checkbox",
            this.taskState === "checked"
                ? "cm-rendered-task-checkbox-checked"
                : "cm-rendered-task-checkbox-unchecked",
        ].join(" ");
        wrapperElement.appendChild(checkboxElement);
        return wrapperElement;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * @function detectMarkdownListLine
 * @description 解析单行 Markdown 列表语法，提取 marker 与内容区边界。
 * @param lineText 当前行文本。
 * @returns 若匹配列表语法则返回解析结果，否则返回 null。
 */
export function detectMarkdownListLine(lineText: string): MarkdownListLineMatch | null {
    const match = lineText.match(LIST_LINE_PATTERN);
    if (!match) {
        return null;
    }

    const indentText = match[1] ?? "";
    const markerText = match[2] ?? "";
    const spaceAfterMarker = match[3] ?? " ";
    const taskMarkerState = match[4] ?? null;
    const spaceAfterTaskMarker = match[5] ?? "";
    const contentText = match[6] ?? "";
    if (contentText.length === 0) {
        return null;
    }

    const taskState = taskMarkerState === null
        ? null
        : taskMarkerState.toLowerCase() === "x"
            ? "checked"
            : "unchecked";
    const markerStart = indentText.length;
    const taskStateMarkerStart = taskMarkerState === null
        ? null
        : markerStart + markerText.length + spaceAfterMarker.length + 1;
    const contentStart = markerStart
        + markerText.length
        + spaceAfterMarker.length
        + (taskMarkerState === null ? 0 : 3 + spaceAfterTaskMarker.length);

    return {
        kind: taskState === null
            ? /^\d/.test(markerText)
                ? "ordered"
                : "unordered"
            : "task",
        indentText,
        markerText,
        markerStart,
        contentStart,
        taskState,
        taskStateMarkerStart,
    };
}

/**
 * @function buildTaskCheckboxToggleSpec
 * @description 根据点击位置所在行构造 task checkbox 切换事务。
 * @param state 编辑器状态。
 * @param position 点击所在的文档偏移。
 * @returns 若当前位置命中 task list，则返回切换事务；否则返回 null。
 */
export function buildTaskCheckboxToggleSpec(
    state: EditorState,
    position: number,
): TaskCheckboxToggleSpec | null {
    const line = state.doc.lineAt(position);
    const listMatch = detectMarkdownListLine(line.text);
    if (!listMatch || listMatch.kind !== "task" || listMatch.taskStateMarkerStart === null) {
        return null;
    }

    const markerOffset = line.from + listMatch.taskStateMarkerStart;
    return {
        from: markerOffset,
        to: markerOffset + 1,
        insert: listMatch.taskState === "checked" ? " " : "x",
        selection: state.selection,
    };
}

/**
 * @function toggleTaskCheckboxAtPosition
 * @description 切换指定位置所在 task list 的勾选状态，并保留当前 selection。
 * @param view 编辑器视图。
 * @param position 点击所在的文档偏移。
 * @returns 若成功切换返回 true，否则返回 false。
 */
export function toggleTaskCheckboxAtPosition(
    view: EditorView,
    position: number,
): boolean {
    const toggleSpec = buildTaskCheckboxToggleSpec(view.state, position);
    if (!toggleSpec) {
        return false;
    }

    view.dispatch({
        changes: {
            from: toggleSpec.from,
            to: toggleSpec.to,
            insert: toggleSpec.insert,
        },
        selection: toggleSpec.selection,
        userEvent: "input.toggleTaskCheckbox",
    });
    return true;
}

/**
 * @function createTaskCheckboxToggleExtension
 * @description 创建 task checkbox 点击切换扩展。
 *   通过拦截 mousedown 避免浏览器默认选区更新，从而保持当前光标位置不变。
 * @returns CodeMirror DOM 事件扩展。
 */
export function createTaskCheckboxToggleExtension(): ReturnType<typeof EditorView.domEventHandlers> {
    return EditorView.domEventHandlers({
        mousedown(event, view) {
            if (event.button !== 0) {
                return false;
            }

            const eventTarget = event.target;
            if (!(eventTarget instanceof Element)) {
                return false;
            }

            const checkboxElement = eventTarget.closest(".cm-rendered-task-checkbox");
            if (!checkboxElement) {
                return false;
            }

            const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (position === null) {
                return false;
            }

            const toggled = toggleTaskCheckboxAtPosition(view, position);
            if (!toggled) {
                return false;
            }

            event.preventDefault();
            return true;
        },
    });
}

/**
 * @function buildListContentClassName
 * @description 按列表类型生成内容区样式类。
 * @param match 列表匹配结果。
 * @returns 内容区 className。
 */
function buildListContentClassName(match: MarkdownListLineMatch): string {
    const classNames = ["cm-rendered-list-item"];
    if (match.kind === "ordered") {
        classNames.push("cm-rendered-list-item-ordered");
    }
    if (match.kind === "unordered") {
        classNames.push("cm-rendered-list-item-unordered");
    }
    if (match.kind === "task") {
        classNames.push("cm-rendered-task-list-item");
        if (match.taskState === "checked") {
            classNames.push("cm-rendered-task-list-item-checked");
        }
    }
    return classNames.join(" ");
}

/**
 * @function registerListSyntaxRenderer
 * @description 注册 Markdown 列表渲染插件。
 *   编辑态下回退源码，非编辑态下将 marker 替换为列表 widget。
 */
export function registerListSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "list-line",
        applyLineDecorations(context) {
            const listMatch = detectMarkdownListLine(context.lineText);
            if (!listMatch) {
                return;
            }

            const lineEnd = context.lineFrom + context.lineText.length;
            const isEditing =
                context.view.hasFocus &&
                rangeIntersectsSelection(context.view, context.lineFrom, lineEnd);
            if (isEditing) {
                return;
            }

            const markerFrom = context.lineFrom + listMatch.markerStart;
            const contentFrom = context.lineFrom + listMatch.contentStart;

            pushSyntaxDecorationRange(
                context.ranges,
                markerFrom,
                contentFrom,
                Decoration.replace({
                    widget: new ListMarkerWidget(
                        listMatch.kind,
                        listMatch.markerText,
                        listMatch.taskState,
                    ),
                }),
            );

            pushSyntaxDecorationRange(
                context.ranges,
                contentFrom,
                lineEnd,
                Decoration.mark({ class: buildListContentClassName(listMatch) }),
            );
        },
    });
}