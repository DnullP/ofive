/**
 * @module plugins/knowledge-graph/settings/graphSettingsRegistrar
 * @description 图谱设置注册：由图谱组件注册可配置项选栏。
 * @dependencies
 *  - react
 *  - ..
 *  - ../store/graphSettingsStore
 *  - ../../../host/settings/settingsRegistry
 */

import type { ChangeEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { UiNumberInput } from "../../../host/ui";
import {
    KNOWLEDGE_GRAPH_SETTING_DEFINITIONS,
    type KnowledgeGraphSettingDefinition,
    type KnowledgeGraphSettingKey,
} from "../tab/knowledgeGraphSettings";
import {
    resetGraphSettings,
    updateGraphSetting,
    useGraphSettingsState,
    useGraphSettingsSync,
} from "../store/graphSettingsStore";
import { useVaultState } from "../../../host/vault/vaultStore";
import { registerSettingsItem, registerSettingsSection } from "../../../host/settings/settingsRegistry";

/**
 * @function toNumberValue
 * @description 将输入值转换为数值并保持有限性。
 * @param raw 输入字符串。
 * @param fallback 回退值。
 * @returns 数值。
 */
function toNumberValue(raw: string, fallback: number): number {
    const next = Number(raw);
    return Number.isFinite(next) ? next : fallback;
}

function clampGraphNumberValue(
    raw: string,
    fallback: number,
    definition: KnowledgeGraphSettingDefinition,
): number | null {
    if (raw.trim().length === 0) {
        return null;
    }

    const parsed = toNumberValue(raw, fallback);
    const min = definition.min ?? Number.NEGATIVE_INFINITY;
    const max = definition.max ?? Number.POSITIVE_INFINITY;
    return Math.max(min, Math.min(max, parsed));
}

/**
 * @function GraphSettingField
 * @description 渲染单个图谱设置字段。
 * @param definition 字段定义。
 * @returns React 节点。
 */
function GraphSettingField({ definition }: { definition: KnowledgeGraphSettingDefinition }): ReactNode {
    const { t } = useTranslation();
    const { settings } = useGraphSettingsState();
    const currentValue = settings[definition.key];

    const onBooleanChange = (event: ChangeEvent<HTMLInputElement>): void => {
        updateGraphSetting(definition.key, event.target.checked as never);
    };

    const parseNumberValue = (rawValue: string): number | null => {
        return clampGraphNumberValue(rawValue, Number(currentValue), definition);
    };

    const onNumberChange = (nextValue: number): void => {
        void updateGraphSetting(
            definition.key,
            nextValue as never,
        );
    };

    /* boolean 类型：紧凑横向行，复选框在右侧。描述通过 title 属性（tooltip）展示 */
    if (definition.fieldType === "boolean") {
        return (
            <label className="settings-dense-row" key={definition.key} title={t(definition.description)}>
                <span className="settings-dense-title">{t(definition.title)}</span>
                <input
                    type="checkbox"
                    checked={Boolean(currentValue)}
                    onChange={onBooleanChange}
                />
            </label>
        );
    }

    /* number 类型：紧凑横向行，控件在右侧。描述通过 title 属性（tooltip）展示 */
    return (
        <div className="settings-dense-row" key={definition.key} title={t(definition.description)}>
            <span className="settings-dense-title">{t(definition.title)}</span>

            <div className="settings-graph-control-row">
                <UiNumberInput
                    className="settings-compact-number-input"
                    controlSize="compact"
                    variant="settings"
                    value={Number(currentValue)}
                    min={definition.min}
                    max={definition.max}
                    step={definition.step ?? 1}
                    parseValue={parseNumberValue}
                    onValueChange={onNumberChange}
                />
            </div>
        </div>
    );
}

/**
 * @function GraphSettingsSection
 * @description 图谱设置选栏内容。
 * @returns React 节点。
 */
function GraphSettingsSection(): ReactNode {
    const { t } = useTranslation();
    const { currentVaultPath } = useVaultState();
    useGraphSettingsSync(currentVaultPath, true);

    return (
        <div className="settings-item-group">
            {/* --- 图谱设置总览 + 恢复默认 --- */}
            {/* styles: .settings-compact-row 紧凑行布局 */}
            <div className="settings-compact-row">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("graph.settingsTitle")}</span>
                    <span className="settings-compact-desc">
                        {t("graph.settingsCountDesc", {
                            count: KNOWLEDGE_GRAPH_SETTING_DEFINITIONS.length,
                        })}
                    </span>
                </div>
                <button
                    type="button"
                    className="settings-shortcut-action-btn"
                    onClick={() => {
                        void resetGraphSettings();
                    }}
                >
                    {t("common.resetDefault")}
                </button>
            </div>

            {KNOWLEDGE_GRAPH_SETTING_DEFINITIONS.map((definition) => (
                <GraphSettingField key={definition.key as KnowledgeGraphSettingKey} definition={definition} />
            ))}
        </div>
    );
}

/**
 * @function registerGraphSettingsSection
 * @description 注册图谱设置选栏。
 */
export function registerGraphSettingsSection(): () => void {
    const unregisterSection = registerSettingsSection({
        id: "graph-component",
        title: "settings.graphSection",
        order: 40,
        description: "settings.graphSectionDesc",
        searchTerms: ["graph", "knowledge", "node", "physics", "图谱", "知识图谱", "节点", "布局"],
    });

    const unregisterItem = registerSettingsItem({
        id: "knowledge-graph-settings-panel",
        sectionId: "graph-component",
        order: 10,
        kind: "custom",
        title: "settings.graphSection",
        description: "settings.graphSectionDesc",
        searchTerms: ["graph", "knowledge", "node", "physics", "图谱", "知识图谱", "节点", "布局"],
        render: () => <GraphSettingsSection />,
    });

    return () => {
        unregisterItem();
        unregisterSection();
    };
}
