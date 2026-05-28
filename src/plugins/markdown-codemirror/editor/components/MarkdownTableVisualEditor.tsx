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
    type ComponentPropsWithoutRef,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type CSSProperties,
    type DragEvent,
    type FocusEvent,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
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
    moveMarkdownTableColumn,
    moveMarkdownTableRow,
    hasMarkdownTableLayout,
    serializeMarkdownTableWithLayout,
    updateMarkdownTableCell,
    type MarkdownTableLayout,
    type MarkdownTableCellPosition,
    type MarkdownTableModel,
} from "../markdownTableModel";
import { prepareMarkdownTableCellPreviewMarkdown } from "../markdownTableCellPreview";
import {
    getMarkdownTableCellFlatIndex,
    resolveInitialRichPreviewLimit,
} from "../markdownTablePreviewPolicy";
import {
    MARKDOWN_TABLE_MIN_ROW_HEIGHT,
    estimateMarkdownTableBodyRowHeights,
} from "../markdownTableRowHeightEstimate";
import { resolveMarkdownTableVirtualRange } from "../markdownTableVirtualization";
import { resolveMarkdownTableVirtualViewport } from "../markdownTableVirtualViewport";
import {
    detectOpenWikiLink,
    resolveWikiLinkSuggestionAcceptanceAtCursor,
    type OpenWikiLinkMatch,
} from "../editPlugins/wikilinkSuggestUtils";
import { shouldSkipWikiLinkNavigationForSelection } from "../readModeSelectionPolicy";
import { openWikiLinkTarget } from "../syntaxPlugins/wikiLinkSyntaxRenderer";
import {
    decodeReadModeBlockLatexHref,
    decodeReadModeHighlightHref,
    decodeReadModeInlineLatexHref,
    decodeReadModeMediaEmbedHref,
    decodeReadModeTagHref,
    decodeReadModeWikiLinkHref,
} from "../markdownReadTransform";
import { computeTagColorStyles } from "../utils/tagColor";
import {
    createImeCompositionGuard,
    isImeComposing,
    shouldSubmitPlainEnter,
} from "../../../../utils/imeInputGuard";
import { TableCellLatex } from "./MarkdownTableCellLatex";
import "./MarkdownTableVisualEditor.css";

const TABLE_WIDGET_EDITOR_FOCUS_CLASS = "cm-table-widget-focused";
const WIKILINK_SUGGEST_DEBOUNCE_MS = 150;
const WIKILINK_SUGGEST_MAX_ITEMS = 15;
const CONTEXT_MENU_VIEWPORT_MARGIN = 8;
const CONTEXT_MENU_ESTIMATED_WIDTH = 220;
const CONTEXT_MENU_ESTIMATED_HEIGHT = 116;

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

type TableEdgeSelection =
    | {
        kind: "column";
        index: number;
    }
    | {
        kind: "row";
        index: number;
    };

type TableContextMenuState = {
    kind: "column";
    index: number;
    x: number;
    y: number;
} | {
    kind: "row";
    index: number;
    x: number;
    y: number;
} | null;

type TableDragState = {
    kind: "column" | "row";
    fromIndex: number;
    overIndex: number;
} | null;

function clampContextMenuCoordinate(
    value: number,
    viewportSize: number,
    estimatedMenuSize: number,
): number {
    if (!Number.isFinite(viewportSize) || viewportSize <= 0) {
        return value;
    }

    const maxValue = viewportSize - estimatedMenuSize - CONTEXT_MENU_VIEWPORT_MARGIN;
    return Math.max(CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(value, maxValue));
}

function resolveContextMenuPosition(clientX: number, clientY: number): { x: number; y: number } {
    if (typeof window === "undefined") {
        return { x: clientX, y: clientY };
    }

    return {
        x: clampContextMenuCoordinate(clientX, window.innerWidth, CONTEXT_MENU_ESTIMATED_WIDTH),
        y: clampContextMenuCoordinate(clientY, window.innerHeight, CONTEXT_MENU_ESTIMATED_HEIGHT),
    };
}

interface TableResizeDragState {
    kind: "column" | "row";
    index: number;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startSize: number;
}

const DEFAULT_TABLE_COLUMN_WIDTH = 164;
const MIN_TABLE_COLUMN_WIDTH = 88;
const MIN_TABLE_ROW_HEIGHT = MARKDOWN_TABLE_MIN_ROW_HEIGHT;
const TABLE_EDGE_DRAG_MIME_TYPE = "application/x-ofive-markdown-table-edge";
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
    /** 初始表格布局元数据。 */
    initialLayout?: MarkdownTableLayout | null;
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

function buildColumnWidthStyle(columnWidths: number[]): CSSProperties {
    return {
        gridTemplateColumns: columnWidths
            .map((width) => `${Math.max(MIN_TABLE_COLUMN_WIDTH, Math.round(width))}px`)
            .join(" "),
    };
}

function normalizePersistedSize(
    value: number | undefined,
    fallback: number,
    minimum: number,
): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return fallback;
    }

    return Math.max(minimum, Math.round(numericValue));
}

function resolveInitialColumnWidths(
    model: MarkdownTableModel,
    layout: MarkdownTableLayout | null | undefined,
): number[] {
    return Array.from({ length: model.headers.length }, (_, index) =>
        normalizePersistedSize(
            layout?.columnWidths?.[index],
            DEFAULT_TABLE_COLUMN_WIDTH,
            MIN_TABLE_COLUMN_WIDTH,
        ),
    );
}

function resolveInitialRowHeights(
    model: MarkdownTableModel,
    layout: MarkdownTableLayout | null | undefined,
): number[] {
    return Array.from({ length: model.rows.length }, (_, index) =>
        normalizePersistedSize(
            layout?.rowHeights?.[index],
            MIN_TABLE_ROW_HEIGHT,
            MIN_TABLE_ROW_HEIGHT,
        ),
    );
}

function buildMarkdownTableLayout(
    columnWidths: number[],
    rowHeights: number[],
): MarkdownTableLayout {
    return {
        columnWidths: columnWidths.map((width) => Math.max(MIN_TABLE_COLUMN_WIDTH, Math.round(width))),
        rowHeights: rowHeights.map((height) => Math.max(MIN_TABLE_ROW_HEIGHT, Math.round(height))),
    };
}

function insertTableLayoutSize(values: number[], index: number, defaultValue: number): number[] {
    const safeIndex = Math.max(0, Math.min(index, values.length));
    const nextValues = [...values];
    nextValues.splice(safeIndex, 0, defaultValue);
    return nextValues;
}

function deleteTableLayoutSize(values: number[], index: number, defaultValue: number): number[] {
    if (values.length <= 1) {
        return [defaultValue];
    }

    const safeIndex = Math.max(0, Math.min(index, values.length - 1));
    return values.filter((_, valueIndex) => valueIndex !== safeIndex);
}

function clampTableCellPosition(
    position: MarkdownTableCellPosition,
    model: MarkdownTableModel,
): MarkdownTableCellPosition {
    const safeColumnIndex = Math.max(0, Math.min(position.columnIndex, model.headers.length - 1));
    if (position.section === "header") {
        return {
            section: "header",
            rowIndex: 0,
            columnIndex: safeColumnIndex,
        };
    }

    return {
        section: "body",
        rowIndex: Math.max(0, Math.min(position.rowIndex, Math.max(0, model.rows.length - 1))),
        columnIndex: safeColumnIndex,
    };
}

function readTableEdgeDragPayload(dataTransfer: DataTransfer): TableEdgeSelection | null {
    const rawPayload = dataTransfer.getData(TABLE_EDGE_DRAG_MIME_TYPE);
    if (!rawPayload) {
        return null;
    }

    try {
        const parsed = JSON.parse(rawPayload) as Partial<TableEdgeSelection>;
        const parsedIndex = parsed.index;
        if (
            (parsed.kind === "column" || parsed.kind === "row")
            && typeof parsedIndex === "number"
            && Number.isInteger(parsedIndex)
        ) {
            return {
                kind: parsed.kind,
                index: parsedIndex,
            };
        }
    } catch {
        return null;
    }

    return null;
}

function isNodeInsideMarkdownTableContextMenu(target: Node | null): boolean {
    if (!target) {
        return false;
    }

    return Array.from(document.querySelectorAll(".mtv-context-menu"))
        .some((menuElement) => menuElement.contains(target));
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
 * @function MarkdownTableVisualEditor
 * @description 渲染 Markdown 表格可视化编辑器。
 * @param props 组件参数。
 * @returns React 节点。
 */
export function MarkdownTableVisualEditor(props: MarkdownTableVisualEditorProps): ReactNode {
    const { t } = useTranslation();
    const initialColumnWidths = resolveInitialColumnWidths(props.initialModel, props.initialLayout);
    const initialRowHeights = resolveInitialRowHeights(props.initialModel, props.initialLayout);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const tableScrollRef = useRef<HTMLTableElement | null>(null);
    const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
    const navigationRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const headerMeasureRef = useRef<HTMLElement | null>(null);
    const bodyRowMeasureRefs = useRef<Map<number, HTMLElement>>(new Map());
    const inputImeCompositionGuard = useRef(createImeCompositionGuard()).current;
    const isCommittingDraftRef = useRef<boolean>(false);
    const pendingInputSelectionRef = useRef<PendingInputSelection | null>(null);
    const wikiLinkSuggestRequestSeqRef = useRef<number>(0);
    const wikiLinkSuggestDebounceTimerRef = useRef<number | null>(null);
    const resizeDragStateRef = useRef<TableResizeDragState | null>(null);
    const pendingActiveCellRevealRef = useRef<MarkdownTableCellPosition | null>(null);
    const [tableModel, setTableModel] = useState<MarkdownTableModel>(() => props.initialModel);
    const [activeCell, setActiveCell] = useState<MarkdownTableCellPosition>(() =>
        resolveDefaultActiveCell(props.initialModel),
    );
    const [interactionMode, setInteractionMode] = useState<"navigation" | "editing">("navigation");
    const [isTableFocused, setIsTableFocused] = useState(false);
    const [edgeSelection, setEdgeSelection] = useState<TableEdgeSelection | null>(null);
    const [contextMenuState, setContextMenuState] = useState<TableContextMenuState>(null);
    const [dragState, setDragState] = useState<TableDragState>(null);
    const [hasCustomLayout, setHasCustomLayout] = useState<boolean>(() => hasMarkdownTableLayout(props.initialLayout));
    const [columnWidths, setColumnWidths] = useState<number[]>(() =>
        initialColumnWidths,
    );
    const [rowHeights, setRowHeights] = useState<number[]>(() =>
        initialRowHeights,
    );
    const [renderedHeaderHeight, setRenderedHeaderHeight] = useState<number>(MIN_TABLE_ROW_HEIGHT);
    const [renderedRowHeights, setRenderedRowHeights] = useState<number[]>(() =>
        estimateMarkdownTableBodyRowHeights(props.initialModel, initialColumnWidths, initialRowHeights),
    );
    const [virtualViewport, setVirtualViewport] = useState<{ top: number; bottom: number }>(() => ({
        top: 0,
        bottom: 720,
    }));
    const richPreviewLimit = useMemo<number>(
        () => resolveInitialRichPreviewLimit(tableModel),
        [tableModel.headers.length, tableModel.rows.length],
    );
    const [wikiLinkSuggestState, setWikiLinkSuggestState] = useState<TableWikiLinkSuggestState>(
        INACTIVE_WIKILINK_SUGGEST_STATE,
    );
    const columnWidthsRef = useRef<number[]>(initialColumnWidths);
    const rowHeightsRef = useRef<number[]>(initialRowHeights);
    const hasCustomLayoutRef = useRef<boolean>(hasCustomLayout);
    const lastCommittedMarkdownRef = useRef<string>(serializeMarkdownTableWithLayout(
        props.initialModel,
        hasCustomLayoutRef.current
            ? buildMarkdownTableLayout(initialColumnWidths, initialRowHeights)
            : null,
    ));
    const tableModelRef = useRef<MarkdownTableModel>(props.initialModel);
    const activeCellRef = useRef<MarkdownTableCellPosition>(resolveDefaultActiveCell(props.initialModel));
    const isTableFocusedRef = useRef(false);

    const setTableFocusState = (focused: boolean): void => {
        isTableFocusedRef.current = focused;
        setIsTableFocused(focused);
    };

    const applyColumnWidths = (updater: (previous: number[]) => number[]): void => {
        const nextWidths = updater(columnWidthsRef.current);
        columnWidthsRef.current = nextWidths;
        setColumnWidths(nextWidths);
    };

    const applyRowHeights = (updater: (previous: number[]) => number[]): void => {
        const nextHeights = updater(rowHeightsRef.current);
        rowHeightsRef.current = nextHeights;
        setRowHeights(nextHeights);
    };

    const tableCellMarkdownComponents = useMemo<Components>(() => ({
        p: ({ children }) => <span className="mtv-cell-preview-paragraph">{children}</span>,
        strong: ({ children }) => <strong className="cm-rendered-bold">{children}</strong>,
        em: ({ children }) => <em className="cm-rendered-italic">{children}</em>,
        del: ({ children }) => <del className="cm-rendered-strikethrough">{children}</del>,
        h1: ({ children }) => <strong className="cm-rendered-bold mtv-cell-preview-heading">{children}</strong>,
        h2: ({ children }) => <strong className="cm-rendered-bold mtv-cell-preview-heading">{children}</strong>,
        h3: ({ children }) => <strong className="cm-rendered-bold mtv-cell-preview-heading">{children}</strong>,
        h4: ({ children }) => <strong className="cm-rendered-bold mtv-cell-preview-heading">{children}</strong>,
        h5: ({ children }) => <strong className="cm-rendered-bold mtv-cell-preview-heading">{children}</strong>,
        h6: ({ children }) => <strong className="cm-rendered-bold mtv-cell-preview-heading">{children}</strong>,
        blockquote: ({ children }) => (
            <blockquote className="cm-rendered-blockquote mtv-cell-preview-blockquote">
                {children}
            </blockquote>
        ),
        ul: ({ children }) => <ul className="mtv-cell-preview-list mtv-cell-preview-list-unordered">{children}</ul>,
        ol: ({ children }) => <ol className="mtv-cell-preview-list mtv-cell-preview-list-ordered">{children}</ol>,
        li: ({ children, className }) => (
            <li className={className ? `mtv-cell-preview-list-item ${className}` : "mtv-cell-preview-list-item"}>
                {children}
            </li>
        ),
        input: ({ type, checked }) => {
            if (type !== "checkbox") {
                return null;
            }

            return (
                <span
                    aria-hidden="true"
                    className={checked
                        ? "cm-rendered-task-checkbox cm-rendered-task-checkbox-checked"
                        : "cm-rendered-task-checkbox cm-rendered-task-checkbox-unchecked"}
                />
            );
        },
        code: ({ node: _node, className, children, ...componentProps }: ComponentPropsWithoutRef<"code"> & { node?: unknown }) => {
            const isInline = !String(className ?? "").includes("language-");
            if (isInline) {
                return (
                    <code
                        className={`cm-rendered-inline-code ${className ?? ""}`.trim()}
                        {...componentProps}
                    >
                        {children}
                    </code>
                );
            }

            return (
                <code className={`mtv-cell-preview-code-block ${className ?? ""}`.trim()} {...componentProps}>
                    {children}
                </code>
            );
        },
        pre: ({ children }) => <pre className="mtv-cell-preview-pre">{children}</pre>,
        img: ({ src, alt }) => {
            const mediaTarget = decodeReadModeMediaEmbedHref(src);
            if (mediaTarget) {
                return (
                    <span className="mtv-cell-preview-media-embed">
                        {alt ?? mediaTarget}
                    </span>
                );
            }

            return (
                <img
                    alt={alt ?? ""}
                    className="mtv-cell-preview-image"
                    src={src}
                />
            );
        },
        a: (componentProps) => {
            const { href, children, ...restProps } = componentProps;
            const wikiLinkTarget = decodeReadModeWikiLinkHref(href);
            if (wikiLinkTarget) {
                return (
                    <button
                        type="button"
                        className="mtv-cell-preview-link-button cm-rendered-wikilink"
                        data-wiki-link-target={wikiLinkTarget}
                        onMouseDown={(event) => {
                            event.stopPropagation();
                        }}
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
                                wikiLinkTarget,
                            );
                        }}
                    >
                        <span
                            className="cm-rendered-wikilink-display"
                            data-wiki-link-target={wikiLinkTarget}
                        >
                            {children}
                        </span>
                    </button>
                );
            }

            if (decodeReadModeHighlightHref(href) !== null) {
                return (
                    <mark className="cm-rendered-highlight">
                        {children}
                    </mark>
                );
            }

            const tagTarget = decodeReadModeTagHref(href);
            if (tagTarget !== null) {
                const styles = computeTagColorStyles(tagTarget);
                return (
                    <span
                        className="cm-rendered-tag"
                        style={{
                            background: styles.background,
                            borderColor: styles.border,
                            color: styles.text,
                        }}
                    >
                        {children}
                    </span>
                );
            }

            const inlineLatexSource = decodeReadModeInlineLatexHref(href);
            if (inlineLatexSource !== null) {
                return <TableCellLatex latex={inlineLatexSource} displayMode={false} />;
            }

            const blockLatexSource = decodeReadModeBlockLatexHref(href);
            if (blockLatexSource !== null) {
                return <TableCellLatex latex={blockLatexSource} displayMode />;
            }

            return (
                <a
                    {...restProps}
                    href={href}
                    className="mtv-cell-preview-link-anchor cm-rendered-link"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                        event.stopPropagation();
                    }}
                >
                    {children}
                </a>
            );
        },
    }), [props.containerApi, props.currentFilePath]);

    const columnWidthStyle = useMemo<CSSProperties>(
        () => buildColumnWidthStyle(columnWidths),
        [columnWidths],
    );
    const bodyRowRenderHeights = useMemo<number[]>(
        () => estimateMarkdownTableBodyRowHeights(tableModel, columnWidths, hasCustomLayout ? rowHeights : null),
        [columnWidths, hasCustomLayout, rowHeights, tableModel],
    );
    const virtualRange = useMemo(
        () => resolveMarkdownTableVirtualRange({
            rowCount: tableModel.rows.length,
            rowHeights: bodyRowRenderHeights,
            viewportTop: virtualViewport.top,
            viewportBottom: virtualViewport.bottom,
        }),
        [bodyRowRenderHeights, tableModel.rows.length, virtualViewport],
    );
    const visibleBodyRows = useMemo(
        () => tableModel.rows.slice(virtualRange.startIndex, virtualRange.endIndex),
        [tableModel.rows, virtualRange.endIndex, virtualRange.startIndex],
    );

    useEffect(() => {
        tableModelRef.current = tableModel;
    }, [tableModel]);

    useEffect(() => {
        activeCellRef.current = activeCell;
    }, [activeCell]);

    useEffect(() => {
        applyColumnWidths((previous) => {
            if (previous.length === tableModel.headers.length) {
                return previous;
            }

            return Array.from({ length: tableModel.headers.length }, (_, index) =>
                previous[index] ?? DEFAULT_TABLE_COLUMN_WIDTH,
            );
        });
        applyRowHeights((previous) => {
            if (previous.length === tableModel.rows.length) {
                return previous;
            }

            return Array.from({ length: tableModel.rows.length }, (_, index) =>
                previous[index] ?? MIN_TABLE_ROW_HEIGHT,
            );
        });
    }, [tableModel.headers.length, tableModel.rows.length]);

    useLayoutEffect(() => {
        const updateRenderedEdgeHeights = (): void => {
            const nextHeaderHeight = Math.max(
                MIN_TABLE_ROW_HEIGHT,
                Math.ceil(headerMeasureRef.current?.getBoundingClientRect().height ?? MIN_TABLE_ROW_HEIGHT),
            );
            const nextRowHeights = bodyRowRenderHeights.map((estimatedHeight, rowIndex) => {
                const measuredHeight = bodyRowMeasureRefs.current.get(rowIndex)?.getBoundingClientRect().height;
                return Math.max(
                    estimatedHeight,
                    rowHeights[rowIndex] ?? MIN_TABLE_ROW_HEIGHT,
                    Math.ceil(measuredHeight ?? MIN_TABLE_ROW_HEIGHT),
                );
            });

            setRenderedHeaderHeight((previous) => (previous === nextHeaderHeight ? previous : nextHeaderHeight));
            setRenderedRowHeights((previous) => {
                if (
                    previous.length === nextRowHeights.length
                    && previous.every((height, index) => height === nextRowHeights[index])
                ) {
                    return previous;
                }

                return nextRowHeights;
            });
        };

        updateRenderedEdgeHeights();

        const observedElements = [
            headerMeasureRef.current,
            ...Array.from(bodyRowMeasureRefs.current.values()),
        ].filter((element): element is HTMLElement => element !== null);

        if (typeof ResizeObserver === "undefined" || observedElements.length === 0) {
            return;
        }

        const observer = new ResizeObserver(() => {
            updateRenderedEdgeHeights();
        });
        observedElements.forEach((element) => {
            observer.observe(element);
        });

        return () => {
            observer.disconnect();
        };
    }, [bodyRowRenderHeights, rowHeights, tableModel.headers.length, tableModel.rows.length]);

    useLayoutEffect(() => {
        const tableScroll = tableScrollRef.current;
        if (!tableScroll) {
            return;
        }

        const updateVirtualViewport = (): void => {
            const editorScroller = wrapperRef.current?.closest<HTMLElement>(".cm-scroller");
            const tableRect = tableScroll.getBoundingClientRect();
            const scrollerRect = editorScroller?.getBoundingClientRect();
            if (!editorScroller || !scrollerRect) {
                setVirtualViewport({ top: tableScroll.scrollTop, bottom: tableScroll.scrollTop + tableScroll.clientHeight });
                return;
            }

            setVirtualViewport(resolveMarkdownTableVirtualViewport({
                scrollerScrollTop: editorScroller.scrollTop,
                scrollerClientHeight: editorScroller.clientHeight,
                scrollerTop: scrollerRect.top,
                tableTop: tableRect.top,
                headerHeight: renderedHeaderHeight,
            }));
        };

        updateVirtualViewport();
        const editorScroller = wrapperRef.current?.closest<HTMLElement>(".cm-scroller");
        editorScroller?.addEventListener("scroll", updateVirtualViewport, { passive: true });
        window.addEventListener("resize", updateVirtualViewport);
        return () => {
            editorScroller?.removeEventListener("scroll", updateVirtualViewport);
            window.removeEventListener("resize", updateVirtualViewport);
        };
    }, [bodyRowRenderHeights.length, renderedHeaderHeight, tableModel.headers.length]);

    useLayoutEffect(() => {
        const pendingReveal = pendingActiveCellRevealRef.current;
        if (
            !pendingReveal
            || !isSameCellPosition(pendingReveal, activeCell)
            || activeCell.section !== "body"
            || !virtualRange.enabled
        ) {
            return;
        }

        if (activeCell.rowIndex >= virtualRange.startIndex && activeCell.rowIndex < virtualRange.endIndex) {
            pendingActiveCellRevealRef.current = null;
            window.requestAnimationFrame(() => {
                const cellKey = buildCellKey(activeCell);
                if (interactionMode === "editing") {
                    inputRefs.current.get(cellKey)?.focus();
                    return;
                }

                const target = navigationRefs.current.get(cellKey);
                target?.focus();
                if (target && document.activeElement === target) {
                    clearPendingMarkdownTableNavigationRestore(props.blockFrom, activeCell);
                }
            });
            return;
        }

        const widget = wrapperRef.current?.closest<HTMLElement>(".cm-markdown-table-widget");
        const editorScroller = wrapperRef.current?.closest<HTMLElement>(".cm-scroller");
        if (!widget || !editorScroller) {
            return;
        }

        const bodyOffsetTop = tableScrollRef.current?.offsetTop ?? 0;
        const rowTop = bodyRowRenderHeights
            .slice(0, activeCell.rowIndex)
            .reduce((totalHeight, rowHeight) => totalHeight + rowHeight, 0);
        editorScroller.scrollTop = widget.offsetTop + bodyOffsetTop + rowTop - Math.max(40, editorScroller.clientHeight / 3);
    }, [activeCell, bodyRowRenderHeights, interactionMode, props.blockFrom, virtualRange]);

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
        if (!contextMenuState) {
            return;
        }

        const handlePointerDown = (event: globalThis.PointerEvent): void => {
            const target = event.target as Node | null;
            if (isNodeInsideMarkdownTableContextMenu(target)) {
                return;
            }

            if (target && wrapperRef.current?.contains(target)) {
                return;
            }
            setContextMenuState(null);
        };

        const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
            if (event.key === "Escape") {
                setContextMenuState(null);
            }
        };

        window.addEventListener("pointerdown", handlePointerDown, { capture: true });
        window.addEventListener("keydown", handleKeyDown, { capture: true });
        return () => {
            window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
            window.removeEventListener("keydown", handleKeyDown, { capture: true });
        };
    }, [contextMenuState]);

    useEffect(() => {
        const handlePointerMove = (event: globalThis.PointerEvent): void => {
            const resizeState = resizeDragStateRef.current;
            if (!resizeState) {
                return;
            }

            if (resizeState.kind === "column") {
                const delta = event.clientX - resizeState.startClientX;
                applyColumnWidths((previous) => previous.map((width, index) =>
                    index === resizeState.index
                        ? Math.max(MIN_TABLE_COLUMN_WIDTH, resizeState.startSize + delta)
                        : width,
                ));
                return;
            }

            const delta = event.clientY - resizeState.startClientY;
            applyRowHeights((previous) => previous.map((height, index) =>
                index === resizeState.index
                    ? Math.max(MIN_TABLE_ROW_HEIGHT, resizeState.startSize + delta)
                    : height,
            ));
        };

        const handlePointerEnd = (): void => {
            if (resizeDragStateRef.current) {
                hasCustomLayoutRef.current = true;
                setHasCustomLayout(true);
                resizeDragStateRef.current = null;
                commitDraftModel();
                return;
            }

            resizeDragStateRef.current = null;
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerEnd);
        window.addEventListener("pointercancel", handlePointerEnd);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerEnd);
            window.removeEventListener("pointercancel", handlePointerEnd);
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

        const nextMarkdown = serializeMarkdownTableWithLayout(
            tableModelRef.current,
            hasCustomLayoutRef.current
                ? buildMarkdownTableLayout(columnWidthsRef.current, rowHeightsRef.current)
                : null,
        );
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
            setTableFocusState(false);
            syncEditorFocusClass(false);
            clearFocusedMarkdownTableEditor(focusedEditorRef.current);
        };
    }, []);

    const releaseTableFocus = (): void => {
        commitDraftModel();
        closeWikiLinkSuggest();
        setContextMenuState(null);
        setEdgeSelection(null);
        setInteractionMode("navigation");
        setTableFocusState(false);
        syncEditorFocusClass(false);
        clearFocusedMarkdownTableEditor(focusedEditorRef.current);
    };

    useEffect(() => {
        const handlePointerDown = (event: globalThis.PointerEvent): void => {
            if (!isTableFocusedRef.current) {
                return;
            }

            const target = event.target as Node | null;
            if (target && wrapperRef.current?.contains(target)) {
                return;
            }
            if (isNodeInsideMarkdownTableContextMenu(target)) {
                return;
            }

            releaseTableFocus();
        };

        window.addEventListener("pointerdown", handlePointerDown, { capture: true });
        return () => {
            window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
        };
    }, []);

    /**
     * @function focusCell
     * @description 将焦点移动到指定单元格。
     * @param position 单元格位置。
     */
    const focusCell = (position: MarkdownTableCellPosition): void => {
        setEdgeSelection(null);
        setInteractionMode("editing");
        setTableFocusState(true);
        pendingActiveCellRevealRef.current = position;
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
        setTableFocusState(true);
        pendingActiveCellRevealRef.current = position;
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
        setEdgeSelection(null);
        setInteractionMode("navigation");
        setTableFocusState(true);
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
        const safeNextCell = clampTableCellPosition(nextCell, nextModel);
        setActiveCell(safeNextCell);
        console.debug("[markdown-table-visual-editor] table model updated", {
            columns: nextModel.headers.length,
            rows: nextModel.rows.length,
            selection: safeNextCell,
        });
        if (interactionMode === "navigation") {
            focusNavigationCell(safeNextCell);
            return;
        }

        focusCell(safeNextCell);
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
        applyRowHeights((previous) => insertTableLayoutSize(previous, insertIndex, MIN_TABLE_ROW_HEIGHT));
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
        applyRowHeights((previous) => deleteTableLayoutSize(previous, targetRowIndex, MIN_TABLE_ROW_HEIGHT));
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
        applyColumnWidths((previous) => insertTableLayoutSize(previous, insertIndex, DEFAULT_TABLE_COLUMN_WIDTH));
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
        applyColumnWidths((previous) => deleteTableLayoutSize(previous, currentCell.columnIndex, DEFAULT_TABLE_COLUMN_WIDTH));
        updateModelAndSelection(nextModel, {
            section: currentCell.section,
            rowIndex: currentCell.section === "body" ? currentCell.rowIndex : 0,
            columnIndex: Math.max(0, Math.min(currentCell.columnIndex, nextModel.headers.length - 1)),
        });
    };

    const handleSelectColumn = (columnIndex: number): void => {
        closeWikiLinkSuggest();
        setContextMenuState(null);
        setTableFocusState(true);
        setInteractionMode("navigation");
        setEdgeSelection({ kind: "column", index: columnIndex });
        setActiveCell({
            section: "header",
            rowIndex: 0,
            columnIndex,
        });
    };

    const handleSelectRow = (rowIndex: number): void => {
        closeWikiLinkSuggest();
        setContextMenuState(null);
        setTableFocusState(true);
        setInteractionMode("navigation");
        setEdgeSelection({ kind: "row", index: rowIndex });
        setActiveCell({
            section: "body",
            rowIndex,
            columnIndex: 0,
        });
    };

    const handleInsertRowAtEdge = (rowIndex: number, side: "above" | "below"): void => {
        const insertIndex = side === "above" ? rowIndex : rowIndex + 1;
        const nextModel = insertMarkdownTableRowAt(tableModelRef.current, insertIndex);
        applyRowHeights((previous) => insertTableLayoutSize(previous, insertIndex, MIN_TABLE_ROW_HEIGHT));
        setEdgeSelection(null);
        setContextMenuState(null);
        updateModelAndSelection(nextModel, {
            section: "body",
            rowIndex: Math.min(insertIndex, nextModel.rows.length - 1),
            columnIndex: Math.min(activeCellRef.current.columnIndex, nextModel.headers.length - 1),
        });
    };

    const handleDeleteRowAtEdge = (rowIndex: number): void => {
        const nextModel = deleteMarkdownTableRowAt(tableModelRef.current, rowIndex);
        applyRowHeights((previous) => deleteTableLayoutSize(previous, rowIndex, MIN_TABLE_ROW_HEIGHT));
        setEdgeSelection(null);
        setContextMenuState(null);
        updateModelAndSelection(nextModel, {
            section: "body",
            rowIndex: Math.max(0, Math.min(rowIndex, nextModel.rows.length - 1)),
            columnIndex: Math.min(activeCellRef.current.columnIndex, nextModel.headers.length - 1),
        });
    };

    const handleInsertColumnAtEdge = (columnIndex: number, side: "left" | "right"): void => {
        const insertIndex = side === "left" ? columnIndex : columnIndex + 1;
        const nextModel = insertMarkdownTableColumnAt(tableModelRef.current, insertIndex);
        applyColumnWidths((previous) => insertTableLayoutSize(previous, insertIndex, DEFAULT_TABLE_COLUMN_WIDTH));
        setEdgeSelection(null);
        setContextMenuState(null);
        updateModelAndSelection(nextModel, {
            section: activeCellRef.current.section,
            rowIndex: activeCellRef.current.section === "body" ? activeCellRef.current.rowIndex : 0,
            columnIndex: Math.min(insertIndex, nextModel.headers.length - 1),
        });
    };

    const handleDeleteColumnAtEdge = (columnIndex: number): void => {
        const nextModel = deleteMarkdownTableColumnAt(tableModelRef.current, columnIndex);
        applyColumnWidths((previous) => deleteTableLayoutSize(previous, columnIndex, DEFAULT_TABLE_COLUMN_WIDTH));
        setEdgeSelection(null);
        setContextMenuState(null);
        updateModelAndSelection(nextModel, {
            section: activeCellRef.current.section,
            rowIndex: activeCellRef.current.section === "body" ? activeCellRef.current.rowIndex : 0,
            columnIndex: Math.max(0, Math.min(columnIndex, nextModel.headers.length - 1)),
        });
    };

    const openEdgeContextMenu = (
        event: MouseEvent<HTMLButtonElement>,
        selection: Exclude<TableEdgeSelection, null>,
    ): void => {
        event.preventDefault();
        event.stopPropagation();
        closeWikiLinkSuggest();
        setEdgeSelection(selection);
        const position = resolveContextMenuPosition(event.clientX, event.clientY);
        setContextMenuState({
            ...selection,
            x: position.x,
            y: position.y,
        });
    };

    const handleEdgeDragStart = (
        event: DragEvent<HTMLButtonElement>,
        selection: Exclude<TableEdgeSelection, null>,
    ): void => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(TABLE_EDGE_DRAG_MIME_TYPE, JSON.stringify(selection));
        event.dataTransfer.setData("text/plain", `${selection.kind}:${selection.index}`);
        setEdgeSelection(selection);
        setDragState({
            kind: selection.kind,
            fromIndex: selection.index,
            overIndex: selection.index,
        });
    };

    const handleEdgeDragOver = (
        event: DragEvent<HTMLButtonElement>,
        selection: Exclude<TableEdgeSelection, null>,
    ): void => {
        if (!dragState || dragState.kind !== selection.kind) {
            return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragState((previous) => previous && previous.kind === selection.kind
            ? { ...previous, overIndex: selection.index }
            : previous);
    };

    const handleEdgeDrop = (
        event: DragEvent<HTMLButtonElement>,
        selection: Exclude<TableEdgeSelection, null>,
    ): void => {
        event.preventDefault();
        const fallbackPayload = readTableEdgeDragPayload(event.dataTransfer);
        const currentDragState = dragState ?? (fallbackPayload && fallbackPayload.kind === selection.kind
            ? {
                kind: fallbackPayload.kind,
                fromIndex: fallbackPayload.index,
                overIndex: selection.index,
            }
            : null);
        setDragState(null);
        if (!currentDragState || currentDragState.kind !== selection.kind) {
            return;
        }

        if (selection.kind === "column") {
            const nextModel = moveMarkdownTableColumn(tableModelRef.current, currentDragState.fromIndex, selection.index);
            const nextWidths = [...columnWidths];
            const [movedWidth] = nextWidths.splice(currentDragState.fromIndex, 1);
            nextWidths.splice(selection.index, 0, movedWidth ?? DEFAULT_TABLE_COLUMN_WIDTH);
            applyColumnWidths(() => nextWidths);
            setEdgeSelection({ kind: "column", index: selection.index });
            updateModelAndSelection(nextModel, {
                section: "header",
                rowIndex: 0,
                columnIndex: selection.index,
            });
            return;
        }

        const nextModel = moveMarkdownTableRow(tableModelRef.current, currentDragState.fromIndex, selection.index);
        const nextHeights = [...rowHeights];
        const [movedHeight] = nextHeights.splice(currentDragState.fromIndex, 1);
        nextHeights.splice(selection.index, 0, movedHeight ?? MIN_TABLE_ROW_HEIGHT);
        applyRowHeights(() => nextHeights);
        setEdgeSelection({ kind: "row", index: selection.index });
        updateModelAndSelection(nextModel, {
            section: "body",
            rowIndex: selection.index,
            columnIndex: Math.min(activeCellRef.current.columnIndex, nextModel.headers.length - 1),
        });
    };

    const handleResizePointerDown = (
        event: ReactPointerEvent<HTMLDivElement>,
        resizeState: Omit<TableResizeDragState, "pointerId" | "startClientX" | "startClientY">,
    ): void => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const cellElement = event.currentTarget.closest<HTMLElement>(".mtv-table-head-cell, .mtv-table-body-cell");
        const renderedSize = resizeState.kind === "column"
            ? cellElement?.getBoundingClientRect().width
            : cellElement?.getBoundingClientRect().height;
        resizeDragStateRef.current = {
            ...resizeState,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startSize: renderedSize ?? resizeState.startSize,
        };
    };

    const renderColumnEdgeHandle = (columnIndex: number): ReactNode => {
        const selection: TableEdgeSelection = { kind: "column", index: columnIndex };
        const isSelected = edgeSelection?.kind === "column" && edgeSelection.index === columnIndex;
        const isDropTarget =
            dragState?.kind === "column"
            && dragState.overIndex === columnIndex
            && dragState.fromIndex !== columnIndex;

        return (
            <button
                key={`column-edge-${columnIndex}`}
                type="button"
                className="mtv-edge-handle mtv-edge-handle--column"
                data-table-edge-kind="column"
                data-table-edge-index={columnIndex}
                data-selected={isSelected ? true : undefined}
                data-drop-target={isDropTarget ? true : undefined}
                draggable
                title={t("markdownTable.columnHandleTitle")}
                onClick={(event) => {
                    event.preventDefault();
                    handleSelectColumn(columnIndex);
                }}
                onContextMenu={(event) => {
                    openEdgeContextMenu(event, selection);
                }}
                onDragStart={(event) => {
                    handleEdgeDragStart(event, selection);
                }}
                onDragOver={(event) => {
                    handleEdgeDragOver(event, selection);
                }}
                onDrop={(event) => {
                    handleEdgeDrop(event, selection);
                }}
                onDragEnd={() => {
                    setDragState(null);
                }}
            >
                <span className="mtv-edge-handle-grip" aria-hidden="true" />
            </button>
        );
    };

    const renderRowEdgeHandle = (rowIndex: number): ReactNode => {
        const selection: TableEdgeSelection = { kind: "row", index: rowIndex };
        const isSelected = edgeSelection?.kind === "row" && edgeSelection.index === rowIndex;
        const isDropTarget =
            dragState?.kind === "row"
            && dragState.overIndex === rowIndex
            && dragState.fromIndex !== rowIndex;

        return (
            <button
                key={`row-edge-${rowIndex}`}
                type="button"
                className="mtv-edge-handle mtv-edge-handle--row"
                data-table-edge-kind="row"
                data-table-edge-index={rowIndex}
                data-selected={isSelected ? true : undefined}
                data-drop-target={isDropTarget ? true : undefined}
                draggable
                title={t("markdownTable.rowHandleTitle")}
                style={{
                    minHeight: renderedRowHeights[rowIndex] ?? rowHeights[rowIndex] ?? MIN_TABLE_ROW_HEIGHT,
                }}
                onClick={(event) => {
                    event.preventDefault();
                    handleSelectRow(rowIndex);
                }}
                onContextMenu={(event) => {
                    openEdgeContextMenu(event, selection);
                }}
                onDragStart={(event) => {
                    handleEdgeDragStart(event, selection);
                }}
                onDragOver={(event) => {
                    handleEdgeDragOver(event, selection);
                }}
                onDrop={(event) => {
                    handleEdgeDrop(event, selection);
                }}
                onDragEnd={() => {
                    setDragState(null);
                }}
            >
                <span className="mtv-edge-handle-grip" aria-hidden="true" />
            </button>
        );
    };

    const renderColumnResizeHandle = (columnIndex: number): ReactNode => (
        <div
            className="mtv-resize-handle mtv-resize-handle--column"
            data-table-resize-kind="column"
            data-table-resize-index={columnIndex}
            title={t("markdownTable.resizeColumnTitle")}
            onPointerDown={(event) => {
                handleResizePointerDown(event, {
                    kind: "column",
                    index: columnIndex,
                    startSize: columnWidths[columnIndex] ?? DEFAULT_TABLE_COLUMN_WIDTH,
                });
            }}
        />
    );

    const renderRowResizeHandle = (rowIndex: number): ReactNode => (
        <div
            className="mtv-resize-handle mtv-resize-handle--row"
            data-table-resize-kind="row"
            data-table-resize-index={rowIndex}
            title={t("markdownTable.resizeRowTitle")}
            onPointerDown={(event) => {
                handleResizePointerDown(event, {
                    kind: "row",
                    index: rowIndex,
                    startSize: rowHeights[rowIndex] ?? MIN_TABLE_ROW_HEIGHT,
                });
            }}
        />
    );

    const runContextMenuAction = (
        event: MouseEvent<HTMLButtonElement>,
        action: () => void,
    ): void => {
        event.preventDefault();
        event.stopPropagation();
        action();
    };

    const renderContextMenu = (): ReactNode => {
        if (!contextMenuState) {
            return null;
        }

        const menuStyle: CSSProperties = {
            left: contextMenuState.x,
            top: contextMenuState.y,
        };

        if (contextMenuState.kind === "column") {
            return createPortal(
                <div className="mtv-context-menu" role="menu" style={menuStyle}>
                    <button
                        type="button"
                        role="menuitem"
                        onMouseDown={(event) => runContextMenuAction(event, () =>
                            handleInsertColumnAtEdge(contextMenuState.index, "left"),
                        )}
                    >
                        {t("markdownTable.addColumnLeft")}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onMouseDown={(event) => runContextMenuAction(event, () =>
                            handleInsertColumnAtEdge(contextMenuState.index, "right"),
                        )}
                    >
                        {t("markdownTable.addColumnRight")}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onMouseDown={(event) => runContextMenuAction(event, () =>
                            handleDeleteColumnAtEdge(contextMenuState.index),
                        )}
                    >
                        {t("markdownTable.deleteColumn")}
                    </button>
                </div>,
                document.body,
            );
        }

        return createPortal(
            <div className="mtv-context-menu" role="menu" style={menuStyle}>
                <button
                    type="button"
                    role="menuitem"
                    onMouseDown={(event) => runContextMenuAction(event, () =>
                        handleInsertRowAtEdge(contextMenuState.index, "above"),
                    )}
                >
                    {t("markdownTable.addRowAbove")}
                </button>
                <button
                    type="button"
                    role="menuitem"
                    onMouseDown={(event) => runContextMenuAction(event, () =>
                        handleInsertRowAtEdge(contextMenuState.index, "below"),
                    )}
                >
                    {t("markdownTable.addRowBelow")}
                </button>
                <button
                    type="button"
                    role="menuitem"
                    onMouseDown={(event) => runContextMenuAction(event, () =>
                        handleDeleteRowAtEdge(contextMenuState.index),
                    )}
                >
                    {t("markdownTable.deleteRow")}
                </button>
            </div>,
            document.body,
        );
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
            releaseTableFocus();
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
        const cellKey = buildCellKey(position);
        const canRenderRichPreview =
            getMarkdownTableCellFlatIndex(position, tableModel.headers.length) < richPreviewLimit;
        const previewMarkdown = isEmpty || isNavigationTarget || !canRenderRichPreview
            ? ""
            : prepareMarkdownTableCellPreviewMarkdown(value);

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
                data-rich-preview-ready={!isEmpty && canRenderRichPreview ? true : undefined}
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
                ) : isNavigationTarget || !canRenderRichPreview ? (
                    <span className="mtv-cell-preview-text">{value}</span>
                ) : (
                    <span className="mtv-cell-preview-markdown">
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                            components={tableCellMarkdownComponents}
                        >
                            {previewMarkdown}
                        </ReactMarkdown>
                    </span>
                )}
            </div>
        );
    };

    /**
     * @function handleWrapperFocusCapture
     * @description 表格容器获得焦点时，将自身注册为当前聚焦表格编辑器。
     */
    const handleWrapperFocusCapture = (): void => {
        setTableFocusState(true);
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
        if (isNodeInsideMarkdownTableContextMenu(nextTarget)) {
            return;
        }

        releaseTableFocus();
    };

    return (
        <div
            ref={wrapperRef}
            className="mtv-shell"
            data-markdown-table-block-from={props.blockFrom}
            onFocusCapture={handleWrapperFocusCapture}
            onBlurCapture={handleWrapperBlurCapture}
        >
            <div className="mtv-table-scroll">
                <div className="mtv-table-x-scroll">
                    <div className="mtv-table-grid-shell">
                        <div className="mtv-corner-spacer" />
                        <div className="mtv-column-edge-row" style={columnWidthStyle}>
                            {tableModel.headers.map((_, columnIndex) => renderColumnEdgeHandle(columnIndex))}
                        </div>
                        <div className="mtv-row-edge-column">
                            <div
                                className="mtv-row-header-spacer"
                                style={{ height: renderedHeaderHeight }}
                            />
                            {virtualRange.enabled && virtualRange.beforeHeight > 0 ? (
                                <div
                                    className="mtv-row-virtual-spacer"
                                    style={{ height: virtualRange.beforeHeight }}
                                />
                            ) : null}
                            {visibleBodyRows.map((_, visibleRowIndex) =>
                                renderRowEdgeHandle(virtualRange.startIndex + visibleRowIndex),
                            )}
                            {virtualRange.enabled && virtualRange.afterHeight > 0 ? (
                                <div
                                    className="mtv-row-virtual-spacer"
                                    style={{ height: virtualRange.afterHeight }}
                                />
                            ) : null}
                        </div>
                        <table
                            ref={tableScrollRef}
                            className="mtv-table"
                            data-row-virtualized={virtualRange.enabled ? true : undefined}
                            data-total-body-rows={tableModel.rows.length}
                            data-rendered-body-rows={visibleBodyRows.length}
                            style={columnWidthStyle}
                        >
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
                                const isSelectedColumn = edgeSelection?.kind === "column" && edgeSelection.index === columnIndex;
                                const isEditingCell = isTableFocused && isActiveCell && interactionMode === "editing";
                                const isNavigationTarget = isTableFocused && isActiveCell && interactionMode === "navigation";
                                return (
                                    <th
                                        key={cellKey}
                                        className="mtv-table-head-cell"
                                        data-edge-selected={isSelectedColumn ? true : undefined}
                                        ref={columnIndex === 0
                                            ? (element) => {
                                                headerMeasureRef.current = element;
                                            }
                                            : undefined}
                                    >
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
                                        {renderColumnResizeHandle(columnIndex)}
                                        {renderWikiLinkSuggestPopup(cellKey)}
                                    </th>
                                );
                            })}
                                </tr>
                            </thead>
                            <tbody>
                                {virtualRange.enabled && virtualRange.beforeHeight > 0 ? (
                                    <tr
                                        className="mtv-table-virtual-spacer-row"
                                        aria-hidden="true"
                                        style={{ height: virtualRange.beforeHeight }}
                                    >
                                        <td
                                            className="mtv-table-virtual-spacer-cell"
                                            style={{
                                                gridColumn: `span ${tableModel.headers.length}`,
                                                height: virtualRange.beforeHeight,
                                            }}
                                        />
                                    </tr>
                                ) : null}
                                {visibleBodyRows.map((row, visibleRowIndex) => {
                                    const rowIndex = virtualRange.startIndex + visibleRowIndex;
                                    return (
                            <tr
                                key={`body-row-${rowIndex}`}
                                className="mtv-table-body-row"
                                data-edge-selected={edgeSelection?.kind === "row" && edgeSelection.index === rowIndex ? true : undefined}
                                style={{
                                    height: bodyRowRenderHeights[rowIndex] ?? rowHeights[rowIndex] ?? MIN_TABLE_ROW_HEIGHT,
                                }}
                            >
                                {row.map((cell, columnIndex) => {
                                    const position: MarkdownTableCellPosition = {
                                        section: "body",
                                        rowIndex,
                                        columnIndex,
                                    };
                                    const cellKey = buildCellKey(position);
                                    const isActiveCell = buildCellKey(activeCell) === cellKey;
                                    const isSelectedColumn = edgeSelection?.kind === "column" && edgeSelection.index === columnIndex;
                                    const isEditingCell = isTableFocused && isActiveCell && interactionMode === "editing";
                                    const isNavigationTarget = isTableFocused && isActiveCell && interactionMode === "navigation";
                                    return (
                                        <td
                                            key={cellKey}
                                            className="mtv-table-body-cell"
                                            data-edge-selected={isSelectedColumn ? true : undefined}
                                            ref={columnIndex === 0
                                                ? (element) => {
                                                    if (element) {
                                                        bodyRowMeasureRefs.current.set(rowIndex, element);
                                                        return;
                                                    }
                                                    bodyRowMeasureRefs.current.delete(rowIndex);
                                                }
                                                : undefined}
                                            style={{
                                                minHeight: bodyRowRenderHeights[rowIndex] ?? rowHeights[rowIndex] ?? MIN_TABLE_ROW_HEIGHT,
                                            }}
                                        >
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
                                            {renderRowResizeHandle(rowIndex)}
                                            {renderColumnResizeHandle(columnIndex)}
                                            {renderWikiLinkSuggestPopup(cellKey)}
                                        </td>
                                    );
                                })}
                            </tr>
                                    );
                                })}
                                {virtualRange.enabled && virtualRange.afterHeight > 0 ? (
                                    <tr
                                        className="mtv-table-virtual-spacer-row"
                                        aria-hidden="true"
                                        style={{ height: virtualRange.afterHeight }}
                                    >
                                        <td
                                            className="mtv-table-virtual-spacer-cell"
                                            style={{
                                                gridColumn: `span ${tableModel.headers.length}`,
                                                height: virtualRange.afterHeight,
                                            }}
                                        />
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            {renderContextMenu()}
        </div>
    );
}
