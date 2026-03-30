/**
 * @module host/layout/CreateEntryModal
 * @description 创建文件/文件夹输入浮窗：替代浏览器原生 prompt，提供宿主可控的创建输入流程。
 * @dependencies
 *   - react
 *   - react-i18next
 *   - ./CreateEntryModal.css
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { shouldSubmitPlainEnter } from "../../utils/imeInputGuard";
import { modalPlainTextInputProps } from "./textInputBehaviors";
import "./CreateEntryModal.css";

/**
 * @interface CreateEntryModalProps
 * @description 创建输入浮窗参数。
 */
export interface CreateEntryModalProps {
    /** 浮窗是否打开 */
    isOpen: boolean;
    /** 创建类型 */
    kind: "file" | "folder";
    /** 目标目录 */
    baseDirectory: string;
    /** 标题文本 */
    title: string;
    /** 输入框占位文本 */
    placeholder: string;
    /** 初始输入值 */
    initialValue: string;
    /** 确认按钮文案覆盖 */
    confirmLabel?: string;
    /** 输入校验提示 */
    validationMessage?: string;
    /** 关闭浮窗 */
    onClose: () => void;
    /** 确认输入 */
    onConfirm: (draftName: string) => void;
}

/**
 * @function CreateEntryModal
 * @description 渲染创建文件/文件夹输入浮窗。
 * @param props 组件参数。
 * @returns React 节点。
 */
export function CreateEntryModal(props: CreateEntryModalProps): ReactNode {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [draftName, setDraftName] = useState<string>(props.initialValue);

    useEffect(() => {
        if (!props.isOpen) {
            return;
        }

        setDraftName(props.initialValue);
        const timer = window.setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 0);

        return () => {
            window.clearTimeout(timer);
        };
    }, [props.isOpen, props.initialValue]);

    const submit = (): void => {
        props.onConfirm(draftName);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
            return;
        }

        if (shouldSubmitPlainEnter({
            key: event.key,
            nativeEvent: event.nativeEvent,
        })) {
            event.preventDefault();
            submit();
        }
    };

    if (!props.isOpen) {
        return null;
    }

    return (
        <div
            className="create-entry-overlay"
            data-floating-backdrop="true"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    props.onClose();
                }
            }}
            onKeyDown={handleKeyDown}
        >
            {/* create-entry-panel: 创建输入浮窗主体 */}
            <section
                className="create-entry-panel"
                data-floating-surface="true"
                aria-label={props.title}
            >
                {/* create-entry-title: 创建类型标题 */}
                <div className="create-entry-title">{props.title}</div>
                {/* create-entry-directory: 目标目录提示 */}
                <div className="create-entry-directory">
                    {t("moveFileModal.vaultRoot")}:
                    {props.baseDirectory ? ` ${props.baseDirectory}` : ` ${t("common.rootDirectory")}`}
                </div>
                {/* create-entry-input: 名称输入框 */}
                <input
                    ref={inputRef}
                    {...modalPlainTextInputProps}
                    className="create-entry-input"
                    type="text"
                    value={draftName}
                    placeholder={props.placeholder}
                    onChange={(event) => {
                        setDraftName(event.target.value);
                    }}
                />
                {props.validationMessage ? (
                    <div className="create-entry-validation" role="alert">
                        {props.validationMessage}
                    </div>
                ) : null}
                {/* create-entry-actions: 浮窗底部操作区 */}
                <div className="create-entry-actions">
                    <button type="button" className="create-entry-button" onClick={props.onClose}>
                        {t("common.cancel")}
                    </button>
                    <button type="button" className="create-entry-button primary" onClick={submit}>
                        {props.confirmLabel ?? (props.kind === "file" ? t("common.newFile") : t("common.newFolder"))}
                    </button>
                </div>
            </section>
        </div>
    );
}