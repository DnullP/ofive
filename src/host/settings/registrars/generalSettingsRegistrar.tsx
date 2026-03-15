/**
 * @module host/settings/registrars/generalSettingsRegistrar
 * @description 全局设置注册：注册“通用”与“功能”相关设置项。
 * @dependencies
 *  - react
 *  - ../../store/configStore
 *  - ../settingsRegistry
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
    updateRememberLastVault,
    updateSearchEnabled,
    updateFeatureSetting,
    useConfigState,
} from "../../store/configStore";
import { registerSettingsSection } from "../settingsRegistry";

function GeneralSettingsSection(): ReactNode {
    const { t } = useTranslation();
    const configState = useConfigState();

    return (
        <div className="settings-item-group">
            <label className="settings-compact-row" htmlFor="remember-last-vault-switch">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.rememberLastVault")}</span>
                    <span className="settings-compact-desc">{t("settings.rememberLastVaultDesc")}</span>
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

            <label className="settings-compact-row" htmlFor="search-feature-switch">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.enableSearch")}</span>
                    <span className="settings-compact-desc">{t("settings.enableSearchDesc")}</span>
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

            <label className="settings-compact-row" htmlFor="knowledge-graph-feature-switch">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.enableKnowledgeGraph")}</span>
                    <span className="settings-compact-desc">{t("settings.enableKnowledgeGraphDesc")}</span>
                </div>
                <input
                    id="knowledge-graph-feature-switch"
                    type="checkbox"
                    checked={configState.featureSettings.knowledgeGraphEnabled}
                    onChange={(event) => {
                        void updateFeatureSetting("knowledgeGraphEnabled", event.target.checked);
                    }}
                />
            </label>

            {configState.error ? <div className="settings-tab-error">{configState.error}</div> : null}
        </div>
    );
}

export function registerGeneralSettingsSection(): void {
    registerSettingsSection({
        id: "general-global",
        title: "settings.generalSection",
        order: 10,
        render: () => <GeneralSettingsSection />,
    });
}