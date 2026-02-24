/**
 * @module settings/registrars/editorSettingsRegistrar
 * @description 编辑器设置注册：由编辑器系统注册 Vim 相关设置。
 * @dependencies
 *  - react
 *  - ../../store/configStore
 *  - ../settingsRegistry
 */

import type { ReactNode } from "react";
import { updateVimModeEnabled, useConfigState } from "../../store/configStore";
import { registerSettingsSection } from "../settingsRegistry";

/**
 * @function EditorSettingsSection
 * @description 编辑器设置选栏内容。
 * @returns React 节点。
 */
function EditorSettingsSection(): ReactNode {
    const configState = useConfigState();

    return (
        <div className="settings-item-group">
            <label className="settings-item" htmlFor="vim-mode-switch">
                <div>
                    <div className="settings-item-title">开启 Vim 编辑模式</div>
                    <div className="settings-item-desc">开启后编辑器将使用 Vim 键位（支持普通/插入模式）。</div>
                </div>
                <input
                    id="vim-mode-switch"
                    type="checkbox"
                    checked={configState.featureSettings.vimModeEnabled}
                    onChange={(event) => {
                        void updateVimModeEnabled(event.target.checked);
                    }}
                />
            </label>

            {configState.error ? <div className="settings-tab-error">{configState.error}</div> : null}
        </div>
    );
}

/**
 * @function registerEditorSettingsSection
 * @description 注册编辑器设置选栏。
 */
export function registerEditorSettingsSection(): void {
    registerSettingsSection({
        id: "editor-vim",
        title: "编辑器",
        order: 20,
        render: () => <EditorSettingsSection />,
    });
}
