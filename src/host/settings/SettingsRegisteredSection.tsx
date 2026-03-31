/**
 * @module host/settings/SettingsRegisteredSection
 * @description 注册化设置项通用渲染器：负责把标准化 settings item 定义渲染为前端设置 UI。
 *   该模块让插件可以只注册分类和设置项元数据，由 host 层统一负责前端展示。
 *
 * @dependencies
 *  - react
 *  - react-i18next
 *  - ./settingsRegistry
 *
 * @usage
 * ```tsx
 * <SettingsRegisteredSection section={section} />
 * ```
 *
 * @exports
 *  - SettingsRegisteredSection
 */

import type { ChangeEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
    NumberSettingsItemRegistration,
    SelectSettingsItemRegistration,
    SettingsItemRegistration,
    SettingsSectionSnapshot,
    ToggleSettingsItemRegistration,
} from "./settingsRegistry";

/**
 * @function resolveDisabledState
 * @description 解析设置项的 disabled 状态。
 * @param disabled 静态布尔值或计算函数。
 * @returns 是否禁用。
 */
function resolveDisabledState(disabled?: boolean | (() => boolean)): boolean {
    if (typeof disabled === "function") {
        return disabled();
    }

    return disabled ?? false;
}

/**
 * @function RegisteredToggleItem
 * @description 渲染布尔开关设置项。
 * @param props 设置项定义。
 * @returns React 节点。
 */
function RegisteredToggleItem(props: { item: ToggleSettingsItemRegistration }): ReactNode {
    const { t } = useTranslation();
    const checked = props.item.useValue();
    const disabled = resolveDisabledState(props.item.disabled);
    const inputId = `${props.item.sectionId}-${props.item.id}`;

    return (
        <label className="settings-compact-row" htmlFor={inputId}>
            <div className="settings-compact-info">
                <span className="settings-compact-title">{t(props.item.title)}</span>
                {props.item.description ? (
                    <span className="settings-compact-desc">{t(props.item.description)}</span>
                ) : null}
            </div>
            <input
                id={inputId}
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => {
                    void props.item.updateValue(event.target.checked);
                }}
            />
        </label>
    );
}

/**
 * @function RegisteredNumberItem
 * @description 渲染数值输入设置项。
 * @param props 设置项定义。
 * @returns React 节点。
 */
function RegisteredNumberItem(props: { item: NumberSettingsItemRegistration }): ReactNode {
    const { t } = useTranslation();
    const value = props.item.useValue();
    const disabled = resolveDisabledState(props.item.disabled);
    const inputId = `${props.item.sectionId}-${props.item.id}`;

    const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const nextValue = props.item.normalizeValue
            ? props.item.normalizeValue(event.target.value, value)
            : Number(event.target.value);

        if (!Number.isFinite(nextValue)) {
            return;
        }

        void props.item.updateValue(nextValue);
    };

    return (
        <div className="settings-compact-row" key={props.item.id}>
            <div className="settings-compact-info">
                <span className="settings-compact-title">{t(props.item.title)}</span>
                {props.item.description ? (
                    <span className="settings-compact-desc">{t(props.item.description)}</span>
                ) : null}
            </div>
            <div className="settings-glass-value-group">
                <input
                    id={inputId}
                    className="settings-compact-number-input"
                    type="number"
                    min={props.item.min}
                    max={props.item.max}
                    step={props.item.step}
                    value={value}
                    disabled={disabled}
                    onChange={handleChange}
                />
                {props.item.suffix ? (
                    <span className="settings-glass-value-suffix">{t(props.item.suffix)}</span>
                ) : null}
            </div>
        </div>
    );
}

/**
 * @function RegisteredSelectItem
 * @description 渲染单选设置项。
 * @param props 设置项定义。
 * @returns React 节点。
 */
function RegisteredSelectItem(props: { item: SelectSettingsItemRegistration }): ReactNode {
    const { t } = useTranslation();
    const value = String(props.item.useValue());
    const disabled = resolveDisabledState(props.item.disabled);
    const presentation = props.item.presentation ?? "select";
    const inputId = `${props.item.sectionId}-${props.item.id}`;

    if (presentation === "buttons") {
        return (
            <div className="settings-compact-row-column">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t(props.item.title)}</span>
                    {props.item.description ? (
                        <span className="settings-compact-desc">{t(props.item.description)}</span>
                    ) : null}
                </div>

                <div className="settings-theme-mode-row">
                    {props.item.options.map((option) => {
                        const isActive = String(option.value) === value;

                        return (
                            <button
                                key={String(option.value)}
                                type="button"
                                className={`settings-theme-mode-button ${isActive ? "active" : ""}`}
                                disabled={disabled}
                                onClick={() => {
                                    void props.item.updateValue(option.value);
                                }}
                            >
                                <span className="settings-theme-mode-button-title">{t(option.label)}</span>
                                {option.description ? (
                                    <span className="settings-theme-mode-button-desc">{t(option.description)}</span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className="settings-compact-row">
            <div className="settings-compact-info">
                <span className="settings-compact-title">{t(props.item.title)}</span>
                {props.item.description ? (
                    <span className="settings-compact-desc">{t(props.item.description)}</span>
                ) : null}
            </div>
            <select
                id={inputId}
                className="settings-compact-select"
                value={value}
                disabled={disabled}
                onChange={(event) => {
                    const nextOption = props.item.options.find(
                        (option) => String(option.value) === event.target.value,
                    );
                    if (!nextOption) {
                        return;
                    }

                    void props.item.updateValue(nextOption.value);
                }}
            >
                {props.item.options.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                        {t(option.label)}
                    </option>
                ))}
            </select>
        </div>
    );
}

/**
 * @function RegisteredSettingsItem
 * @description 根据设置项类型分派到具体渲染器。
 * @param props 设置项定义。
 * @returns React 节点。
 */
function RegisteredSettingsItem(props: { item: SettingsItemRegistration }): ReactNode {
    const isVisible = props.item.useIsVisible ? props.item.useIsVisible() : true;

    if (!isVisible) {
        return null;
    }

    switch (props.item.kind) {
        case "toggle":
            return <RegisteredToggleItem item={props.item} />;
        case "number":
            return <RegisteredNumberItem item={props.item} />;
        case "select":
            return <RegisteredSelectItem item={props.item} />;
        case "custom":
            return props.item.render();
        default:
            return null;
    }
}

/**
 * @function SettingsRegisteredSection
 * @description 渲染单个 settings section 的标准注册项与自定义尾部内容。
 * @param props section 快照。
 * @returns React 节点。
 */
export function SettingsRegisteredSection(props: {
    section: SettingsSectionSnapshot;
}): ReactNode {
    const hasRegisteredItems = props.section.items.length > 0;

    if (!hasRegisteredItems && !props.section.render) {
        return null;
    }

    return (
        <>
            {hasRegisteredItems ? (
                <div className="settings-item-group">
                    {props.section.items.map((item) => (
                        <RegisteredSettingsItem key={`${item.sectionId}:${item.id}`} item={item} />
                    ))}
                </div>
            ) : null}
            {props.section.render ? props.section.render() : null}
        </>
    );
}