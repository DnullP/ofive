/**
 * @module settings/registrars/shortcutSettingsRegistrar
 * @description 快捷键设置注册：由快捷键系统注册快捷键配置选栏。
 * @dependencies
 *  - react
 *  - ../../store/shortcutStore
 *  - ../../commands/commandSystem
 *  - ../settingsRegistry
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    normalizeShortcutString,
    recordShortcutFromKeyboardEvent,
    updateShortcutBinding,
    useShortcutState,
} from "../../store/shortcutStore";
import {
    getEditableShortcutCommandDefinitions,
    type CommandId,
} from "../../commands/commandSystem";
import { SHORTCUT_CONDITION_LABELS } from "../../commands/focusContext";
import { registerSettingsSection } from "../settingsRegistry";

/**
 * @function ShortcutSettingsSection
 * @description 快捷键设置选栏内容。
 * @returns React 节点。
 */
function ShortcutSettingsSection(): ReactNode {
    const shortcutState = useShortcutState();
    const [shortcutInputs, setShortcutInputs] = useState<Record<CommandId, string>>(shortcutState.bindings);
    const [recordingCommandId, setRecordingCommandId] = useState<CommandId | null>(null);

    const editableShortcutCommands = useMemo(
        () => getEditableShortcutCommandDefinitions(),
        [],
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
            setRecordingCommandId(null);
        };

        window.addEventListener("keydown", handleRecordKeydown, { capture: true });
        return () => {
            window.removeEventListener("keydown", handleRecordKeydown, { capture: true });
        };
    }, [recordingCommandId]);

    return (
        <div className="settings-shortcut-table-wrapper">
            {/* 快捷键设置表格：仿 VS Code 表格风格 */}
            <table className="settings-shortcut-table">
                <thead>
                    <tr>
                        {/* 表头：命令名 | 快捷键 | 条件 | 操作 */}
                        <th className="settings-shortcut-th">命令</th>
                        <th className="settings-shortcut-th">快捷键</th>
                        <th className="settings-shortcut-th">条件</th>
                        <th className="settings-shortcut-th settings-shortcut-th-actions">操作</th>
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
                                {/* 命令名称列 */}
                                <td className="settings-shortcut-td settings-shortcut-td-command">
                                    {command.title}
                                </td>
                                {/* 快捷键绑定列：显示键位徽章或录制输入框 */}
                                <td className="settings-shortcut-td settings-shortcut-td-keybinding">
                                    {isRecordingCurrent ? (
                                        <input
                                            className="settings-shortcut-inline-input"
                                            value={inputValue}
                                            readOnly
                                            placeholder="按下组合键…"
                                            autoFocus
                                        />
                                    ) : (
                                        <kbd className="settings-shortcut-kbd">
                                            {inputValue || command.shortcut?.defaultBinding || "—"}
                                        </kbd>
                                    )}
                                </td>
                                {/* 条件列：显示触发条件标签 */}
                                <td className="settings-shortcut-td settings-shortcut-td-when">
                                    {command.condition
                                        ? SHORTCUT_CONDITION_LABELS[command.condition]
                                        : "—"}
                                </td>
                                {/* 操作列：录制/保存/取消按钮 */}
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
                                                保存
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
                                                取消
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
                                            录制
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

/**
 * @function registerShortcutSettingsSection
 * @description 注册快捷键设置选栏。
 */
export function registerShortcutSettingsSection(): void {
    registerSettingsSection({
        id: "shortcut-system",
        title: "快捷键",
        order: 30,
        render: () => <ShortcutSettingsSection />,
    });
}
