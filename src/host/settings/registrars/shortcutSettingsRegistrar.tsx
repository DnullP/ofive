/**
 * @module host/settings/registrars/shortcutSettingsRegistrar
 * @description 快捷键设置注册：由快捷键系统注册快捷键配置选栏。
 * @dependencies
 *  - react
 *  - ../../store/shortcutStore
 *  - ../../commands/commandSystem
 *  - ../settingsRegistry
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
    normalizeShortcutString,
    recordShortcutFromKeyboardEvent,
    updateShortcutBinding,
    useShortcutState,
} from "../../store/shortcutStore";
import {
    getCommandDefinitions,
    type CommandId,
} from "../../commands/commandSystem";
import { SHORTCUT_CONDITION_LABELS } from "../../commands/focusContext";
import { registerSettingsSection } from "../settingsRegistry";

function ShortcutSettingsSection(): ReactNode {
    const { t } = useTranslation();
    const shortcutState = useShortcutState();
    const [shortcutInputs, setShortcutInputs] = useState<Record<CommandId, string>>(shortcutState.bindings);
    const [recordingCommandId, setRecordingCommandId] = useState<CommandId | null>(null);

    const editableShortcutCommands = useMemo(
        () => getCommandDefinitions().filter((command) => command.shortcut?.editableInSettings === true),
        [shortcutState.bindings],
    );

    useEffect(() => {
        setShortcutInputs(shortcutState.bindings);
    }, [shortcutState.bindings]);

    useEffect(() => {
        if (!recordingCommandId) {
            return;
        }

        const handleRecordKeydown = (event: KeyboardEvent): void => {
            event.preventDefault();
            event.stopPropagation();

            if (event.key === "Escape") {
                setRecordingCommandId(null);
                return;
            }

            const recordedShortcut = recordShortcutFromKeyboardEvent(event);
            if (!recordedShortcut) {
                return;
            }

            setShortcutInputs((current) => ({
                ...current,
                [recordingCommandId]: recordedShortcut,
            }));
        };

        window.addEventListener("keydown", handleRecordKeydown, { capture: true });
        return () => {
            window.removeEventListener("keydown", handleRecordKeydown, { capture: true });
        };
    }, [recordingCommandId]);

    return (
        <div className="settings-shortcut-table-wrapper">
            <table className="settings-shortcut-table">
                <thead>
                    <tr>
                        <th className="settings-shortcut-th">{t("settings.shortcutCommand")}</th>
                        <th className="settings-shortcut-th">{t("settings.shortcutKeybinding")}</th>
                        <th className="settings-shortcut-th">{t("settings.shortcutCondition")}</th>
                        <th className="settings-shortcut-th settings-shortcut-th-actions">{t("settings.shortcutActions")}</th>
                    </tr>
                </thead>
                <tbody>
                    {editableShortcutCommands.map((command) => {
                        const commandId = command.id;
                        const inputValue = shortcutInputs[commandId] ?? "";
                        const isRecordingCurrent = recordingCommandId === commandId;

                        return (
                            <tr
                                key={commandId}
                                className={`settings-shortcut-row ${isRecordingCurrent ? "recording" : ""}`}
                            >
                                <td className="settings-shortcut-td settings-shortcut-td-command">
                                    {t(command.title)}
                                </td>
                                <td className="settings-shortcut-td settings-shortcut-td-keybinding">
                                    {isRecordingCurrent ? (
                                        <input
                                            className="settings-shortcut-inline-input"
                                            value={inputValue}
                                            readOnly
                                            placeholder={t("settings.shortcutRecordPlaceholder")}
                                            autoFocus
                                        />
                                    ) : (
                                        <kbd className="settings-shortcut-kbd">
                                            {inputValue || command.shortcut?.defaultBinding || "—"}
                                        </kbd>
                                    )}
                                </td>
                                <td className="settings-shortcut-td settings-shortcut-td-when">
                                    {command.condition ? t(SHORTCUT_CONDITION_LABELS[command.condition]) : "—"}
                                </td>
                                <td className="settings-shortcut-td settings-shortcut-td-actions">
                                    {isRecordingCurrent ? (
                                        <>
                                            <button
                                                type="button"
                                                className="settings-shortcut-action-btn settings-shortcut-action-save"
                                                disabled={normalizeShortcutString(inputValue) === null}
                                                onClick={() => {
                                                    void updateShortcutBinding(commandId, inputValue);
                                                    setRecordingCommandId(null);
                                                }}
                                            >
                                                {t("common.save")}
                                            </button>
                                            <button
                                                type="button"
                                                className="settings-shortcut-action-btn"
                                                onClick={() => {
                                                    setShortcutInputs((cur) => ({
                                                        ...cur,
                                                        [commandId]: shortcutState.bindings[commandId] ?? "",
                                                    }));
                                                    setRecordingCommandId(null);
                                                }}
                                            >
                                                {t("common.cancel")}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            className="settings-shortcut-action-btn"
                                            onClick={() => {
                                                setRecordingCommandId(commandId);
                                            }}
                                        >
                                            {t("common.record")}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {shortcutState.error ? <div className="settings-tab-error">{shortcutState.error}</div> : null}
        </div>
    );
}

export function registerShortcutSettingsSection(): void {
    registerSettingsSection({
        id: "shortcut-system",
        title: "settings.shortcutSection",
        order: 30,
        render: () => <ShortcutSettingsSection />,
    });
}