/**
 * @module layout/editor/components/FrontmatterYamlVisualEditor
 * @description Frontmatter 可视化 YAML 编辑组件：支持结构化字段编辑与源码模式双向切换。
 * @dependencies
 *  - react
 *  - yaml
 *  - ./FrontmatterYamlVisualEditor.css
 *
 * @example
 *   <FrontmatterYamlVisualEditor
 *     initialYamlText={yamlText}
 *     onSave={(nextYaml) => ({ success: true, message: "saved" })}
 *   />
 */

import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import YAML from "yaml";
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
 * @function inferScalarTypeName
 * @description 推断 scalar 类型名。
 * @param value 值。
 * @returns 类型名。
 */
function inferScalarTypeName(value: VisualYamlScalar): string {
    if (value === null) {
        return "null";
    }
    return typeof value;
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
 * @function buildStatusClassName
 * @description 根据状态构建状态文本类名。
 * @param status 保存状态。
 * @returns 类名。
 */
function buildStatusClassName(status: SaveResult | null): string {
    if (!status) {
        return "fmv-status";
    }

    return status.success ? "fmv-status fmv-status-success" : "fmv-status fmv-status-error";
}

/**
 * @function FrontmatterYamlVisualEditor
 * @description 渲染 frontmatter 的可视化 YAML 编辑器。
 * @param props 组件参数。
 * @returns React 节点。
 */
export function FrontmatterYamlVisualEditor(props: FrontmatterYamlVisualEditorProps): ReactNode {
    const [status, setStatus] = useState<SaveResult | null>(null);
    const [recordDraft, setRecordDraft] = useState<Record<string, VisualYamlValue>>(() =>
        parseYamlToRecord(props.initialYamlText),
    );
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
        setStatus(result);
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
        setStatus(result);
        if (result.success) {
            lastCommittedYamlRef.current = nextYaml;
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
                                    title="点击编辑"
                                >
                                    {item === null ? "null" : String(item)}
                                </button>
                            )}
                            <button
                                type="button"
                                className="fmv-mini-action"
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
            <header className="fmv-header">
                <h3 className="fmv-title">Frontmatter Visual YAML Editor</h3>
                <span className={buildStatusClassName(status)}>{status?.message ?? "文档已同步，保存由统一调度负责"}</span>
            </header>

            <div className="fmv-grid">
                {fieldEntries.length === 0 ? (
                    <div className="fmv-empty">当前 frontmatter 为空。</div>
                ) : (
                    fieldEntries.map(([key, value]) => {
                        const typeLabel = Array.isArray(value)
                            ? `array<${inferScalarTypeName(value[0] ?? "")}>`
                            : inferScalarTypeName(value);

                        return (
                            <div key={key} className="fmv-row">
                                <div className="fmv-key-wrap">
                                    <span className="fmv-key">{key}</span>
                                    <span className="fmv-type">{typeLabel}</span>
                                </div>
                                <div className="fmv-control">{renderValueControl(key, value)}</div>
                            </div>
                        );
                    })
                )}
            </div>
        </section>
    );
}
