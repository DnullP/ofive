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
import { UiButton, UiModal, UiTextInput } from "../ui";
import { shouldSubmitPlainEnter } from "../../utils/imeInputGuard";
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
        <UiModal
            ariaLabel={props.title}
            description={`${t("moveFileModal.vaultRoot")}: ${props.baseDirectory || t("common.rootDirectory")}`}
            footer={(
                <>
                    <UiButton className="create-entry-button" onClick={props.onClose}>
                        {t("common.cancel")}
                    </UiButton>
                    <UiButton className="create-entry-button primary" variant="primary" onClick={submit}>
                        {props.confirmLabel ?? (props.kind === "file" ? t("common.newFile") : t("common.newFolder"))}
                    </UiButton>
                </>
            )}
            isOpen={props.isOpen}
            panelClassName="create-entry-panel"
            placement="top"
            size="md"
            title={props.title}
            onClose={props.onClose}
            onKeyDown={handleKeyDown}
        >
            <UiTextInput
                ref={inputRef}
                className="create-entry-input"
                controlSize="large"
                type="text"
                value={draftName}
                placeholder={props.placeholder}
                invalid={Boolean(props.validationMessage)}
                onChange={(event) => {
                    setDraftName(event.target.value);
                }}
            />
            {props.validationMessage ? (
                <div className="create-entry-validation" role="alert">
                    {props.validationMessage}
                </div>
            ) : null}
        </UiModal>
    );
}
