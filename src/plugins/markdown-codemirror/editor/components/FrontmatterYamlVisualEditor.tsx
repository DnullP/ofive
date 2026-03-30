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

import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import YAML from "yaml";
import { showNativeContextMenu } from "../../../../host/layout/nativeContextMenu";
import "./FrontmatterYamlVisualEditor.css";

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
export type FrontmatterFieldType = "string" | "number" | "boolean" | "list" | "null";

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
 * @interface FrontmatterYamlVisualEditorProps
 * @description 组件输入参数。
 */
export interface FrontmatterYamlVisualEditorProps {
    /** 初始化 YAML 文本。 */
    initialYamlText: string;
    /** 将 frontmatter 同步回编辑器文档的回调（不负责最终写盘）。 */
    onCommitYaml: (yamlText: string) => SaveResult;
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
 * @function FrontmatterYamlVisualEditor
 * @description 渲染 frontmatter 的可视化 YAML 编辑器。
 * @param props 组件参数。
 * @returns React 节点。
 */
export function FrontmatterYamlVisualEditor(props: FrontmatterYamlVisualEditorProps): ReactNode {
    const { t } = useTranslation();
    const [recordDraft, setRecordDraft] = useState<Record<string, VisualYamlValue>>(() =>
        parseYamlToRecord(props.initialYamlText),
    );
    const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
    const [editingListItem, setEditingListItem] = useState<{ key: string; index: number } | null>(null);
    const [editingListDraft, setEditingListDraft] = useState<string>("");
    const lastCommittedYamlRef = useRef<string>(props.initialYamlText.trimEnd());

    const fieldEntries = useMemo(() => Object.entries(recordDraft), [recordDraft]);

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
     */
    const commitFieldKeyRename = (previousKey: string): void => {
        const draftValue = keyDrafts[previousKey];
        if (draftValue === undefined) {
            return;
        }

        const nextKey = draftValue.trim();
        if (nextKey.length === 0) {
            console.warn("[frontmatter-editor] rename skipped: empty field key", {
                previousKey,
            });
            clearKeyDraft(previousKey);
            return;
        }

        if (nextKey === previousKey) {
            clearKeyDraft(previousKey);
            return;
        }

        if (Object.prototype.hasOwnProperty.call(recordDraft, nextKey)) {
            console.warn("[frontmatter-editor] rename skipped: duplicated field key", {
                previousKey,
                nextKey,
            });
            clearKeyDraft(previousKey);
            return;
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
    const requestFieldTypeSelection = async (): Promise<FrontmatterFieldType | null> => {
        const selectedType = await showNativeContextMenu([
            { id: "string", text: t("frontmatter.typeString") },
            { id: "number", text: t("frontmatter.typeNumber") },
            { id: "boolean", text: t("frontmatter.typeBoolean") },
            { id: "list", text: t("frontmatter.typeList") },
            { id: "null", text: t("frontmatter.typeNull") },
        ]);

        if (
            selectedType === "string" ||
            selectedType === "number" ||
            selectedType === "boolean" ||
            selectedType === "list" ||
            selectedType === "null"
        ) {
            return selectedType;
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
        const selectedType = await requestFieldTypeSelection();
        if (!selectedType) {
            return;
        }

        changeFieldType(fieldKey, selectedType);
    };

    /**
     * @function handleFieldKeyKeyDown
     * @description 处理字段名输入框快捷键。
     * @param event 键盘事件。
     * @param fieldKey 当前字段名。
     */
    const handleFieldKeyKeyDown = (
        event: KeyboardEvent<HTMLInputElement>,
        fieldKey: string,
    ): void => {
        if (event.key === "Enter") {
            event.preventDefault();
            commitFieldKeyRename(fieldKey);
            return;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            clearKeyDraft(fieldKey);
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
                <label className="fmv-bool" htmlFor={`fmv-bool-${key}`}>
                    <input
                        id={`fmv-bool-${key}`}
                        type="checkbox"
                        checked={value}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            commitWithNextRecord({
                                ...recordDraft,
                                [key]: event.target.checked,
                            });
                        }}
                    />
                    {value ? "true" : "false"}
                </label>
            );
        }

        if (typeof value === "number") {
            return (
                <input
                    className="fmv-input fmv-input-number"
                    type="number"
                    value={String(value)}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const nextNumber = Number(event.target.value);
                        setRecordDraft((previous) => ({
                            ...previous,
                            [key]: Number.isFinite(nextNumber) ? nextNumber : 0,
                        }));
                    }}
                    onBlur={() => {
                        commitRecordDraft();
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            commitRecordDraft();
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
                                <input
                                    className="fmv-list-item-input"
                                    type="text"
                                    value={editingListDraft}
                                    style={{ width: `${String(Math.max(4, editingListDraft.length + 1))}ch` }}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                        setEditingListDraft(event.target.value);
                                    }}
                                    onBlur={() => {
                                        commitListItemEdit();
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            commitListItemEdit();
                                            return;
                                        }

                                        if (event.key === "Escape") {
                                            event.preventDefault();

                                            if (editingListDraft.trim().length === 0) {
                                                commitListItemEdit();
                                                return;
                                            }

                                            setEditingListItem(null);
                                            setEditingListDraft("");
                                        }
                                    }}
                                    autoFocus
                                />
                            ) : (
                                <button
                                    type="button"
                                    className="fmv-list-item-read"
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
                    >
                        +
                    </button>
                </div>
            );
        }

        return (
            <input
                className="fmv-input"
                type="text"
                value={value === null ? "null" : String(value)}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setRecordDraft((previous) => ({
                        ...previous,
                        [key]: event.target.value,
                    }));
                }}
                onBlur={() => {
                    commitRecordDraft();
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commitRecordDraft();
                    }
                }}
            />
        );
    };

    return (
        <section className="fmv-editor">
            <div className="fmv-grid">
                {fieldEntries.length === 0 ? (
                    <div className="fmv-empty">{t("frontmatter.emptyFrontmatter")}</div>
                ) : (
                    fieldEntries.map(([key, value]) => (
                        <div
                            key={key}
                            className="fmv-row"
                            onContextMenu={(event) => {
                                void handleFieldRowContextMenu(event, key);
                            }}
                        >
                            <input
                                className="fmv-key-input"
                                type="text"
                                value={keyDrafts[key] ?? key}
                                placeholder={t("frontmatter.keyPlaceholder")}
                                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                    const nextDraftValue = event.target.value;
                                    setKeyDrafts((previous) => ({
                                        ...previous,
                                        [key]: nextDraftValue,
                                    }));
                                }}
                                onBlur={() => {
                                    commitFieldKeyRename(key);
                                }}
                                onKeyDown={(event) => {
                                    handleFieldKeyKeyDown(event, key);
                                }}
                            />
                            <div className="fmv-control">{renderValueControl(key, value)}</div>
                        </div>
                    ))
                )}
            </div>
            <div className="fmv-footer">
                <button
                    type="button"
                    className="fmv-add-plus-button"
                    onClick={() => {
                        addFieldByType("string");
                    }}
                    title={t("frontmatter.addField")}
                    aria-label={t("frontmatter.addField")}
                >
                    +
                </button>
            </div>
        </section>
    );
}
