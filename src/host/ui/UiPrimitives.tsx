import {
    forwardRef,
    type ButtonHTMLAttributes,
    type FormEventHandler,
    type HTMLAttributes,
    type InputHTMLAttributes,
    type KeyboardEventHandler,
    type LabelHTMLAttributes,
    type ReactNode,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from "react";
import { X } from "lucide-react";
import { modalPlainTextAreaProps, modalPlainTextInputProps } from "./textInputBehaviors";
import "./UiPrimitives.css";

type UiControlSize = "compact" | "default" | "large";
type UiControlVariant = "default" | "settings" | "plain" | "unstyled";

function cx(...classes: Array<string | false | null | undefined>): string {
    return classes.filter(Boolean).join(" ");
}

export interface UiTextInputProps extends InputHTMLAttributes<HTMLInputElement> {
    controlSize?: UiControlSize;
    invalid?: boolean;
    monospace?: boolean;
    variant?: UiControlVariant;
}

export const UiTextInput = forwardRef<HTMLInputElement, UiTextInputProps>(function UiTextInput(
    {
        className,
        controlSize = "default",
        invalid = false,
        monospace = false,
        variant = "default",
        ...props
    },
    ref,
) {
    return (
        <input
            ref={ref}
            {...modalPlainTextInputProps}
            {...props}
            className={cx(
                "ofive-ui-control",
                "ofive-ui-text-input",
                `ofive-ui-control--${controlSize}`,
                `ofive-ui-control--${variant}`,
                invalid && "ofive-ui-control--invalid",
                monospace && "ofive-ui-control--monospace",
                className,
            )}
        />
    );
});

export interface UiTextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    controlSize?: UiControlSize;
    invalid?: boolean;
    monospace?: boolean;
    variant?: UiControlVariant;
}

export const UiTextArea = forwardRef<HTMLTextAreaElement, UiTextAreaProps>(function UiTextArea(
    {
        className,
        controlSize = "default",
        invalid = false,
        monospace = false,
        variant = "default",
        ...props
    },
    ref,
) {
    return (
        <textarea
            ref={ref}
            {...modalPlainTextAreaProps}
            {...props}
            className={cx(
                "ofive-ui-control",
                "ofive-ui-textarea",
                `ofive-ui-control--${controlSize}`,
                `ofive-ui-control--${variant}`,
                invalid && "ofive-ui-control--invalid",
                monospace && "ofive-ui-control--monospace",
                className,
            )}
        />
    );
});

export interface UiSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    controlSize?: UiControlSize;
    invalid?: boolean;
    variant?: UiControlVariant;
}

export const UiSelect = forwardRef<HTMLSelectElement, UiSelectProps>(function UiSelect(
    {
        className,
        controlSize = "compact",
        invalid = false,
        variant = "settings",
        ...props
    },
    ref,
) {
    return (
        <select
            ref={ref}
            {...props}
            className={cx(
                "ofive-ui-control",
                "ofive-ui-select",
                `ofive-ui-control--${controlSize}`,
                `ofive-ui-control--${variant}`,
                invalid && "ofive-ui-control--invalid",
                className,
            )}
        />
    );
});

export interface UiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    controlSize?: UiControlSize;
    iconOnly?: boolean;
    variant?: "secondary" | "primary" | "ghost" | "danger";
}

export const UiButton = forwardRef<HTMLButtonElement, UiButtonProps>(function UiButton(
    {
        className,
        controlSize = "default",
        iconOnly = false,
        type = "button",
        variant = "secondary",
        ...props
    },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            {...props}
            className={cx(
                "ofive-ui-button",
                `ofive-ui-button--${controlSize}`,
                `ofive-ui-button--${variant}`,
                iconOnly && "ofive-ui-button--icon-only",
                className,
            )}
        />
    );
});

export interface UiFieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
    description?: ReactNode;
    label: ReactNode;
}

export function UiField({ children, className, description, label, ...props }: UiFieldProps): ReactNode {
    return (
        <label {...props} className={cx("ofive-ui-field", className)}>
            <span>{label}</span>
            {description ? <span className="ofive-ui-field__description">{description}</span> : null}
            {children}
        </label>
    );
}

export interface UiModalProps {
    ariaLabel?: string;
    children: ReactNode;
    className?: string;
    closeLabel?: string;
    contentClassName?: string;
    description?: ReactNode;
    footer?: ReactNode;
    isOpen?: boolean;
    onClose: () => void;
    onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
    onSubmit?: FormEventHandler<HTMLFormElement>;
    panelClassName?: string;
    placement?: "center" | "top";
    showCloseButton?: boolean;
    size?: "sm" | "md" | "lg" | "xl";
    title?: ReactNode;
}

export function UiModal(props: UiModalProps): ReactNode {
    const {
        ariaLabel,
        children,
        className,
        closeLabel = "Close",
        contentClassName,
        description,
        footer,
        isOpen = true,
        onClose,
        onKeyDown,
        onSubmit,
        panelClassName,
        placement = "center",
        showCloseButton = true,
        size = "md",
        title,
    } = props;

    if (!isOpen) {
        return null;
    }

    const label = ariaLabel ?? (typeof title === "string" ? title : undefined);
    const header = title || description || showCloseButton
        ? (
            <header className="ofive-ui-modal__header">
                <div>
                    {title ? <h2 className="ofive-ui-modal__title">{title}</h2> : null}
                    {description ? <div className="ofive-ui-modal__description">{description}</div> : null}
                </div>
                {showCloseButton ? (
                    <UiButton
                        aria-label={closeLabel}
                        controlSize="compact"
                        iconOnly
                        variant="ghost"
                        onClick={onClose}
                    >
                        <X size={15} strokeWidth={2} />
                    </UiButton>
                ) : null}
            </header>
        )
        : null;

    const body = (
        <>
            {header}
            <div className={cx("ofive-ui-modal__content", contentClassName)}>
                {children}
            </div>
            {footer ? <footer className="ofive-ui-modal__footer">{footer}</footer> : null}
        </>
    );

    const commonPanelProps = {
        "aria-label": label,
        "aria-modal": true,
        className: cx("ofive-ui-modal", `ofive-ui-modal--${size}`, panelClassName),
        "data-floating-surface": "true",
        role: "dialog",
    } as const;

    return (
        <div
            className={cx("ofive-ui-modal-backdrop", `ofive-ui-modal-backdrop--${placement}`, className)}
            data-floating-backdrop="true"
            role="presentation"
            onKeyDown={onKeyDown}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            {onSubmit ? (
                <form {...commonPanelProps} onSubmit={onSubmit}>
                    {body}
                </form>
            ) : (
                <section {...commonPanelProps}>
                    {body}
                </section>
            )}
        </div>
    );
}

export interface UiDropdownMenuProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
}

export function UiDropdownMenu({ children, className, role = "menu", ...props }: UiDropdownMenuProps): ReactNode {
    return (
        <div
            {...props}
            className={cx("ofive-ui-dropdown-menu", className)}
            data-floating-surface="true"
            role={role}
        >
            {children}
        </div>
    );
}

export interface UiDropdownMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    selected?: boolean;
}

export function UiDropdownMenuItem({
    className,
    selected = false,
    type = "button",
    ...props
}: UiDropdownMenuItemProps): ReactNode {
    return (
        <button
            type={type}
            {...props}
            className={cx("ofive-ui-dropdown-item", selected && "ofive-ui-dropdown-item--selected", className)}
        />
    );
}
