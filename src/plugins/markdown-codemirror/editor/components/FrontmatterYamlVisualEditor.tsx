/**
 * @module plugins/markdown-codemirror/editor/components/FrontmatterYamlVisualEditor
 * @description Frontmatter 可视化 YAML 编辑组件：支持结构化字段编辑与源码模式双向切换。
 * @dependencies
 *  - react
 *  - yaml
 *  - ../../../../host/layout/nativeContextMenu
 *  - ./FrontmatterYamlVisualEditor.css
 *
 * @example
 *   <FrontmatterYamlVisualEditor
 *     initialYamlText={yamlText}
 *     onSave={(nextYaml) => ({ success: true, message: "saved" })}
 *   />
 */

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type ComponentPropsWithoutRef,
    type FocusEvent,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
} from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import YAML from "yaml";
import { showNativeContextMenu } from "../../../../host/layout/nativeContextMenu";
import {
    isPlainFrontmatterVimKey,
    resolveFrontmatterEnterAction,
    resolveFrontmatterNavigationMove,
} from "../handoff/frontmatterVimHandoff";
import {
    shouldDeferBlurCommitAfterComposition,
    shouldSubmitPlainEnter,
} from "../../../../utils/imeInputGuard";
import "./FrontmatterYamlVisualEditor.css";

const {
    BookOpen,
    CalendarDays,
    ChevronDown,
    ChevronRight,
    CheckSquare,
    FileText,
    Hash,
    List,
    Minus,
    Plus,
} = LucideIcons;

const FRONTMATTER_WIDGET_FOCUS_CLASS = "cm-frontmatter-widget-focused";
const FRONTMATTER_VIM_NAV_SELECTOR = "[data-frontmatter-vim-nav='true']";
let pendingFrontmatterNavigationRestoreKey: string | null = null;

/**
 * @function restoreNavigationRowFocus
 * @description 在 frontmatter 组件重建后重试恢复指定字段行的导航焦点。
 * @param fieldKey 字段名。
 * @param attemptsRemaining 剩余重试次数。
 */
function restoreNavigationRowFocus(fieldKey: string, attemptsRemaining = 4): void {
    const rowElement = Array.from(document.querySelectorAll<HTMLElement>("[data-frontmatter-field-key]"))
        .find((element) => element.dataset.frontmatterFieldKey === fieldKey);

    if (rowElement) {
        rowElement.focus();
        if (document.activeElement === rowElement || attemptsRemaining <= 1) {
            return;
        }
    }

    if (attemptsRemaining <= 1) {
        return;
    }

    window.requestAnimationFrame(() => {
        restoreNavigationRowFocus(fieldKey, attemptsRemaining - 1);
    });
}

/**
 * @function tryRestoreNavigationRowFocusNow
 * @description 同步尝试恢复 frontmatter 导航行焦点，避免提交后首个 Vim 按键被旧输入框吞掉。
 * @param fieldKey 字段名。
 * @returns 若已成功聚焦目标导航行则返回 true。
 */
function tryRestoreNavigationRowFocusNow(fieldKey: string): boolean {
    const rowElement = Array.from(document.querySelectorAll<HTMLElement>("[data-frontmatter-field-key]"))
        .find((element) => element.dataset.frontmatterFieldKey === fieldKey);

    if (!rowElement) {
        return false;
    }

    rowElement.focus();
    return document.activeElement === rowElement;
}

/**
 * @type VisualYamlScalar
 * @description 可直接可视化编辑的基础类型。
 */
type VisualYamlScalar = string | number | boolean | null;

/**
 * @type VisualYamlArray
 * @description 可视化编辑器支持的数组类型（同构 scalar 数组）。
 */
type VisualYamlArray = Array<VisualYamlScalar>;

/**
 * @type VisualYamlValue
 * @description 可视化编辑器支持的字段值类型。
 */
type VisualYamlValue = VisualYamlScalar | VisualYamlArray;

/**
 * @type FrontmatterFieldType
 * @description 新增 frontmatter 字段时支持的字段类型。
 */
export type FrontmatterFieldType = "string" | "number" | "boolean" | "list" | "date" | "null";

/**
 * @type FrontmatterContextAction
 * @description frontmatter 行右键菜单支持的动作。
 */
type FrontmatterContextAction = FrontmatterFieldType | "remove";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @function formatLocalDate
 * @description 将日期对象格式化为本地 YYYY-MM-DD 字符串。
 * @param date 日期对象。
 * @returns 日期字符串。
 */
function formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${String(year)}-${month}-${day}`;
}

/**
 * @function normalizeDateString
 * @description 将原始日期字符串归一化为 YYYY-MM-DD；无法识别时返回 null。
 * @param rawValue 原始字符串。
 * @returns 规范化日期或 null。
 */
function normalizeDateString(rawValue: string): string | null {
    const trimmed = rawValue.trim();
    if (DATE_ONLY_RE.test(trimmed)) {
        return trimmed;
    }

    const isoCandidate = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T\s].*$/)?.[1] ?? null;
    if (isoCandidate && DATE_ONLY_RE.test(isoCandidate)) {
        return isoCandidate;
    }

    return null;
}

/**
 * @function resolveDateValue
 * @description 将任意 frontmatter 值转换为日期字段可用的 YYYY-MM-DD。
 * @param value 原始字段值。
 * @returns 可写入 date input 的字符串。
 */
function resolveDateValue(value: VisualYamlValue): string {
    if (typeof value === "string") {
        return normalizeDateString(value) ?? formatLocalDate(new Date());
    }

    return formatLocalDate(new Date());
}

/**
 * @interface SaveResult
 * @description 组件保存结果。
 */
interface SaveResult {
    /** 是否保存成功。 */
    success: boolean;
    /** 状态消息。 */
    message: string;
}

/**
 * @interface FrontmatterInlineTextFieldProps
 * @description frontmatter 单行文本编辑控件参数。
 */
interface FrontmatterInlineTextFieldProps extends Omit<ComponentPropsWithoutRef<"textarea">, "value" | "onChange"> {
    /** 当前文本值。 */
    value: string;
    /** 文本变更回调。 */
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}

/**
 * @function FrontmatterInlineTextField
 * @description 使用镜像文本与显式选区片段渲染单行文本编辑控件，避免依赖宿主原生选区绘制。
 * @param props 控件参数。
 * @returns React 节点。
 */
function FrontmatterInlineTextField(props: FrontmatterInlineTextFieldProps): ReactNode {
    const {
        className,
        value,
        onChange,
        onFocus,
        onBlur,
        onSelect,
        onKeyDown,
        style,
        placeholder,
        ...restProps
    } = props;
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
    const [isFocused, setIsFocused] = useState(false);

    const updateSelection = (target: HTMLTextAreaElement | null): void => {
        if (!target) {
            return;
        }

        setSelection({
            start: target.selectionStart ?? 0,
            end: target.selectionEnd ?? 0,
        });
    };

    useEffect(() => {
        if (!isFocused) {
            return;
        }

        let frameId = window.requestAnimationFrame(function syncSelection() {
            updateSelection(textareaRef.current);
            frameId = window.requestAnimationFrame(syncSelection);
        });

        return () => {
            window.cancelAnimationFrame(frameId);
        };
    }, [isFocused]);

    const selectedText = selection.end > selection.start ? value.slice(selection.start, selection.end) : "";
    const beforeSelection = value.slice(0, selection.start);
    const afterSelection = value.slice(selection.end);
    const shouldRenderSelection = selectedText.length > 0;
    const shouldRenderPlaceholder = value.length === 0 && Boolean(placeholder);
    const shouldRenderEmptyLine = value.length === 0 && !shouldRenderPlaceholder;

    return (
        <span className="fmv-inline-text-shell" style={style}>
            <span
                className={`${className ?? ""} fmv-inline-text-mirror-surface`}
                aria-hidden="true"
            >
                {value.length > 0 ? (
                    shouldRenderSelection ? (
                        <>
                            <span>{beforeSelection}</span>
                            <span className="fmv-inline-text-selection">{selectedText}</span>
                            <span>{afterSelection}</span>
                        </>
                    ) : (
                        value
                    )
                ) : shouldRenderPlaceholder ? (
                    <span className="fmv-inline-text-placeholder">{placeholder ?? ""}</span>
                ) : shouldRenderEmptyLine ? (
                    <span className="fmv-inline-text-empty">{"\u00A0"}</span>
                ) : null}
            </span>
            <textarea
                {...restProps}
                ref={textareaRef}
                className={`${className ?? ""} fmv-inline-text-control`}
                rows={1}
                wrap="off"
                value={value}
                placeholder={placeholder}
                onChange={(event) => {
                    onChange(event);
                    updateSelection(event.currentTarget);
                }}
                onFocus={(event) => {
                    setIsFocused(true);
                    updateSelection(event.currentTarget);
                    onFocus?.(event);
                }}
                onBlur={(event) => {
                    setIsFocused(false);
                    setSelection({ start: 0, end: 0 });
                    onBlur?.(event);
                }}
                onSelect={(event) => {
                    updateSelection(event.currentTarget);
                    onSelect?.(event);
                }}
                onKeyDown={onKeyDown}
            />
        </span>
    );
}

/**
 * @interface FrontmatterYamlVisualEditorProps
 * @description 组件输入参数。
 */
export interface FrontmatterYamlVisualEditorProps {
    /** 初始化 YAML 文本。 */
    initialYamlText: string;
    /** 将 frontmatter 同步回编辑器文档的回调（不负责最终写盘）。 */
    onCommitYaml: (yamlText: string) => SaveResult;
    /** 请求退出 frontmatter Vim 导航并返回正文。 */
    onRequestExitVimNavigation?: () => void;
}

/**
 * @function isScalar
 * @description 判断值是否为 scalar。
 * @param value 值。
 * @returns 是否为 scalar。
 */
function isScalar(value: unknown): value is VisualYamlScalar {
    return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * @function parseYamlToRecord
 * @description 将 YAML 文本解析为可编辑记录结构。
 * @param yamlText YAML 文本。
 * @returns 解析结果。
 */
function parseYamlToRecord(yamlText: string): Record<string, VisualYamlValue> {
    const parsed = YAML.parse(yamlText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
    }

    const source = parsed as Record<string, unknown>;
    const target: Record<string, VisualYamlValue> = {};

    Object.entries(source).forEach(([key, value]) => {
        if (isScalar(value)) {
            target[key] = value;
            return;
        }

        if (Array.isArray(value) && value.every((item) => isScalar(item))) {
            target[key] = value as VisualYamlArray;
            return;
        }

        target[key] = JSON.stringify(value, null, 2);
    });

    return target;
}

/**
 * @function stringifyRecordToYaml
 * @description 将可编辑记录结构序列化为 YAML 文本。
 * @param record 记录结构。
 * @returns YAML 文本。
 */
function stringifyRecordToYaml(record: Record<string, VisualYamlValue>): string {
    return YAML.stringify(record, {
        lineWidth: 0,
    }).trimEnd();
}

/**
 * @function buildDefaultValueByFieldType
 * @description 根据字段类型构造默认值。
 * @param fieldType 字段类型。
 * @returns 对应类型的默认值。
 */
export function buildDefaultValueByFieldType(fieldType: FrontmatterFieldType): VisualYamlValue {
    if (fieldType === "date") {
        return formatLocalDate(new Date());
    }

    if (fieldType === "number") {
        return 0;
    }

    if (fieldType === "boolean") {
        return false;
    }

    if (fieldType === "list") {
        return [];
    }

    if (fieldType === "null") {
        return null;
    }

    return "";
}

/**
 * @function convertValueToFieldType
 * @description 将当前字段值转换为目标字段类型，尽量保留已有信息。
 * @param value 当前字段值。
 * @param fieldType 目标字段类型。
 * @returns 转换后的字段值。
 */
export function convertValueToFieldType(
    value: VisualYamlValue,
    fieldType: FrontmatterFieldType,
): VisualYamlValue {
    if (fieldType === "list") {
        if (Array.isArray(value)) {
            return value;
        }

        if (value === null || value === "") {
            return [];
        }

        return [value];
    }

    if (fieldType === "date") {
        return resolveDateValue(value);
    }

    if (fieldType === "null") {
        return null;
    }

    if (fieldType === "boolean") {
        if (Array.isArray(value)) {
            return value.length > 0;
        }

        if (typeof value === "boolean") {
            return value;
        }

        if (typeof value === "number") {
            return value !== 0;
        }

        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (normalized === "true") {
                return true;
            }
            if (normalized === "false") {
                return false;
            }

            return normalized.length > 0;
        }

        return false;
    }

    if (fieldType === "number") {
        if (Array.isArray(value)) {
            return value.length;
        }

        if (typeof value === "number") {
            return value;
        }

        if (typeof value === "boolean") {
            return value ? 1 : 0;
        }

        if (typeof value === "string") {
            const parsed = Number(value.trim());
            return Number.isFinite(parsed) ? parsed : 0;
        }

        return 0;
    }

    if (Array.isArray(value)) {
        return value.join(", ");
    }

    if (value === null) {
        return "";
    }

    return String(value);
}

/**
 * @function resolveFieldBaseName
 * @description 为新增字段生成基础字段名前缀。
 * @param fieldType 字段类型。
 * @returns 基础字段名前缀。
 */
function resolveFieldBaseName(fieldType: FrontmatterFieldType): string {
    if (fieldType === "number") {
        return "numberField";
    }

    if (fieldType === "boolean") {
        return "booleanField";
    }

    if (fieldType === "list") {
        return "listField";
    }

    if (fieldType === "date") {
        return "dateField";
    }

    if (fieldType === "null") {
        return "nullField";
    }

    return "newField";
}

/**
 * @function resolveNextFieldKey
 * @description 为新增字段生成不冲突的字段名。
 * @param record 当前 frontmatter 草稿。
 * @param fieldType 字段类型。
 * @returns 可安全写入的新字段名。
 */
export function resolveNextFieldKey(
    record: Record<string, VisualYamlValue>,
    fieldType: FrontmatterFieldType,
): string {
    const baseName = resolveFieldBaseName(fieldType);
    if (!Object.prototype.hasOwnProperty.call(record, baseName)) {
        return baseName;
    }

    let suffix = 2;
    while (Object.prototype.hasOwnProperty.call(record, `${baseName}${String(suffix)}`)) {
        suffix += 1;
    }

    return `${baseName}${String(suffix)}`;
}

/**
 * @function renameRecordKey
 * @description 重命名记录中的字段名，并保持原有字段顺序。
 * @param record 当前 frontmatter 草稿。
 * @param previousKey 原字段名。
 * @param nextKey 新字段名。
 * @returns 重命名后的记录对象。
 */
function renameRecordKey(
    record: Record<string, VisualYamlValue>,
    previousKey: string,
    nextKey: string,
): Record<string, VisualYamlValue> {
    return Object.entries(record).reduce<Record<string, VisualYamlValue>>((accumulator, [key, value]) => {
        if (key === previousKey) {
            accumulator[nextKey] = value;
            return accumulator;
        }

        accumulator[key] = value;
        return accumulator;
    }, {});
}

/**
 * @function resolveFieldType
 * @description 根据值结构推导 frontmatter 字段类型。
 * @param value 字段值。
 * @returns 推导出的字段类型。
 */
function resolveFieldType(value: VisualYamlValue): FrontmatterFieldType {
    if (value === null) {
        return "null";
    }

    if (Array.isArray(value)) {
        return "list";
    }

    if (typeof value === "boolean") {
        return "boolean";
    }

    if (typeof value === "number") {
        return "number";
    }

    if (typeof value === "string" && normalizeDateString(value)) {
        return "date";
    }

    return "string";
}

/**
 * @function resolveFieldIcon
 * @description 为属性行选择可直接表达当前字段类型的图标。
 * @param value 字段值。
 * @returns 对应的 Lucide 图标组件。
 */
function resolveFieldIcon(value: VisualYamlValue): LucideIcon {
    const fieldType = resolveFieldType(value);
    if (fieldType === "boolean") {
        return CheckSquare;
    }

    if (fieldType === "number") {
        return Hash;
    }

    if (fieldType === "list") {
        return List;
    }

    if (fieldType === "date") {
        return CalendarDays;
    }

    if (fieldType === "null") {
        return Minus;
    }

    return FileText;
}

/**
 * @function FrontmatterYamlVisualEditor
 * @description 渲染 frontmatter 的可视化 YAML 编辑器。
 * @param props 组件参数。
 * @returns React 节点。
 */
export function FrontmatterYamlVisualEditor(props: FrontmatterYamlVisualEditorProps): ReactNode {
    const { t } = useTranslation();
    const wrapperRef = useRef<HTMLElement | null>(null);
    const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const [recordDraft, setRecordDraft] = useState<Record<string, VisualYamlValue>>(() =>
        parseYamlToRecord(props.initialYamlText),
    );
    const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
    const [editingListItem, setEditingListItem] = useState<{ key: string; index: number } | null>(null);
    const [editingListDraft, setEditingListDraft] = useState<string>("");
    const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
    const lastCommittedYamlRef = useRef<string>(props.initialYamlText.trimEnd());
    const pendingNavigationFocusFieldRef = useRef<string | null>(null);
    const isInputComposingRef = useRef(false);
    const lastInputCompositionEndAtRef = useRef(0);

    const fieldEntries = useMemo(() => Object.entries(recordDraft), [recordDraft]);

    useEffect(() => {
        const pendingFieldKey = pendingNavigationFocusFieldRef.current ?? pendingFrontmatterNavigationRestoreKey;
        if (!pendingFieldKey) {
            return;
        }

        const rowElement = rowRefs.current.get(pendingFieldKey);
        if (!rowElement) {
            return;
        }

        pendingNavigationFocusFieldRef.current = null;
        pendingFrontmatterNavigationRestoreKey = null;
        restoreNavigationRowFocus(pendingFieldKey);
    }, [fieldEntries, editingListItem]);

    /**
     * @function syncEditorFocusClass
     * @description 同步宿主 CodeMirror 的 frontmatter 聚焦样式类。
     * @param focused 当前组件是否处于聚焦态。
     */
    const syncEditorFocusClass = (focused: boolean): void => {
        const editorElement = wrapperRef.current?.closest(".cm-editor");
        if (!(editorElement instanceof HTMLElement)) {
            return;
        }

        editorElement.classList.toggle(FRONTMATTER_WIDGET_FOCUS_CLASS, focused);
    };

    /**
     * @function resolveNavigationTargets
     * @description 解析当前 frontmatter 中所有 Vim 导航目标。
     * @returns 导航目标列表。
     */
    const resolveNavigationTargets = (): HTMLElement[] => {
        if (!wrapperRef.current) {
            return [];
        }

        return Array.from(wrapperRef.current.querySelectorAll<HTMLElement>(FRONTMATTER_VIM_NAV_SELECTOR));
    };

    /**
     * @function focusNavigationRow
     * @description 将焦点返回到指定字段所在的导航行。
     * @param fieldKey 字段名。
     */
    const focusNavigationRow = (fieldKey: string): void => {
        pendingNavigationFocusFieldRef.current = fieldKey;
        pendingFrontmatterNavigationRestoreKey = fieldKey;
        if (tryRestoreNavigationRowFocusNow(fieldKey)) {
            return;
        }

        window.requestAnimationFrame(() => {
            restoreNavigationRowFocus(fieldKey);
        });
    };

    /**
     * @function focusPreferredFieldForRow
     * @description 从导航行进入当前字段的主要可编辑控件。
     * @param fieldKey 字段名。
     * @param value 字段值。
     */
    const focusPreferredFieldForRow = (fieldKey: string, value: VisualYamlValue): void => {
        if (resolveFrontmatterEnterAction(value) === "toggle-boolean") {
            commitWithNextRecord({
                ...recordDraft,
                [fieldKey]: !Boolean(value),
            });
            focusNavigationRow(fieldKey);
            return;
        }

        const rowElement = rowRefs.current.get(fieldKey);
        if (!rowElement) {
            return;
        }

        const valueTarget = rowElement.querySelector<HTMLElement>("[data-frontmatter-focus-role='value']");
        const keyTarget = rowElement.querySelector<HTMLElement>("[data-frontmatter-focus-role='key']");
        const target = valueTarget ?? keyTarget;
        if (!target) {
            rowElement.focus();
            return;
        }

        if (target instanceof HTMLButtonElement) {
            target.focus();
            target.click();
            return;
        }

        target.focus();
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            const caretOffset = target.value.length;
            target.setSelectionRange?.(caretOffset, caretOffset);
        }
    };

    /**
     * @function handleVimNavigationTargetKeyDown
     * @description 处理导航层中的 Vim handoff 按键。
     * @param event 键盘事件。
     * @param fieldKey 当前字段名。
     * @param value 当前字段值。
     */
    const handleVimNavigationTargetKeyDown = (
        event: KeyboardEvent<HTMLElement>,
        fieldKey?: string,
        value?: VisualYamlValue,
    ): void => {
        if (event.target !== event.currentTarget) {
            return;
        }

        if (isPlainFrontmatterVimKey(event, "j") || isPlainFrontmatterVimKey(event, "k")) {
            const targets = resolveNavigationTargets();
            const currentIndex = targets.indexOf(event.currentTarget);
            const result = resolveFrontmatterNavigationMove(
                currentIndex,
                targets.length,
                event.key === "j" ? "next" : "previous",
            );

            event.preventDefault();
            event.stopPropagation();

            if (result.kind === "move") {
                targets[result.index]?.focus();
                return;
            }

            if (result.kind === "exit-body") {
                props.onRequestExitVimNavigation?.();
            }

            return;
        }

        if (isPlainFrontmatterVimKey(event, "Enter")) {
            event.preventDefault();
            event.stopPropagation();

            if (fieldKey && value !== undefined) {
                focusPreferredFieldForRow(fieldKey, value);
                return;
            }

            if (event.currentTarget instanceof HTMLButtonElement) {
                event.currentTarget.click();
            }
            return;
        }

        if (isPlainFrontmatterVimKey(event, "Escape")) {
            event.preventDefault();
            event.stopPropagation();
            props.onRequestExitVimNavigation?.();
        }
    };

    /**
     * @function handleWrapperFocusCapture
     * @description frontmatter 获得焦点时同步宿主聚焦样式。
     */
    const handleWrapperFocusCapture = (): void => {
        syncEditorFocusClass(true);
    };

    /**
     * @function handleWrapperBlurCapture
     * @description frontmatter 完全失焦时清理宿主聚焦样式。
     * @param event 焦点事件。
     */
    const handleWrapperBlurCapture = (event: FocusEvent<HTMLElement>): void => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && wrapperRef.current?.contains(nextTarget)) {
            return;
        }

        syncEditorFocusClass(false);
    };

    /**
     * @function setRowRef
     * @description 维护字段行节点引用。
     * @param fieldKey 字段名。
     * @param node 行节点。
     */
    const setRowRef = (fieldKey: string, node: HTMLDivElement | null): void => {
        if (node) {
            rowRefs.current.set(fieldKey, node);
            return;
        }

        rowRefs.current.delete(fieldKey);
    };

    /**
     * @function handleInputCompositionStart
     * @description 标记 frontmatter 输入框进入输入法组合态。
     */
    const handleInputCompositionStart = (): void => {
        isInputComposingRef.current = true;
    };

    /**
     * @function handleInputCompositionEnd
     * @description 标记 frontmatter 输入框退出输入法组合态，并记录结束时间戳。
     */
    const handleInputCompositionEnd = (): void => {
        isInputComposingRef.current = false;
        lastInputCompositionEndAtRef.current = performance.now();
    };

    /**
     * @function shouldDeferInputBlurCommit
     * @description 判断 frontmatter 输入框 blur 是否应延后提交，避免候选确认误触发保存。
     * @returns `true` 表示本次 blur 不应提交。
     */
    const shouldDeferInputBlurCommit = (): boolean => {
        return shouldDeferBlurCommitAfterComposition({
            isComposing: isInputComposingRef.current,
            lastCompositionEndAt: lastInputCompositionEndAtRef.current,
            now: performance.now(),
        });
    };

    /**
     * @function shouldSubmitFrontmatterPlainEnter
     * @description 判断当前 frontmatter 的 Enter 是否应视为提交，而不是输入法候选确认。
     * @param event 键盘事件。
     * @returns `true` 表示可以提交；`false` 表示应忽略本次 Enter。
     */
    const shouldSubmitFrontmatterPlainEnter = (
        event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>,
    ): boolean => {
        if (!shouldSubmitPlainEnter({
            key: event.key,
            nativeEvent: event.nativeEvent,
        })) {
            return false;
        }

        return !shouldDeferBlurCommitAfterComposition({
            isComposing: isInputComposingRef.current,
            lastCompositionEndAt: lastInputCompositionEndAtRef.current,
            now: performance.now(),
        });
    };

    /**
     * @function commitRecordDraft
     * @description 将当前草稿同步回编辑器文档。
     */
    const commitRecordDraft = (): void => {
        const nextYaml = stringifyRecordToYaml(recordDraft);
        if (nextYaml === lastCommittedYamlRef.current) {
            return;
        }

        const result = props.onCommitYaml(nextYaml);
        if (result.success) {
            lastCommittedYamlRef.current = nextYaml;
        }
    };

    /**
     * @function commitWithNextRecord
     * @description 使用 nextRecord 同步更新本地草稿并写回编辑器文档。
     * @param nextRecord 下一个草稿。
     */
    const commitWithNextRecord = (nextRecord: Record<string, VisualYamlValue>): void => {
        setRecordDraft(nextRecord);

        const nextYaml = stringifyRecordToYaml(nextRecord);
        if (nextYaml === lastCommittedYamlRef.current) {
            return;
        }

        const result = props.onCommitYaml(nextYaml);
        if (result.success) {
            lastCommittedYamlRef.current = nextYaml;
        }
    };

    /**
     * @function clearKeyDraft
     * @description 清理单个字段名编辑草稿。
     * @param fieldKey 字段名。
     */
    const clearKeyDraft = (fieldKey: string): void => {
        setKeyDrafts((previous) => {
            if (!(fieldKey in previous)) {
                return previous;
            }

            const nextDrafts = { ...previous };
            delete nextDrafts[fieldKey];
            return nextDrafts;
        });
    };

    /**
     * @function commitFieldKeyRename
     * @description 提交字段名重命名。
     * @param previousKey 原字段名。
     * @returns 提交后应恢复焦点的字段名；未发生重命名时返回原字段名，无法提交时返回 null。
     */
    const commitFieldKeyRename = (previousKey: string): string | null => {
        const draftValue = keyDrafts[previousKey];
        if (draftValue === undefined) {
            return previousKey;
        }

        const nextKey = draftValue.trim();
        if (nextKey.length === 0) {
            console.warn("[frontmatter-editor] rename skipped: empty field key", {
                previousKey,
            });
            clearKeyDraft(previousKey);
            return previousKey;
        }

        if (nextKey === previousKey) {
            clearKeyDraft(previousKey);
            return previousKey;
        }

        if (Object.prototype.hasOwnProperty.call(recordDraft, nextKey)) {
            console.warn("[frontmatter-editor] rename skipped: duplicated field key", {
                previousKey,
                nextKey,
            });
            clearKeyDraft(previousKey);
            return previousKey;
        }

        console.info("[frontmatter-editor] rename field", {
            previousKey,
            nextKey,
        });

        const nextRecord = renameRecordKey(recordDraft, previousKey, nextKey);
        commitWithNextRecord(nextRecord);
        setEditingListItem((previous) => {
            if (!previous || previous.key !== previousKey) {
                return previous;
            }

            return {
                ...previous,
                key: nextKey,
            };
        });
        clearKeyDraft(previousKey);
        return nextKey;
    };

    /**
     * @function addFieldByType
     * @description 按指定类型新增一行 frontmatter 字段。
     * @param fieldType 字段类型。
     */
    const addFieldByType = (fieldType: FrontmatterFieldType): void => {
        const nextKey = resolveNextFieldKey(recordDraft, fieldType);
        console.info("[frontmatter-editor] add field", {
            fieldType,
            nextKey,
        });

        commitWithNextRecord({
            ...recordDraft,
            [nextKey]: buildDefaultValueByFieldType(fieldType),
        });
    };

    /**
     * @function requestFieldTypeSelection
     * @description 通过原生右键菜单请求用户选择字段的数据类型。
     * @returns 选中的字段类型；取消时返回 null。
     */
    const requestFieldContextAction = async (): Promise<FrontmatterContextAction | null> => {
        const selectedAction = await showNativeContextMenu([
            { id: "string", text: t("frontmatter.typeString") },
            { id: "number", text: t("frontmatter.typeNumber") },
            { id: "boolean", text: t("frontmatter.typeBoolean") },
            { id: "list", text: t("frontmatter.typeList") },
            { id: "date", text: t("frontmatter.typeDate") },
            { id: "null", text: t("frontmatter.typeNull") },
            { id: "remove", text: t("frontmatter.removeField") },
        ]);

        if (
            selectedAction === "string" ||
            selectedAction === "number" ||
            selectedAction === "boolean" ||
            selectedAction === "list" ||
            selectedAction === "date" ||
            selectedAction === "null" ||
            selectedAction === "remove"
        ) {
            return selectedAction;
        }

        return null;
    };

    /**
     * @function changeFieldType
     * @description 将指定字段转换为目标数据类型。
     * @param fieldKey 字段名。
     * @param fieldType 目标字段类型。
     */
    const changeFieldType = (fieldKey: string, fieldType: FrontmatterFieldType): void => {
        const currentValue = recordDraft[fieldKey];
        if (currentValue === undefined) {
            console.warn("[frontmatter-editor] change type skipped: field missing", {
                fieldKey,
                fieldType,
            });
            return;
        }

        console.info("[frontmatter-editor] change field type", {
            fieldKey,
            fieldType,
        });

        commitWithNextRecord({
            ...recordDraft,
            [fieldKey]: convertValueToFieldType(currentValue, fieldType),
        });
    };

    /**
     * @function removeField
     * @description 删除指定 frontmatter 字段。
     * @param fieldKey 字段名。
     */
    const removeField = (fieldKey: string): void => {
        if (!(fieldKey in recordDraft)) {
            console.warn("[frontmatter-editor] remove skipped: field missing", {
                fieldKey,
            });
            return;
        }

        console.info("[frontmatter-editor] remove field", {
            fieldKey,
        });

        const nextRecord = Object.entries(recordDraft).reduce<Record<string, VisualYamlValue>>((accumulator, [key, value]) => {
            if (key !== fieldKey) {
                accumulator[key] = value;
            }
            return accumulator;
        }, {});

        commitWithNextRecord(nextRecord);
        clearKeyDraft(fieldKey);
        if (editingListItem?.key === fieldKey) {
            setEditingListItem(null);
            setEditingListDraft("");
        }
    };

    /**
     * @function openFieldTypeMenu
     * @description 打开指定字段的类型切换菜单。
     * @param fieldKey 字段名。
     */
    const openFieldTypeMenu = async (fieldKey: string): Promise<void> => {
        const selectedType = await requestFieldContextAction();
        if (!selectedType) {
            return;
        }

        if (selectedType === "remove") {
            removeField(fieldKey);
            return;
        }

        changeFieldType(fieldKey, selectedType);
    };

    /**
     * @function handleFieldRowContextMenu
     * @description 响应字段行右键菜单，将当前行转换为指定数据类型。
     * @param event 鼠标事件。
     * @param fieldKey 字段名。
     */
    const handleFieldRowContextMenu = async (
        event: MouseEvent<HTMLDivElement>,
        fieldKey: string,
    ): Promise<void> => {
        event.preventDefault();
        const selectedAction = await requestFieldContextAction();
        if (!selectedAction) {
            return;
        }

        if (selectedAction === "remove") {
            removeField(fieldKey);
            return;
        }

        changeFieldType(fieldKey, selectedAction);
    };

    /**
     * @function handleFieldKeyKeyDown
     * @description 处理字段名输入框快捷键。
     * @param event 键盘事件。
     * @param fieldKey 当前字段名。
     */
    const handleFieldKeyKeyDown = (
        event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
        fieldKey: string,
    ): void => {
        if (shouldSubmitFrontmatterPlainEnter(event)) {
            event.preventDefault();
            event.stopPropagation();
            const nextFieldKey = commitFieldKeyRename(fieldKey);
            if (nextFieldKey) {
                focusNavigationRow(nextFieldKey);
            }
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            clearKeyDraft(fieldKey);
            focusNavigationRow(fieldKey);
        }
    };

    /**
     * @function commitListItemEdit
     * @description 提交当前列表项编辑并退出编辑态。
     */
    const commitListItemEdit = (): void => {
        if (!editingListItem) {
            return;
        }

        const { key, index } = editingListItem;
        const trimmed = editingListDraft.trim();
        const previousList = (recordDraft[key] as VisualYamlArray) ?? [];
        const nextList = [...previousList];
        const nextRecord: Record<string, VisualYamlValue> = {
            ...recordDraft,
        };

        if (trimmed.length === 0) {
            nextRecord[key] = nextList.filter((_, itemIndex) => itemIndex !== index);
        } else {
            nextList[index] = editingListDraft;
            nextRecord[key] = nextList;
        }

        commitWithNextRecord(nextRecord);

        setEditingListItem(null);
        setEditingListDraft("");
    };

    /**
     * @function renderValueControl
     * @description 渲染单个字段的可视化控件。
     * @param key 字段名。
     * @param value 字段值。
     * @returns React 节点。
     */
    const renderValueControl = (key: string, value: VisualYamlValue): ReactNode => {
        if (typeof value === "boolean") {
            return (
                <div className="fmv-bool">
                    <button
                        id={`fmv-bool-${key}`}
                        type="button"
                        className={`fmv-bool-indicator${value ? " fmv-bool-indicator-checked" : ""}`}
                        data-frontmatter-field-focusable="true"
                        data-frontmatter-focus-role="value"
                        aria-pressed={value}
                        onClick={() => {
                            commitWithNextRecord({
                                ...recordDraft,
                                [key]: !value,
                            });
                        }}
                        onKeyDown={(event) => {
                            if (shouldSubmitFrontmatterPlainEnter(event)) {
                                event.preventDefault();
                                event.stopPropagation();
                                commitWithNextRecord({
                                    ...recordDraft,
                                    [key]: !value,
                                });
                                return;
                            }

                            if (event.key === "Escape") {
                                event.preventDefault();
                                event.stopPropagation();
                                focusNavigationRow(key);
                            }
                        }}
                    >
                        <CheckSquare size={14} strokeWidth={1.8} aria-hidden="true" />
                        {value ? "true" : "false"}
                    </button>
                </div>
            );
        }

        if (typeof value === "number") {
            return (
                <input
                    className="fmv-input fmv-input-number"
                    data-frontmatter-field-focusable="true"
                    data-frontmatter-focus-role="value"
                    type="number"
                    value={String(value)}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const nextNumber = Number(event.target.value);
                        setRecordDraft((previous) => ({
                            ...previous,
                            [key]: Number.isFinite(nextNumber) ? nextNumber : 0,
                        }));
                    }}
                    onCompositionStart={handleInputCompositionStart}
                    onCompositionEnd={handleInputCompositionEnd}
                    onBlur={() => {
                        if (shouldDeferInputBlurCommit()) {
                            return;
                        }

                        commitRecordDraft();
                    }}
                    onKeyDown={(event) => {
                        if (shouldSubmitFrontmatterPlainEnter(event)) {
                            event.preventDefault();
                            event.stopPropagation();
                            commitRecordDraft();
                            focusNavigationRow(key);
                            return;
                        }

                        if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            commitRecordDraft();
                            focusNavigationRow(key);
                        }
                    }}
                />
            );
        }

        if (resolveFieldType(value) === "date") {
            return (
                <input
                    className="fmv-input fmv-input-date"
                    data-frontmatter-field-focusable="true"
                    data-frontmatter-focus-role="value"
                    type="date"
                    value={resolveDateValue(value)}
                    onClick={(event: ChangeEvent<HTMLInputElement> | MouseEvent<HTMLInputElement>) => {
                        const dateInput = event.currentTarget as HTMLInputElement & { showPicker?: () => void };
                        if (typeof dateInput.showPicker === "function") {
                            try {
                                dateInput.showPicker();
                            } catch {
                                // 浏览器不支持或当前时机不可调用时，退回原生 date input 默认行为。
                            }
                        }
                    }}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        setRecordDraft((previous) => ({
                            ...previous,
                            [key]: event.target.value,
                        }));
                    }}
                    onBlur={() => {
                        if (shouldDeferInputBlurCommit()) {
                            return;
                        }

                        commitRecordDraft();
                    }}
                    onKeyDown={(event) => {
                        if (shouldSubmitFrontmatterPlainEnter(event)) {
                            event.preventDefault();
                            event.stopPropagation();
                            commitRecordDraft();
                            focusNavigationRow(key);
                            return;
                        }

                        if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            commitRecordDraft();
                            focusNavigationRow(key);
                        }
                    }}
                />
            );
        }

        if (Array.isArray(value)) {
            return (
                <div className="fmv-list">
                    {value.map((item, index) => (
                        <div key={`${key}-${String(index)}`} className="fmv-list-item">
                            {editingListItem?.key === key && editingListItem.index === index ? (
                                <FrontmatterInlineTextField
                                    className="fmv-list-item-input"
                                    data-frontmatter-field-focusable="true"
                                    data-frontmatter-focus-role="value"
                                    value={editingListDraft}
                                    style={{ width: `${String(Math.max(4, editingListDraft.length + 1))}ch` }}
                                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                                        setEditingListDraft(event.target.value);
                                    }}
                                    onCompositionStart={handleInputCompositionStart}
                                    onCompositionEnd={handleInputCompositionEnd}
                                    onBlur={() => {
                                        if (shouldDeferInputBlurCommit()) {
                                            return;
                                        }

                                        commitListItemEdit();
                                    }}
                                    onKeyDown={(event) => {
                                        if (shouldSubmitFrontmatterPlainEnter(event)) {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            commitListItemEdit();
                                            focusNavigationRow(key);
                                            return;
                                        }

                                        if (event.key === "Escape") {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            commitListItemEdit();
                                            focusNavigationRow(key);
                                        }
                                    }}
                                    autoFocus
                                />
                            ) : (
                                <button
                                    type="button"
                                    className="fmv-list-item-read"
                                    data-frontmatter-field-focusable="true"
                                    data-frontmatter-focus-role="value"
                                    onClick={() => {
                                        const text = item === null ? "null" : String(item);
                                        setEditingListItem({ key, index });
                                        setEditingListDraft(text);
                                    }}
                                    title={t("frontmatter.clickToEdit")}
                                >
                                    {item === null ? "null" : String(item)}
                                </button>
                            )}
                            <button
                                type="button"
                                className="fmv-mini-action-remove"
                                onClick={() => {
                                    const shouldClearEdit =
                                        editingListItem?.key === key && editingListItem.index === index;
                                    const previousList = (recordDraft[key] as VisualYamlArray) ?? [];
                                    const nextList = previousList.filter((_, itemIndex) => itemIndex !== index);
                                    commitWithNextRecord({
                                        ...recordDraft,
                                        [key]: nextList,
                                    });

                                    if (shouldClearEdit) {
                                        setEditingListItem(null);
                                        setEditingListDraft("");
                                    }
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        className="fmv-mini-action"
                        data-frontmatter-focus-role="value"
                        onClick={() => {
                            const currentList = (recordDraft[key] as VisualYamlArray) ?? [];
                            const nextIndex = currentList.length;

                            setRecordDraft((previous) => {
                                const previousList = (previous[key] as VisualYamlArray) ?? [];
                                return {
                                    ...previous,
                                    [key]: [...previousList, ""],
                                };
                            });

                            setEditingListItem({ key, index: nextIndex });
                            setEditingListDraft("");
                        }}
                        title={t("frontmatter.addField")}
                    >
                        +
                    </button>
                </div>
            );
        }

        if (value === null) {
            return <span className="fmv-null-pill">{t("frontmatter.typeNull")}</span>;
        }

        return (
            <FrontmatterInlineTextField
                className="fmv-input"
                data-frontmatter-field-focusable="true"
                data-frontmatter-focus-role="value"
                value={String(value)}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                    setRecordDraft((previous) => ({
                        ...previous,
                        [key]: event.target.value,
                    }));
                }}
                onCompositionStart={handleInputCompositionStart}
                onCompositionEnd={handleInputCompositionEnd}
                onBlur={() => {
                    if (shouldDeferInputBlurCommit()) {
                        return;
                    }

                    commitRecordDraft();
                }}
                onKeyDown={(event) => {
                    if (shouldSubmitFrontmatterPlainEnter(event)) {
                        event.preventDefault();
                        event.stopPropagation();
                        commitRecordDraft();
                        focusNavigationRow(key);
                        return;
                    }

                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        commitRecordDraft();
                        focusNavigationRow(key);
                    }
                }}
            />
        );
    };

    return (
        <section
            ref={wrapperRef}
            className="fmv-editor"
            onFocusCapture={handleWrapperFocusCapture}
            onBlurCapture={handleWrapperBlurCapture}
        >
            {/* fmv-header-toggle: 带图标的折叠头部，负责显示/隐藏属性列表。 */}
            <button
                type="button"
                className="fmv-header-toggle fmv-vim-nav-target"
                data-frontmatter-vim-nav="true"
                onClick={() => {
                    setIsCollapsed((previous) => !previous);
                }}
                aria-expanded={!isCollapsed}
                aria-label={t("frontmatter.togglePanel")}
                onKeyDown={(event) => {
                    handleVimNavigationTargetKeyDown(event);
                }}
            >
                <span className="fmv-header-leading" aria-hidden="true">
                    <BookOpen size={16} strokeWidth={1.8} />
                    <span className="fmv-header-chevron">
                        {isCollapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
                    </span>
                </span>
                <span className="fmv-header-title">{t("frontmatter.panelTitle")}</span>
            </button>

            {/* fmv-grid: 属性主体区，按 properties 面板样式组织每个字段。 */}
            {!isCollapsed ? (
                <>
                    <div className="fmv-grid">
                        {fieldEntries.length === 0 ? (
                            <div className="fmv-empty">{t("frontmatter.emptyFrontmatter")}</div>
                        ) : (
                            fieldEntries.map(([key, value]) => {
                                const FieldIcon = resolveFieldIcon(value);

                                return (
                                    <div
                                        key={key}
                                        ref={(node) => {
                                            setRowRef(key, node);
                                        }}
                                        className="fmv-row fmv-vim-nav-target"
                                        data-frontmatter-vim-nav="true"
                                        data-frontmatter-field-key={key}
                                        tabIndex={-1}
                                        onContextMenu={(event) => {
                                            void handleFieldRowContextMenu(event, key);
                                        }}
                                        onKeyDown={(event) => {
                                            handleVimNavigationTargetKeyDown(event, key, value);
                                        }}
                                        onMouseDown={(event) => {
                                            if (event.target === event.currentTarget) {
                                                event.preventDefault();
                                                event.currentTarget.focus();
                                            }
                                        }}
                                    >
                                        <div className="fmv-field-meta">
                                            <button
                                                type="button"
                                                className="fmv-field-icon-button"
                                                onClick={() => {
                                                    void openFieldTypeMenu(key);
                                                }}
                                                title={t("frontmatter.changeType")}
                                                aria-label={t("frontmatter.changeType")}
                                            >
                                                <span className="fmv-field-icon" aria-hidden="true">
                                                    <FieldIcon size={16} strokeWidth={1.8} />
                                                </span>
                                            </button>
                                            <div className="fmv-field-copy">
                                                <FrontmatterInlineTextField
                                                    className="fmv-key-input"
                                                    data-frontmatter-field-focusable="true"
                                                    data-frontmatter-focus-role="key"
                                                    value={keyDrafts[key] ?? key}
                                                    placeholder={t("frontmatter.keyPlaceholder")}
                                                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                                                        const nextDraftValue = event.target.value;
                                                        setKeyDrafts((previous) => ({
                                                            ...previous,
                                                            [key]: nextDraftValue,
                                                        }));
                                                    }}
                                                    onCompositionStart={handleInputCompositionStart}
                                                    onCompositionEnd={handleInputCompositionEnd}
                                                    onBlur={() => {
                                                        if (shouldDeferInputBlurCommit()) {
                                                            return;
                                                        }

                                                        commitFieldKeyRename(key);
                                                    }}
                                                    onKeyDown={(event) => {
                                                        handleFieldKeyKeyDown(event, key);
                                                    }}
                                                />
                                            </div>
                                        </div>
                                        <div className="fmv-control-shell">
                                            <div className="fmv-control">{renderValueControl(key, value)}</div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* fmv-footer: 属性新增入口，使用完整按钮文案而非孤立加号。 */}
                    <div className="fmv-footer">
                        <button
                            type="button"
                            className="fmv-add-button fmv-vim-nav-target"
                            data-frontmatter-vim-nav="true"
                            onClick={() => {
                                addFieldByType("string");
                            }}
                            title={t("frontmatter.addProperty")}
                            aria-label={t("frontmatter.addProperty")}
                            onKeyDown={(event) => {
                                handleVimNavigationTargetKeyDown(event);
                            }}
                        >
                            <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
                            <span>{t("frontmatter.addProperty")}</span>
                        </button>
                    </div>
                </>
            ) : null}
        </section>
    );
}
