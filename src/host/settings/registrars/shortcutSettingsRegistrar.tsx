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
    getCommandBindingPolicy,
    getCommandRouteClass,
    getCommandConditions,
    getCommandDefinitions,
    type CommandId,
} from "../../commands/commandSystem";
import { getConditionLabel } from "../../conditions/conditionEvaluator";
import { analyzeShortcutGovernance } from "../../commands/shortcutGovernance";
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

    const governanceByCommandId = useMemo(
        () => analyzeShortcutGovernance(
            editableShortcutCommands.map((command) => ({
                id: command.id,
                title: command.title,
                routeClass: getCommandRouteClass(command.id),
                bindingPolicy: getCommandBindingPolicy(command.id),
                condition: command.condition,
                conditions: command.conditions,
            })),
            shortcutState.bindings,
        ),
        [editableShortcutCommands, shortcutState.bindings],
    );

    useEffect(() => {
        setShortcutInputs(shortcutState.bindings);
    }, [shortcutState.bindings]);

    /**
     * @function renderCommandConditions
     * @description 渲染命令条件展示文本。
     * @param commandId 命令 id。
     * @returns 条件文本。
     */
    const renderCommandConditions = (commandId: CommandId): string => {
        const conditions = getCommandConditions(commandId);
        if (conditions.length === 0) {
            return "—";
        }

        return conditions
            .map((condition) => {
                const label = getConditionLabel(condition);
                return label ? t(label) : condition;
            })
            .join(" & ");
    };

    /**
     * @function renderGovernanceNotes
     * @description 渲染快捷键治理状态说明。
     * @param commandId 命令 id。
     * @returns 状态节点。
     */
    const renderGovernanceNotes = (commandId: CommandId): ReactNode => {
        const summary = governanceByCommandId[commandId];
        if (!summary) {
            return null;
        }

        const notes: string[] = [];
        if (summary.bindingPolicy === "system-reserved") {
            notes.push(t("settings.shortcutPolicySystemReserved"));
        } else if (summary.bindingPolicy === "prefer-system-reserved") {
            notes.push(t("settings.shortcutPolicyPreferReserved"));
        }

        summary.issues.forEach((issue) => {
            const relatedTitles = issue.relatedCommandIds
                .map((id) => editableShortcutCommands.find((command) => command.id === id))
                .filter((command): command is NonNullable<typeof command> => Boolean(command))
                .map((command) => t(command.title))
                .join(", ");

            if (issue.type === "reserved-binding-not-allowed") {
                notes.push(t("settings.shortcutIssueReservedBlocked"));
            }

            if (issue.type === "hard-conflict") {
                notes.push(t("settings.shortcutIssueHardConflict", { commands: relatedTitles }));
            }

            if (issue.type === "conditional-overlap") {
                notes.push(t("settings.shortcutIssueConditionalShared", { commands: relatedTitles }));
            }
        });

        if (notes.length === 0) {
            return null;
        }

        return (
            <div>
                {notes.map((note) => (
                    <div key={note}>{note}</div>
                ))}
            </div>
        );
    };

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
                                    <div>
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
                                        {renderGovernanceNotes(commandId)}
                                    </div>
                                </td>
                                <td className="settings-shortcut-td settings-shortcut-td-when">
                                    {renderCommandConditions(commandId)}
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