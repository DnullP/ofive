/**
 * @module settings/registrars/generalSettingsRegistrar
 * @description 全局设置注册：注册“通用”与“功能”相关设置项。
 * @dependencies
 *  - react
 *  - ../../store/configStore
 *  - ../settingsRegistry
 */

import type { ReactNode } from "react";
import {
    updateRememberLastVault,
    updateSearchEnabled,
    useConfigState,
} from "../../store/configStore";
import { registerSettingsSection } from "../settingsRegistry";

/**
 * @function GeneralSettingsSection
 * @description 通用设置选栏内容。
 * @returns React 节点。
 */
function GeneralSettingsSection(): ReactNode {
    const configState = useConfigState();

    return (
        <div className="settings-item-group">
            <label className="settings-item" htmlFor="remember-last-vault-switch">
                <div>
                    <div className="settings-item-title">保存上次打开仓库</div>
                    <div className="settings-item-desc">关闭后，下次启动不会自动恢复上次仓库路径。</div>
                </div>
                <input
                    id="remember-last-vault-switch"
                    type="checkbox"
                    checked={configState.frontendSettings.rememberLastVault}
                    onChange={(event) => {
                        updateRememberLastVault(event.target.checked);
                    }}
                />
            </label>

            <label className="settings-item" htmlFor="search-feature-switch">
                <div>
                    <div className="settings-item-title">开启搜索功能</div>
                    <div className="settings-item-desc">关闭后，活动栏将隐藏搜索图标。</div>
                </div>
                <input
                    id="search-feature-switch"
                    type="checkbox"
                    checked={configState.featureSettings.searchEnabled}
                    onChange={(event) => {
                        void updateSearchEnabled(event.target.checked);
                    }}
                />
            </label>

            {configState.error ? <div className="settings-tab-error">{configState.error}</div> : null}
        </div>
    );
}

/**
 * @function registerGeneralSettingsSection
 * @description 注册全局设置选栏。
 */
export function registerGeneralSettingsSection(): void {
    registerSettingsSection({
        id: "general-global",
        title: "通用",
        order: 10,
        render: () => <GeneralSettingsSection />,
    });
}
