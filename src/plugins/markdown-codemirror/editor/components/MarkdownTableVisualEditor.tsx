/**
 * @module plugins/markdown-codemirror/editor/components/MarkdownTableVisualEditor
 * @description Markdown 表格可视化编辑组件：提供单元格编辑、行列增删与局部快捷键。
 * @dependencies
 *  - react
 *  - ../../../../i18n
 *  - ../markdownTableModel
 *  - ../markdownTableWidgetRegistry
 *  - ./MarkdownTableVisualEditor.css
 *
 * @example
 *   <MarkdownTableVisualEditor
 *     initialModel={model}
 *     onCommitMarkdown={(markdown) => ({ success: true, message: markdown })}
 *   />
 */

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type FocusEvent,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
} from "react";
import type { WorkbenchContainerApi } from "../../../../host/layout/workbenchContracts";
import { useTranslation } from "react-i18next";
import {
    suggestWikiLinkTargets,
    type WikiLinkSuggestionItem,
} from "../../../../api/vaultApi";
import {
    clearFocusedMarkdownTableEditor,
    setFocusedMarkdownTableEditor,
    type FocusedMarkdownTableEditor,
} from "../markdownTableWidgetRegistry";
import {
    deleteMarkdownTableColumnAt,
    deleteMarkdownTableRowAt,
    insertMarkdownTableColumnAt,
    insertMarkdownTableRowAt,
    serializeMarkdownTable,
    updateMarkdownTableCell,
    type MarkdownTableCellPosition,
    type MarkdownTableModel,
} from "../markdownTableModel";
import {
    detectOpenWikiLink,
    resolveWikiLinkSuggestionAcceptanceAtCursor,
    type OpenWikiLinkMatch,
} from "../editPlugins/wikilinkSuggestUtils";
import { shouldSkipWikiLinkNavigationForSelection } from "../readModeSelectionPolicy";
import { openWikiLinkTarget } from "../syntaxPlugins/wikiLinkSyntaxRenderer";
import { parseWikiLinkParts } from "../syntaxPlugins/wikiLinkParser";
import {
    createImeCompositionGuard,
    isImeComposing,
    shouldSubmitPlainEnter,
} from "../../../../utils/imeInputGuard";
import "./MarkdownTableVisualEditor.css";

const TABLE_WIDGET_EDITOR_FOCUS_CLASS = "cm-table-widget-focused";
const WIKILINK_SUGGEST_DEBOUNCE_MS = 150;
const WIKILINK_SUGGEST_MAX_ITEMS = 15;
const TABLE_CELL_LINK_PATTERN = /(\[\[([^\]\n]+?)\]\])|(?<!!)\[([^\]]+?)\]\(([^)]+?)\)/g;

/**
 * @type TableCellPreviewSegment
 * @description 单元格预览态的文本分段。
 */
type TableCellPreviewSegment =
    | {
        kind: "text";
        text: string;
    }
    | {
        kind: "wikilink";
        text: string;
        target: string;
    }
    | {
        kind: "link";
        text: string;
        href: string;
    };

/**
 * @interface TableWikiLinkSuggestState
 * @description 表格单元格内的 WikiLink 补全状态。
 */
interface TableWikiLinkSuggestState {
    /** 补全面板是否激活。 */
    active: boolean;
    /** 当前所属单元格键。 */
    cellKey: string | null;
    /** 当前查询关键字。 */
    query: string;
    /** 候选条目。 */
    items: WikiLinkSuggestionItem[];
    /** 当前选中候选索引。 */
    selectedIndex: number;
    /** 当前开放 WikiLink 匹配。 */
    match: OpenWikiLinkMatch | null;
}

/**
 * @interface PendingInputSelection
 * @description 受控输入更新后需要恢复的光标位置。
 */
interface PendingInputSelection {
    /** 单元格键。 */
    cellKey: string;
    /** 选区起点。 */
    start: number;
    /** 选区终点。 */
    end: number;
}

interface PendingMarkdownTableNavigationRestore {
    blockFrom: number;
    position: MarkdownTableCellPosition;
}

const INACTIVE_WIKILINK_SUGGEST_STATE: TableWikiLinkSuggestState = {
    active: false,
    cellKey: null,
    query: "",
    items: [],
    selectedIndex: 0,
    match: null,
};

let pendingMarkdownTableNavigationRestore: PendingMarkdownTableNavigationRestore | null = null;

/**
 * @interface SaveResult
 * @description 表格 markdown 写回结果。
 */
interface SaveResult {
    /** 是否写回成功。 */
    success: boolean;
    /** 状态消息。 */
    message: string;
}

/**
 * @interface MarkdownTableVisualEditorProps
 * @description 组件输入参数。
 */
export interface MarkdownTableVisualEditorProps {
    /** 当前表格块起始偏移。 */
    blockFrom: number;
    /** 初始表格模型。 */
    initialModel: MarkdownTableModel;
    /** 表格源码写回回调。 */
    onCommitMarkdown: (markdownText: string) => SaveResult;
    /** 请求退出表格 Vim 导航层并返回正文。 */
    onRequestExitVimNavigation?: (direction: "previous" | "next") => void;
    /** 当前文档相对路径。 */
    currentFilePath: string;
    /** Dockview 容器 API。 */
    containerApi: WorkbenchContainerApi;
}

/**
 * @function buildCellKey
 * @description 生成单元格唯一键。
 * @param position 单元格位置。
 * @returns 单元格键。
 */
function buildCellKey(position: MarkdownTableCellPosition): string {
    return `${position.section}:${position.rowIndex}:${position.columnIndex}`;
}

/**
 * @function resolveDefaultActiveCell
 * @description 解析默认激活单元格。
 * @param model 表格模型。
 * @returns 默认单元格位置。
 */
function resolveDefaultActiveCell(model: MarkdownTableModel): MarkdownTableCellPosition {
    if (model.rows.length > 0) {
        return { section: "body", rowIndex: 0, columnIndex: 0 };
    }

    return { section: "header", rowIndex: 0, columnIndex: 0 };
}

function isSameCellPosition(
    left: MarkdownTableCellPosition,
    right: MarkdownTableCellPosition,
): boolean {
    return left.section === right.section
        && left.rowIndex === right.rowIndex
        && left.columnIndex === right.columnIndex;
}

function isTableBodyEntryAnchor(position: MarkdownTableCellPosition): boolean {
    return position.section === "body" && position.columnIndex === 0;
}

function clearPendingMarkdownTableNavigationRestore(
    blockFrom: number,
    position?: MarkdownTableCellPosition,
): void {
    if (!pendingMarkdownTableNavigationRestore || pendingMarkdownTableNavigationRestore.blockFrom !== blockFrom) {
        return;
    }

    if (position && !isSameCellPosition(pendingMarkdownTableNavigationRestore.position, position)) {
        return;
    }

    pendingMarkdownTableNavigationRestore = null;
}

function tryRestoreMarkdownTableNavigationCellNow(
    blockFrom: number,
    position: MarkdownTableCellPosition,
): boolean {
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-markdown-table-vim-nav='true']"))
        .find((element) => element.dataset.markdownTableBlockFrom === String(blockFrom)
            && element.dataset.markdownTableSection === position.section
            && element.dataset.markdownTableRowIndex === String(position.rowIndex)
            && element.dataset.markdownTableColumnIndex === String(position.columnIndex));

    if (!target) {
        return false;
    }

    target.focus();
    if (document.activeElement !== target) {
        return false;
    }

    clearPendingMarkdownTableNavigationRestore(blockFrom, position);
    return true;
}

function restoreMarkdownTableNavigationCellFocus(
    blockFrom: number,
    position: MarkdownTableCellPosition,
    attemptsRemaining = 4,
): void {
    if (tryRestoreMarkdownTableNavigationCellNow(blockFrom, position)) {
        return;
    }

    if (attemptsRemaining <= 1) {
        clearPendingMarkdownTableNavigationRestore(blockFrom, position);
        return;
    }

    window.requestAnimationFrame(() => {
        restoreMarkdownTableNavigationCellFocus(blockFrom, position, attemptsRemaining - 1);
    });
}

/**
 * @function getBodyRowCount
 * @description 获取表体行数。
 * @param model 表格模型。
 * @returns 表体行数。
 */
function getBodyRowCount(model: MarkdownTableModel): number {
    return Math.max(1, model.rows.length);
}

/**
 * @function replaceFullWidthWikiLinkTrigger
 * @description 将输入中的全角 `【【` 归一化为 `[[`，保持光标位置稳定。
 * @param value 当前输入值。
 * @param cursorPosition 当前光标位置。
 * @returns 归一化后的值与光标位置。
 */
function replaceFullWidthWikiLinkTrigger(
    value: string,
    cursorPosition: number,
): { value: string; cursorPosition: number } {
    if (cursorPosition < 2) {
        return { value, cursorPosition };
    }

    const trigger = value.slice(cursorPosition - 2, cursorPosition);
    if (trigger !== "【【") {
        return { value, cursorPosition };
    }

    return {
        value: `${value.slice(0, cursorPosition - 2)}[[${value.slice(cursorPosition)}`,
        cursorPosition,
    };
}

/**
 * @function clampSuggestIndex
 * @description 将补全选中索引限制在候选范围内。
 * @param index 候选索引。
 * @param itemCount 候选数量。
 * @returns 安全索引。
 */
function clampSuggestIndex(index: number, itemCount: number): number {
    if (itemCount <= 0) {
        return 0;
    }

    if (index < 0) {
        return itemCount - 1;
    }

    if (index >= itemCount) {
        return 0;
    }

    return index;
}

/**
 * @function parseTableCellPreviewSegments
 * @description 将单元格文本拆分为普通文本、WikiLink 与普通链接片段。
 * @param value 单元格原始值。
 * @returns 预览分段数组。
 */
function parseTableCellPreviewSegments(value: string): TableCellPreviewSegment[] {
    if (value.length === 0) {
        return [];
    }

    const segments: TableCellPreviewSegment[] = [];
    let lastIndex = 0;
    TABLE_CELL_LINK_PATTERN.lastIndex = 0;

    for (const match of value.matchAll(TABLE_CELL_LINK_PATTERN)) {
        const fullMatch = match[0] ?? "";
        const matchIndex = match.index ?? -1;
        if (matchIndex < 0 || fullMatch.length === 0) {
            continue;
        }

        if (matchIndex > lastIndex) {
            segments.push({
                kind: "text",
                text: value.slice(lastIndex, matchIndex),
            });
        }

        const wikiLinkBody = match[2] ?? "";
        const markdownLinkText = match[3] ?? "";
        const markdownLinkHref = match[4] ?? "";

        if (wikiLinkBody.length > 0) {
            const parsed = parseWikiLinkParts(wikiLinkBody.trim());
            if (parsed) {
                segments.push({
                    kind: "wikilink",
                    text: parsed.displayText,
                    target: parsed.target,
                });
            } else {
                segments.push({
                    kind: "text",
                    text: fullMatch,
                });
            }
        } else if (markdownLinkText.length > 0 && markdownLinkHref.trim().length > 0) {
            segments.push({
                kind: "link",
                text: markdownLinkText,
                href: markdownLinkHref.trim(),
            });
        } else {
            segments.push({
                kind: "text",
                text: fullMatch,
            });
        }

        lastIndex = matchIndex + fullMatch.length;
    }

    if (lastIndex < value.length) {
        segments.push({
            kind: "text",
            text: value.slice(lastIndex),
        });
    }

    return segments.length > 0
        ? segments
        : [{
            kind: "text",
            text: value,
        }];
}

/**
 * @function MarkdownTableVisualEditor
 * @description 渲染 Markdown 表格可视化编辑器。
 * @param props 组件参数。
 * @returns React 节点。
 */
export function MarkdownTableVisualEditor(props: MarkdownTableVisualEditorProps): ReactNode {
    const { t } = useTranslation();
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
    const navigationRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const inputImeCompositionGuard = useRef(createImeCompositionGuard()).current;
    const isCommittingDraftRef = useRef<boolean>(false);
    const pendingInputSelectionRef = useRef<PendingInputSelection | null>(null);
    const wikiLinkSuggestRequestSeqRef = useRef<number>(0);
    const wikiLinkSuggestDebounceTimerRef = useRef<number | null>(null);
    const [tableModel, setTableModel] = useState<MarkdownTableModel>(() => props.initialModel);
    const [activeCell, setActiveCell] = useState<MarkdownTableCellPosition>(() =>
        resolveDefaultActiveCell(props.initialModel),
    );
    const [interactionMode, setInteractionMode] = useState<"navigation" | "editing">("navigation");
    const [wikiLinkSuggestState, setWikiLinkSuggestState] = useState<TableWikiLinkSuggestState>(
        INACTIVE_WIKILINK_SUGGEST_STATE,
    );
    const lastCommittedMarkdownRef = useRef<string>(serializeMarkdownTable(props.initialModel));
    const tableModelRef = useRef<MarkdownTableModel>(props.initialModel);
    const activeCellRef = useRef<MarkdownTableCellPosition>(resolveDefaultActiveCell(props.initialModel));

    const currentSelectionLabel = useMemo(() => {
        if (activeCell.section === "header") {
            return t("markdownTable.headerSelection", {
                column: activeCell.columnIndex + 1,
            });
        }

        return t("markdownTable.bodySelection", {
            row: activeCell.rowIndex + 1,
            column: activeCell.columnIndex + 1,
        });
    }, [activeCell, t]);

    useEffect(() => {
        tableModelRef.current = tableModel;
    }, [tableModel]);

    useEffect(() => {
        activeCellRef.current = activeCell;
    }, [activeCell]);

    useEffect(() => {
        const pendingSelection = pendingInputSelectionRef.current;
        if (!pendingSelection) {
            return;
        }

        const targetInput = inputRefs.current.get(pendingSelection.cellKey);
        if (!targetInput) {
            return;
        }

        window.requestAnimationFrame(() => {
            targetInput.focus();
            targetInput.setSelectionRange(pendingSelection.start, pendingSelection.end);
            pendingInputSelectionRef.current = null;
        });
    }, [tableModel]);

    useEffect(() => {
        return () => {
            if (wikiLinkSuggestDebounceTimerRef.current !== null) {
                window.clearTimeout(wikiLinkSuggestDebounceTimerRef.current);
                wikiLinkSuggestDebounceTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        return () => {
            wrapperRef.current
                ?.closest(".cm-editor")
                ?.classList.remove(TABLE_WIDGET_EDITOR_FOCUS_CLASS);
        };
    }, []);

    useEffect(() => {
        const pendingRestore = pendingMarkdownTableNavigationRestore;
        if (!pendingRestore || pendingRestore.blockFrom !== props.blockFrom) {
            return;
        }

        if (tryRestoreMarkdownTableNavigationCellNow(props.blockFrom, pendingRestore.position)) {
            return;
        }

        window.requestAnimationFrame(() => {
            restoreMarkdownTableNavigationCellFocus(props.blockFrom, pendingRestore.position);
        });
    }, [props.blockFrom, tableModel]);

    /**
     * @function commitDraftModel
     * @description 将当前草稿表格 flush 回编辑器文档。
     */
    const commitDraftModel = (): void => {
        if (isCommittingDraftRef.current) {
            return;
        }

        const nextMarkdown = serializeMarkdownTable(tableModelRef.current);
        if (nextMarkdown === lastCommittedMarkdownRef.current) {
            return;
        }

        isCommittingDraftRef.current = true;
        try {
            const result = props.onCommitMarkdown(nextMarkdown);
            if (result.success) {
                lastCommittedMarkdownRef.current = nextMarkdown;
                console.info("[markdown-table-visual-editor] commit success", {
                    bytes: nextMarkdown.length,
                });
                return;
            }

            console.warn("[markdown-table-visual-editor] commit failed", {
                message: result.message,
            });
        } finally {
            queueMicrotask(() => {
                isCommittingDraftRef.current = false;
            });
        }
    };

    const focusedEditorRef = useRef<FocusedMarkdownTableEditor>({
        flushPendingChanges: () => {
            commitDraftModel();
        },
    });

    /**
     * @function closeWikiLinkSuggest
     * @description 关闭表格单元格内的 WikiLink 补全面板。
     */
    const closeWikiLinkSuggest = (): void => {
        if (wikiLinkSuggestDebounceTimerRef.current !== null) {
            window.clearTimeout(wikiLinkSuggestDebounceTimerRef.current);
            wikiLinkSuggestDebounceTimerRef.current = null;
        }
        setWikiLinkSuggestState(INACTIVE_WIKILINK_SUGGEST_STATE);
    };

    /**
     * @function scheduleInputSelectionRestore
     * @description 在受控输入更新后恢复单元格内光标位置。
     * @param cellKey 单元格键。
     * @param start 选区起点。
     * @param end 选区终点。
     */
    const scheduleInputSelectionRestore = (
        cellKey: string,
        start: number,
        end: number = start,
    ): void => {
        pendingInputSelectionRef.current = {
            cellKey,
            start,
            end,
        };
    };

    /**
     * @function updateCellValue
     * @description 更新指定单元格的值，并按需恢复输入光标位置。
     * @param position 单元格位置。
     * @param nextValue 新值。
     * @param nextSelection 可选的光标位置。
     */
    const updateCellValue = (
        position: MarkdownTableCellPosition,
        nextValue: string,
        nextSelection?: { start: number; end?: number },
    ): void => {
        const cellKey = buildCellKey(position);
        setTableModel((previous) => updateMarkdownTableCell(previous, position, nextValue));
        if (nextSelection) {
            scheduleInputSelectionRestore(cellKey, nextSelection.start, nextSelection.end ?? nextSelection.start);
        }
    };

    /**
     * @function refreshWikiLinkSuggestForInput
     * @description 根据当前单元格输入内容与光标位置更新 WikiLink 补全状态。
     * @param position 当前单元格位置。
     * @param value 当前输入值。
     * @param cursorPosition 当前光标位置。
     */
    const refreshWikiLinkSuggestForInput = (
        position: MarkdownTableCellPosition,
        value: string,
        cursorPosition: number,
    ): void => {
        const match = detectOpenWikiLink(value, cursorPosition);
        if (!match) {
            closeWikiLinkSuggest();
            return;
        }

        const cellKey = buildCellKey(position);
        const query = match.query;
        setWikiLinkSuggestState((previous) => ({
            active: true,
            cellKey,
            query,
            items: previous.cellKey === cellKey ? previous.items : [],
            selectedIndex: 0,
            match,
        }));

        if (wikiLinkSuggestDebounceTimerRef.current !== null) {
            window.clearTimeout(wikiLinkSuggestDebounceTimerRef.current);
        }

        const requestSeq = ++wikiLinkSuggestRequestSeqRef.current;
        wikiLinkSuggestDebounceTimerRef.current = window.setTimeout(() => {
            wikiLinkSuggestDebounceTimerRef.current = null;

            void suggestWikiLinkTargets(query, WIKILINK_SUGGEST_MAX_ITEMS)
                .then((items) => {
                    if (requestSeq !== wikiLinkSuggestRequestSeqRef.current) {
                        return;
                    }

                    setWikiLinkSuggestState((previous) => {
                        if (!previous.active || previous.cellKey !== cellKey || previous.query !== query) {
                            return previous;
                        }

                        return {
                            ...previous,
                            items,
                            selectedIndex: clampSuggestIndex(previous.selectedIndex, items.length),
                        };
                    });
                })
                .catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn("[markdown-table-visual-editor] wikilink suggestions failed", {
                        message,
                        query,
                    });
                });
        }, WIKILINK_SUGGEST_DEBOUNCE_MS);
    };

    /**
     * @function acceptWikiLinkSuggestion
     * @description 将当前选中的 WikiLink 建议写入活动单元格。
     * @param itemTitle 建议标题。
     */
    const acceptWikiLinkSuggestion = (itemTitle: string): void => {
        const position = activeCellRef.current;
        const cellKey = buildCellKey(position);
        const targetInput = inputRefs.current.get(cellKey);
        const currentValue = position.section === "header"
            ? tableModelRef.current.headers[position.columnIndex] ?? ""
            : tableModelRef.current.rows[position.rowIndex]?.[position.columnIndex] ?? "";
        const cursorPosition = targetInput?.selectionStart ?? currentValue.length;
        const fallbackMatch = wikiLinkSuggestState.match;
        if (!fallbackMatch) {
            closeWikiLinkSuggest();
            return;
        }

        const acceptance = resolveWikiLinkSuggestionAcceptanceAtCursor(
            currentValue,
            cursorPosition,
            itemTitle,
            fallbackMatch,
        );
        const nextValue = `${currentValue.slice(0, acceptance.from)}${acceptance.insert}${currentValue.slice(acceptance.to)}`;
        updateCellValue(position, nextValue, {
            start: acceptance.selectionAnchor,
        });
        closeWikiLinkSuggest();
    };

    /**
     * @function syncEditorFocusClass
     * @description 根据表格容器焦点状态切换 CodeMirror 容器的视觉 class。
     * @param shouldFocusTable 是否标记为表格聚焦态。
     */
    const syncEditorFocusClass = (shouldFocusTable: boolean): void => {
        const editorElement = wrapperRef.current?.closest(".cm-editor");
        if (!editorElement) {
            return;
        }

        editorElement.classList.toggle(TABLE_WIDGET_EDITOR_FOCUS_CLASS, shouldFocusTable);
    };

    useEffect(() => {
        return () => {
            commitDraftModel();
            closeWikiLinkSuggest();
            syncEditorFocusClass(false);
            clearFocusedMarkdownTableEditor(focusedEditorRef.current);
        };
    }, []);

    /**
     * @function focusCell
     * @description 将焦点移动到指定单元格。
     * @param position 单元格位置。
     */
    const focusCell = (position: MarkdownTableCellPosition): void => {
        setInteractionMode("editing");
        setActiveCell(position);
        window.requestAnimationFrame(() => {
            inputRefs.current.get(buildCellKey(position))?.focus();
        });
    };

    const focusNavigationCell = (position: MarkdownTableCellPosition): void => {
        pendingMarkdownTableNavigationRestore = {
            blockFrom: props.blockFrom,
            position,
        };
        setInteractionMode("navigation");
        setActiveCell(position);
        window.requestAnimationFrame(() => {
            const target = navigationRefs.current.get(buildCellKey(position));
            target?.focus();
            if (target && document.activeElement === target) {
                clearPendingMarkdownTableNavigationRestore(props.blockFrom, position);
            }
        });
    };

    const handleNavigationTargetFocus = (position: MarkdownTableCellPosition): void => {
        clearPendingMarkdownTableNavigationRestore(props.blockFrom, position);
        setInteractionMode("navigation");
        setActiveCell((previous) => (isSameCellPosition(previous, position) ? previous : position));
    };

    const shouldSubmitTableCellPlainEnter = (
        event: KeyboardEvent<HTMLInputElement>,
    ): boolean => {
        if (!shouldSubmitPlainEnter({
            key: event.key,
            nativeEvent: event.nativeEvent,
        })) {
            return false;
        }

        return inputImeCompositionGuard.shouldAllowBlurAction();
    };

    const exitEditingToNavigation = (position: MarkdownTableCellPosition): void => {
        closeWikiLinkSuggest();
        commitDraftModel();
        focusNavigationCell(position);
    };

    /**
     * @function updateModelAndSelection
     * @description 应用表格模型更新并同步选区焦点。
     * @param nextModel 新模型。
     * @param nextCell 新激活单元格。
     */
    const updateModelAndSelection = (
        nextModel: MarkdownTableModel,
        nextCell: MarkdownTableCellPosition,
    ): void => {
        setTableModel(nextModel);
        setActiveCell(nextCell);
        console.debug("[markdown-table-visual-editor] table model updated", {
            columns: nextModel.headers.length,
            rows: nextModel.rows.length,
            selection: nextCell,
        });
        if (interactionMode === "navigation") {
            focusNavigationCell(nextCell);
            return;
        }

        focusCell(nextCell);
    };

    /**
     * @function resolveAdjacentCell
     * @description 根据当前激活单元格解析相邻焦点。
     * @param direction 方向。
     * @returns 相邻单元格位置。
     */
    const resolveAdjacentCell = (direction: "next" | "previous"): MarkdownTableCellPosition => {
        const columnCount = tableModelRef.current.headers.length;
        const bodyRowCount = getBodyRowCount(tableModelRef.current);
        const flattenedCells: MarkdownTableCellPosition[] = [
            ...Array.from({ length: columnCount }, (_, columnIndex) => ({
                section: "header" as const,
                rowIndex: 0,
                columnIndex,
            })),
            ...Array.from({ length: bodyRowCount }, (_, rowIndex) =>
                Array.from({ length: columnCount }, (_, columnIndex) => ({
                    section: "body" as const,
                    rowIndex,
                    columnIndex,
                })),
            ).flat(),
        ];

        const currentKey = buildCellKey(activeCellRef.current);
        const currentIndex = flattenedCells.findIndex((cell) => buildCellKey(cell) === currentKey);
        if (currentIndex < 0) {
            return flattenedCells[0] ?? resolveDefaultActiveCell(tableModelRef.current);
        }

        const nextIndex = direction === "next"
            ? (currentIndex + 1) % flattenedCells.length
            : (currentIndex - 1 + flattenedCells.length) % flattenedCells.length;
        return flattenedCells[nextIndex] ?? flattenedCells[0] ?? resolveDefaultActiveCell(tableModelRef.current);
    };

    /**
     * @function handleInsertRow
     * @description 在当前表体行前后插入新行。
     * @param side 插入方向。
     */
    const handleInsertRow = (side: "above" | "below"): void => {
        const currentCell = activeCellRef.current;
        const baseRowIndex = currentCell.section === "body" ? currentCell.rowIndex : 0;
        const insertIndex = side === "above" ? baseRowIndex : baseRowIndex + 1;
        const nextModel = insertMarkdownTableRowAt(tableModelRef.current, insertIndex);
        updateModelAndSelection(nextModel, {
            section: "body",
            rowIndex: Math.min(insertIndex, nextModel.rows.length - 1),
            columnIndex: currentCell.columnIndex,
        });
    };

    /**
     * @function handleDeleteRow
     * @description 删除当前表体行。
     */
    const handleDeleteRow = (): void => {
        const currentCell = activeCellRef.current;
        const targetRowIndex = currentCell.section === "body" ? currentCell.rowIndex : 0;
        const nextModel = deleteMarkdownTableRowAt(tableModelRef.current, targetRowIndex);
        updateModelAndSelection(nextModel, {
            section: "body",
            rowIndex: Math.max(0, Math.min(targetRowIndex, nextModel.rows.length - 1)),
            columnIndex: Math.min(currentCell.columnIndex, nextModel.headers.length - 1),
        });
    };

    /**
     * @function handleInsertColumn
     * @description 在当前列左右插入新列。
     * @param side 插入方向。
     */
    const handleInsertColumn = (side: "left" | "right"): void => {
        const currentCell = activeCellRef.current;
        const insertIndex = side === "left" ? currentCell.columnIndex : currentCell.columnIndex + 1;
        const nextModel = insertMarkdownTableColumnAt(tableModelRef.current, insertIndex);
        updateModelAndSelection(nextModel, {
            section: currentCell.section,
            rowIndex: currentCell.section === "body" ? currentCell.rowIndex : 0,
            columnIndex: Math.min(insertIndex, nextModel.headers.length - 1),
        });
    };

    /**
     * @function handleDeleteColumn
     * @description 删除当前列。
     */
    const handleDeleteColumn = (): void => {
        const currentCell = activeCellRef.current;
        const nextModel = deleteMarkdownTableColumnAt(tableModelRef.current, currentCell.columnIndex);
        updateModelAndSelection(nextModel, {
            section: currentCell.section,
            rowIndex: currentCell.section === "body" ? currentCell.rowIndex : 0,
            columnIndex: Math.max(0, Math.min(currentCell.columnIndex, nextModel.headers.length - 1)),
        });
    };

    /**
     * @function handleCellShortcut
     * @description 处理表格局部快捷键。
     * @param event 键盘事件。
     */
    const handleCellShortcut = (
        event: KeyboardEvent<HTMLInputElement>,
        position: MarkdownTableCellPosition,
    ): void => {
        if (isImeComposing(event.nativeEvent)) {
            return;
        }

        const cellKey = buildCellKey(position);
        const hasActiveWikiLinkSuggest =
            wikiLinkSuggestState.active
            && wikiLinkSuggestState.cellKey === cellKey;
        const lowerKey = event.key.toLowerCase();

        if ((event.metaKey || event.ctrlKey) && !event.altKey) {
            const shouldBlockBrowserFormattingShortcut =
                lowerKey === "b"
                || lowerKey === "i"
                || lowerKey === "e"
                || lowerKey === "k"
                || lowerKey === "h";
            if (shouldBlockBrowserFormattingShortcut) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }

        if (hasActiveWikiLinkSuggest) {
            if (event.key === "ArrowDown" && !event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                setWikiLinkSuggestState((previous) => ({
                    ...previous,
                    selectedIndex: clampSuggestIndex(previous.selectedIndex + 1, previous.items.length),
                }));
                return;
            }

            if (event.key === "ArrowUp" && !event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                setWikiLinkSuggestState((previous) => ({
                    ...previous,
                    selectedIndex: clampSuggestIndex(previous.selectedIndex - 1, previous.items.length),
                }));
                return;
            }

            if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
                const selectedItem = wikiLinkSuggestState.items[wikiLinkSuggestState.selectedIndex];
                if (selectedItem) {
                    event.preventDefault();
                    acceptWikiLinkSuggestion(selectedItem.title);
                    return;
                }
            }

            if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                closeWikiLinkSuggest();
                return;
            }
        }

        if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            focusCell(resolveAdjacentCell(event.shiftKey ? "previous" : "next"));
            return;
        }

        if (shouldSubmitTableCellPlainEnter(event)) {
            event.preventDefault();
            event.stopPropagation();
            exitEditingToNavigation(position);
            return;
        }

        if (event.key === "ArrowUp" && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            handleInsertRow("above");
            return;
        }

        if (event.key === "ArrowDown" && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            handleInsertRow("below");
            return;
        }

        if (event.key === "ArrowLeft" && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            handleInsertColumn("left");
            return;
        }

        if (event.key === "ArrowRight" && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            handleInsertColumn("right");
            return;
        }

        if (event.key === "Backspace" && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            handleDeleteRow();
            return;
        }

        if (event.key === "Backspace" && event.altKey && !event.metaKey && !event.ctrlKey && event.shiftKey) {
            event.preventDefault();
            handleDeleteColumn();
            return;
        }

        const isSaveShortcut = lowerKey === "s" && (event.metaKey || event.ctrlKey) && !event.altKey;
        if (isSaveShortcut) {
            event.preventDefault();
            commitDraftModel();
            return;
        }

        if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            exitEditingToNavigation(position);
        }
    };

    const handleCellInputBlur = (event: FocusEvent<HTMLInputElement>): void => {
        if (!inputImeCompositionGuard.shouldAllowBlurAction()) {
            return;
        }

        commitDraftModel();
        closeWikiLinkSuggest();
        setInteractionMode("navigation");

        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !wrapperRef.current?.contains(nextTarget)) {
            syncEditorFocusClass(false);
        }
    };

    /**
     * @function handleCellInputChange
     * @description 处理单元格输入更新、全角括号归一化与 WikiLink 补全触发。
     * @param event 输入变更事件。
     * @param position 单元格位置。
     */
    const handleCellInputChange = (
        event: ChangeEvent<HTMLInputElement>,
        position: MarkdownTableCellPosition,
    ): void => {
        const rawValue = event.target.value;
        const rawSelectionStart = event.target.selectionStart ?? rawValue.length;
        const normalized = replaceFullWidthWikiLinkTrigger(rawValue, rawSelectionStart);
        updateCellValue(position, normalized.value, {
            start: normalized.cursorPosition,
        });
        refreshWikiLinkSuggestForInput(position, normalized.value, normalized.cursorPosition);
    };

    /**
     * @function handleCellSelectionChange
     * @description 处理单元格内光标移动，保持 WikiLink 补全面板与当前位置同步。
     * @param position 单元格位置。
     */
    const handleCellSelectionChange = (position: MarkdownTableCellPosition): void => {
        const cellKey = buildCellKey(position);
        const targetInput = inputRefs.current.get(cellKey);
        if (!targetInput) {
            return;
        }

        refreshWikiLinkSuggestForInput(
            position,
            targetInput.value,
            targetInput.selectionStart ?? targetInput.value.length,
        );
    };

    /**
     * @function renderWikiLinkSuggestPopup
     * @description 渲染当前活动单元格的 WikiLink 补全面板。
     * @param cellKey 单元格键。
     * @returns 补全面板节点。
     */
    const renderWikiLinkSuggestPopup = (cellKey: string): ReactNode => {
        if (!wikiLinkSuggestState.active || wikiLinkSuggestState.cellKey !== cellKey) {
            return null;
        }

        return (
            <div className="cm-wikilink-suggest-popup mtv-cell-popup" role="listbox">
                {wikiLinkSuggestState.items.length === 0 ? (
                    <div className="cm-wikilink-suggest-empty">{t("editorPlugins.noMatchingNote")}</div>
                ) : wikiLinkSuggestState.items.map((item, index) => {
                    const isSelected = index === wikiLinkSuggestState.selectedIndex;
                    return (
                        <button
                            key={`${item.relativePath}:${index}`}
                            type="button"
                            className={isSelected
                                ? "cm-wikilink-suggest-item cm-wikilink-suggest-item-selected mtv-cell-popup-item"
                                : "cm-wikilink-suggest-item mtv-cell-popup-item"}
                            onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
                                event.preventDefault();
                                acceptWikiLinkSuggestion(item.title);
                            }}
                        >
                            <span className="cm-wikilink-suggest-title">{item.title}</span>
                            <span className="cm-wikilink-suggest-path">{item.relativePath}</span>
                            {item.referenceCount > 0 ? (
                                <span className="cm-wikilink-suggest-ref-count">{item.referenceCount}</span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
        );
    };

    /**
     * @function renderCellPreview
     * @description 渲染单元格预览态，支持点击 WikiLink 与普通链接。
     * @param position 单元格位置。
     * @param value 单元格值。
     * @param placeholder 占位文本。
     * @returns 预览节点。
     */
    const renderCellPreview = (
        position: MarkdownTableCellPosition,
        value: string,
        placeholder: string,
        isNavigationTarget: boolean,
    ): ReactNode => {
        const isEmpty = value.trim().length === 0;
        const segments = parseTableCellPreviewSegments(value);
        const cellKey = buildCellKey(position);

        return (
            <div
                ref={(element) => {
                    if (element) {
                        navigationRefs.current.set(cellKey, element);
                        return;
                    }

                    navigationRefs.current.delete(cellKey);
                }}
                className="mtv-cell-preview"
                data-empty={isEmpty}
                data-markdown-table-vim-nav={true}
                data-markdown-table-block-from={props.blockFrom}
                data-markdown-table-section={position.section}
                data-markdown-table-row-index={position.rowIndex}
                data-markdown-table-column-index={position.columnIndex}
                data-markdown-table-entry-anchor={isTableBodyEntryAnchor(position) ? true : undefined}
                data-vim-nav-active={isNavigationTarget ? true : undefined}
                tabIndex={isNavigationTarget ? 0 : -1}
                onFocus={() => {
                    handleNavigationTargetFocus(position);
                }}
                onClick={() => {
                    focusCell(position);
                }}
                onKeyDown={(event) => {
                    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
                        return;
                    }

                    if (event.key === "Enter") {
                        event.preventDefault();
                        focusCell(position);
                        return;
                    }

                    if (event.key === "Escape") {
                        event.preventDefault();
                        props.onRequestExitVimNavigation?.("next");
                        return;
                    }

                    if (event.key === "h") {
                        event.preventDefault();
                        focusNavigationCell({
                            ...position,
                            columnIndex: Math.max(0, position.columnIndex - 1),
                        });
                        return;
                    }

                    if (event.key === "l") {
                        event.preventDefault();
                        focusNavigationCell({
                            ...position,
                            columnIndex: Math.min(tableModelRef.current.headers.length - 1, position.columnIndex + 1),
                        });
                        return;
                    }

                    if (event.key === "j") {
                        event.preventDefault();
                        if (position.section === "header") {
                            focusNavigationCell({ section: "body", rowIndex: 0, columnIndex: position.columnIndex });
                            return;
                        }

                        if (position.rowIndex >= Math.max(0, tableModelRef.current.rows.length - 1)) {
                            props.onRequestExitVimNavigation?.("next");
                            return;
                        }

                        focusNavigationCell({
                            section: "body",
                            rowIndex: position.rowIndex + 1,
                            columnIndex: position.columnIndex,
                        });
                        return;
                    }

                    if (event.key === "k") {
                        event.preventDefault();
                        if (position.section === "header") {
                            props.onRequestExitVimNavigation?.("previous");
                            return;
                        }

                        if (position.rowIndex === 0) {
                            focusNavigationCell({ section: "header", rowIndex: 0, columnIndex: position.columnIndex });
                            return;
                        }

                        focusNavigationCell({
                            section: "body",
                            rowIndex: position.rowIndex - 1,
                            columnIndex: position.columnIndex,
                        });
                    }
                }}
            >
                {isEmpty ? (
                    <span className="mtv-cell-preview-placeholder">{placeholder}</span>
                ) : segments.map((segment, index) => {
                    if (isNavigationTarget) {
                        return (
                            <span key={`nav-${index}`} className="mtv-cell-preview-text">
                                {segment.text}
                            </span>
                        );
                    }

                    if (segment.kind === "text") {
                        return (
                            <span key={`text-${index}`} className="mtv-cell-preview-text">
                                {segment.text}
                            </span>
                        );
                    }

                    if (segment.kind === "wikilink") {
                        return (
                            <button
                                key={`wikilink-${segment.target}-${index}`}
                                type="button"
                                className="mtv-cell-preview-link-button cm-rendered-wikilink"
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (shouldSkipWikiLinkNavigationForSelection(
                                        window.getSelection(),
                                        event.currentTarget,
                                    )) {
                                        return;
                                    }
                                    void openWikiLinkTarget(
                                        props.containerApi,
                                        () => props.currentFilePath,
                                        segment.target,
                                    );
                                }}
                            >
                                {segment.text}
                            </button>
                        );
                    }

                    return (
                        <a
                            key={`link-${segment.href}-${index}`}
                            href={segment.href}
                            className="mtv-cell-preview-link-anchor cm-rendered-link"
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => {
                                event.stopPropagation();
                            }}
                        >
                            {segment.text}
                        </a>
                    );
                })}
            </div>
        );
    };

    /**
     * @function handleWrapperFocusCapture
     * @description 表格容器获得焦点时，将自身注册为当前聚焦表格编辑器。
     */
    const handleWrapperFocusCapture = (): void => {
        setFocusedMarkdownTableEditor(focusedEditorRef.current);
        syncEditorFocusClass(true);
    };

    /**
     * @function handleWrapperBlurCapture
     * @description 表格容器失焦时 flush 草稿，并在焦点离开组件后清理注册表。
     * @param event 失焦事件。
     */
    const handleWrapperBlurCapture = (event: FocusEvent<HTMLDivElement>): void => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && wrapperRef.current?.contains(nextTarget)) {
            return;
        }

        commitDraftModel();
        closeWikiLinkSuggest();
        syncEditorFocusClass(false);
        clearFocusedMarkdownTableEditor(focusedEditorRef.current);
    };

    return (
        <div
            ref={wrapperRef}
            className="mtv-shell"
            data-markdown-table-block-from={props.blockFrom}
            onFocusCapture={handleWrapperFocusCapture}
            onBlurCapture={handleWrapperBlurCapture}
        >
            <div className="mtv-toolbar">
                <div className="mtv-toolbar-group">
                    <button type="button" className="mtv-toolbar-button" onClick={() => handleInsertRow("above")}>
                        {t("markdownTable.addRowAbove")}
                    </button>
                    <button type="button" className="mtv-toolbar-button" onClick={() => handleInsertRow("below")}>
                        {t("markdownTable.addRowBelow")}
                    </button>
                    <button type="button" className="mtv-toolbar-button" onClick={() => handleDeleteRow()}>
                        {t("markdownTable.deleteRow")}
                    </button>
                </div>
                <div className="mtv-toolbar-group">
                    <button type="button" className="mtv-toolbar-button" onClick={() => handleInsertColumn("left")}>
                        {t("markdownTable.addColumnLeft")}
                    </button>
                    <button type="button" className="mtv-toolbar-button" onClick={() => handleInsertColumn("right")}>
                        {t("markdownTable.addColumnRight")}
                    </button>
                    <button type="button" className="mtv-toolbar-button" onClick={() => handleDeleteColumn()}>
                        {t("markdownTable.deleteColumn")}
                    </button>
                </div>
            </div>

            <div className="mtv-status">
                <span className="mtv-status-current">{currentSelectionLabel}</span>
                <span className="mtv-shortcut-list">
                    <span className="mtv-shortcut-chip">{t("markdownTable.shortcutTabNavigation")}</span>
                    <span className="mtv-shortcut-chip">{t("markdownTable.shortcutReorder")}</span>
                    <span className="mtv-shortcut-chip">{t("markdownTable.shortcutDeleteContent")}</span>
                </span>
            </div>

            <div className="mtv-table-scroll">
                <table className="mtv-table">
                    <thead>
                        <tr>
                            {tableModel.headers.map((header, columnIndex) => {
                                const position: MarkdownTableCellPosition = {
                                    section: "header",
                                    rowIndex: 0,
                                    columnIndex,
                                };
                                const cellKey = buildCellKey(position);
                                const isActiveCell = buildCellKey(activeCell) === cellKey;
                                const isEditingCell = isActiveCell && interactionMode === "editing";
                                const isNavigationTarget = isActiveCell && interactionMode === "navigation";
                                return (
                                    <th key={cellKey} className="mtv-table-head-cell">
                                        <div className="mtv-cell-frame">
                                            {isEditingCell ? (
                                                <input
                                                    ref={(element) => {
                                                        if (element) {
                                                            inputRefs.current.set(cellKey, element);
                                                            return;
                                                        }
                                                        inputRefs.current.delete(cellKey);
                                                    }}
                                                    type="text"
                                                    className="mtv-cell-input"
                                                    value={header}
                                                    placeholder={t("markdownTable.headerPlaceholder")}
                                                    data-active={true}
                                                    onFocus={() => {
                                                        setActiveCell(position);
                                                        handleCellSelectionChange(position);
                                                    }}
                                                    onClick={() => {
                                                        handleCellSelectionChange(position);
                                                    }}
                                                    onSelect={() => {
                                                        handleCellSelectionChange(position);
                                                    }}
                                                    onKeyDown={(event) => {
                                                        handleCellShortcut(event, position);
                                                    }}
                                                    onChange={(event) => {
                                                        handleCellInputChange(event, position);
                                                    }}
                                                    onCompositionStart={() => {
                                                        inputImeCompositionGuard.handleCompositionStart();
                                                    }}
                                                    onCompositionEnd={() => {
                                                        inputImeCompositionGuard.handleCompositionEnd();
                                                    }}
                                                    onBlur={handleCellInputBlur}
                                                />
                                            ) : renderCellPreview(
                                                position,
                                                header,
                                                t("markdownTable.headerPlaceholder"),
                                                isNavigationTarget,
                                            )}
                                        </div>
                                        {renderWikiLinkSuggestPopup(cellKey)}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {tableModel.rows.map((row, rowIndex) => (
                            <tr key={`body-row-${rowIndex}`} className="mtv-table-body-row">
                                {row.map((cell, columnIndex) => {
                                    const position: MarkdownTableCellPosition = {
                                        section: "body",
                                        rowIndex,
                                        columnIndex,
                                    };
                                    const cellKey = buildCellKey(position);
                                    const isActiveCell = buildCellKey(activeCell) === cellKey;
                                    const isEditingCell = isActiveCell && interactionMode === "editing";
                                    const isNavigationTarget = isActiveCell && interactionMode === "navigation";
                                    return (
                                        <td key={cellKey} className="mtv-table-body-cell">
                                            <div className="mtv-cell-frame">
                                                {isEditingCell ? (
                                                    <input
                                                        ref={(element) => {
                                                            if (element) {
                                                                inputRefs.current.set(cellKey, element);
                                                                return;
                                                            }
                                                            inputRefs.current.delete(cellKey);
                                                        }}
                                                        type="text"
                                                        className="mtv-cell-input"
                                                        value={cell}
                                                        placeholder={t("markdownTable.cellPlaceholder")}
                                                        data-active={true}
                                                        onFocus={() => {
                                                            setActiveCell(position);
                                                            handleCellSelectionChange(position);
                                                        }}
                                                        onClick={() => {
                                                            handleCellSelectionChange(position);
                                                        }}
                                                        onSelect={() => {
                                                            handleCellSelectionChange(position);
                                                        }}
                                                        onKeyDown={(event) => {
                                                            handleCellShortcut(event, position);
                                                        }}
                                                        onChange={(event) => {
                                                            handleCellInputChange(event, position);
                                                        }}
                                                        onCompositionStart={() => {
                                                            inputImeCompositionGuard.handleCompositionStart();
                                                        }}
                                                        onCompositionEnd={() => {
                                                            inputImeCompositionGuard.handleCompositionEnd();
                                                        }}
                                                        onBlur={handleCellInputBlur}
                                                    />
                                                ) : renderCellPreview(
                                                    position,
                                                    cell,
                                                    t("markdownTable.cellPlaceholder"),
                                                    isNavigationTarget,
                                                )}
                                            </div>
                                            {renderWikiLinkSuggestPopup(cellKey)}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}