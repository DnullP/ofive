/**
 * @module plugins/custom-activity/CustomActivityModal
 * @description 自定义 activity 创建 modal。
 *   用户可以选择当前支持的全部图标、填写名称，并指定 activity 类型：
 *   - panel-container：创建一个默认面板容器
 *   - callback：绑定命令系统中的现有命令
 *
 * @dependencies
 *   - react
 *   - react-i18next
 *   - ../../host/registry
 *   - ./customActivityConfig
 *   - ./customActivityEvents
 *   - ./iconCatalog
 *   - ./CustomActivityModal.css
 *
 * @exports
 *   - CustomActivityModal
 */

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { UiButton, UiField, UiModal, UiSelect, UiTextInput } from "../../host/ui";
import type { OverlayRenderContext } from "../../host/registry";
import { getConfigSnapshot } from "../../host/config/configStore";
import {
    appendCustomActivityToVaultConfig,
    createCustomActivityDefinition,
    getCustomActivitiesFromVaultConfig,
    type CreateCustomActivityInput,
} from "./customActivityConfig";
import { closeCustomActivityModal, useCustomActivityModalState } from "./customActivityEvents";
import { CUSTOM_ACTIVITY_ICON_OPTIONS, renderCustomActivityIcon, type CustomActivityIconKey } from "./iconCatalog";
import "./CustomActivityModal.css";

/**
 * @function CustomActivityModal
 * @description 渲染自定义 activity 创建弹窗。
 * @param props overlay 上下文。
 * @returns React 节点。
 */
export function CustomActivityModal(props: OverlayRenderContext): ReactNode {
    const { t } = useTranslation();
    const { isOpen } = useCustomActivityModalState();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const wasOpenRef = useRef(false);

    const commandDefinitions = useMemo(
        () => props.getCommandDefinitions().filter((definition) => definition.id !== "customActivity.create"),
        [props.getCommandDefinitions],
    );

    const [name, setName] = useState("");
    const [iconKey, setIconKey] = useState<CustomActivityIconKey>(CUSTOM_ACTIVITY_ICON_OPTIONS[0].key);
    const [kind, setKind] = useState<"panel-container" | "callback">("panel-container");
    const [commandId, setCommandId] = useState<string>("");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const wasOpen = wasOpenRef.current;
        wasOpenRef.current = isOpen;

        if (!isOpen || wasOpen) {
            return;
        }

        setName("");
        setKind("panel-container");
        setCommandId(commandDefinitions[0]?.id ?? "");
        setIconKey(CUSTOM_ACTIVITY_ICON_OPTIONS[0].key);
        setError(null);
        setIsSaving(false);

        const timer = window.setTimeout(() => {
            inputRef.current?.focus();
        }, 0);

        return () => {
            window.clearTimeout(timer);
        };
    }, [commandDefinitions, isOpen]);

    useEffect(() => {
        if (!isOpen || kind !== "callback") {
            return;
        }

        if (commandDefinitions.some((definition) => definition.id === commandId)) {
            return;
        }

        setCommandId(commandDefinitions[0]?.id ?? "");
    }, [commandDefinitions, commandId, isOpen, kind]);

    const handleClose = (): void => {
        if (isSaving) {
            return;
        }
        closeCustomActivityModal();
    };

    const handleSubmit = async (): Promise<void> => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError(t("customActivity.nameRequired"));
            return;
        }

        if (kind === "callback" && !commandId) {
            setError(t("customActivity.commandRequired"));
            return;
        }

        setError(null);
        setIsSaving(true);

        try {
            const currentConfig = getConfigSnapshot().backendConfig;
            const existingItems = getCustomActivitiesFromVaultConfig(currentConfig);
            const nextInput: CreateCustomActivityInput = {
                name: trimmedName,
                iconKey,
                kind,
                commandId: kind === "callback" ? commandId : undefined,
            };
            const nextDefinition = createCustomActivityDefinition(nextInput, 1000 + existingItems.length);
            await appendCustomActivityToVaultConfig(nextDefinition);
            console.info("[custom-activity] created custom activity", {
                id: nextDefinition.id,
                kind: nextDefinition.kind,
                commandId: nextDefinition.commandId,
            });
            closeCustomActivityModal();
        } catch (submitError) {
            const message = submitError instanceof Error ? submitError.message : t("customActivity.saveFailed");
            console.error("[custom-activity] failed to create custom activity", {
                message,
                kind,
                commandId,
            });
            setError(message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Escape") {
            event.preventDefault();
            handleClose();
            return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void handleSubmit();
        }
    };

    if (!isOpen) {
        return null;
    }

    return (
        <UiModal
            ariaLabel={t("customActivity.modalTitle")}
            closeLabel={t("common.close")}
            contentClassName="custom-activity-modal__content"
            description={t("customActivity.modalSubtitle")}
            isOpen={isOpen}
            panelClassName="custom-activity-modal"
            size="lg"
            title={t("customActivity.modalTitle")}
            onClose={handleClose}
            onKeyDown={handleKeyDown}
        >
                    <section className="custom-activity-modal__section">
                        <h3 className="custom-activity-modal__section-title">{t("customActivity.basicSection")}</h3>
                        <UiField label={t("customActivity.nameLabel")}>
                            <UiTextInput
                                ref={inputRef}
                                className="custom-activity-modal__input"
                                controlSize="large"
                                type="text"
                                value={name}
                                placeholder={t("customActivity.namePlaceholder")}
                                onChange={(event) => {
                                    setName(event.target.value);
                                }}
                            />
                        </UiField>
                    </section>

                    <section className="custom-activity-modal__section">
                        <h3 className="custom-activity-modal__section-title">{t("customActivity.typeSection")}</h3>
                        <div className="custom-activity-modal__type-grid">
                            <button
                                type="button"
                                className={`custom-activity-modal__type-option${kind === "panel-container" ? " is-selected" : ""}`}
                                onClick={() => {
                                    setKind("panel-container");
                                }}
                            >
                                <span className="custom-activity-modal__type-title">{t("customActivity.panelType")}</span>
                                <span className="custom-activity-modal__type-desc">{t("customActivity.panelTypeDesc")}</span>
                            </button>
                            <button
                                type="button"
                                className={`custom-activity-modal__type-option${kind === "callback" ? " is-selected" : ""}`}
                                onClick={() => {
                                    setKind("callback");
                                    if (!commandId) {
                                        setCommandId(commandDefinitions[0]?.id ?? "");
                                    }
                                }}
                            >
                                <span className="custom-activity-modal__type-title">{t("customActivity.callbackType")}</span>
                                <span className="custom-activity-modal__type-desc">{t("customActivity.callbackTypeDesc")}</span>
                            </button>
                        </div>
                        {kind === "callback" && (
                            <UiField label={t("customActivity.commandLabel")}>
                                <UiSelect
                                    className="custom-activity-modal__select"
                                    controlSize="large"
                                    variant="default"
                                    value={commandId}
                                    onChange={(event) => {
                                        setCommandId(event.target.value);
                                    }}
                                >
                                    {commandDefinitions.map((definition) => (
                                        <option key={definition.id} value={definition.id}>
                                            {definition.id}
                                        </option>
                                    ))}
                                </UiSelect>
                            </UiField>
                        )}
                    </section>

                    <section className="custom-activity-modal__section">
                        <h3 className="custom-activity-modal__section-title">{t("customActivity.iconSection")}</h3>
                        <div className="custom-activity-modal__icon-grid">
                            {CUSTOM_ACTIVITY_ICON_OPTIONS.map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    className={`custom-activity-modal__icon-option${iconKey === option.key ? " is-selected" : ""}`}
                                    onClick={() => {
                                        setIconKey(option.key);
                                    }}
                                >
                                    {renderCustomActivityIcon(option.key)}
                                    <span className="custom-activity-modal__icon-label">{option.label}</span>
                                </button>
                            ))}
                        </div>
                    </section>

                    {error && <div className="custom-activity-modal__error">{error}</div>}

                    <div className="custom-activity-modal__actions">
                        <UiButton className="custom-activity-modal__button" onClick={handleClose}>
                            {t("common.cancel")}
                        </UiButton>
                        <UiButton
                            className="custom-activity-modal__button primary"
                            variant="primary"
                            onClick={() => {
                                void handleSubmit();
                            }}
                            disabled={isSaving}
                        >
                            {isSaving ? t("customActivity.saving") : t("customActivity.create")}
                        </UiButton>
                    </div>
        </UiModal>
    );
}
