/**
 * @module settings/registrars/graphSettingsRegistrar
 * @description 图谱设置注册：由图谱组件注册可配置项选栏。
 * @dependencies
 *  - react
 *  - ../../layout/knowledgeGraphSettings
 *  - ../../store/graphSettingsStore
 *  - ../settingsRegistry
 */

import type { ChangeEvent, ReactNode } from "react";
import {
    KNOWLEDGE_GRAPH_SETTING_DEFINITIONS,
    type KnowledgeGraphSettingDefinition,
    type KnowledgeGraphSettingKey,
} from "../../layout/knowledgeGraphSettings";
import {
    resetGraphSettings,
    updateGraphSetting,
    useGraphSettingsState,
    useGraphSettingsSync,
} from "../../store/graphSettingsStore";
import { useVaultState } from "../../store/vaultStore";
import { registerSettingsSection } from "../settingsRegistry";

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

/**
 * @function GraphSettingField
 * @description 渲染单个图谱设置字段。
 * @param definition 字段定义。
 * @returns React 节点。
 */
function GraphSettingField({ definition }: { definition: KnowledgeGraphSettingDefinition }): ReactNode {
    const { settings } = useGraphSettingsState();
    const currentValue = settings[definition.key];

    const onBooleanChange = (event: ChangeEvent<HTMLInputElement>): void => {
        updateGraphSetting(definition.key, event.target.checked as never);
    };

    const onNumberChange = (event: ChangeEvent<HTMLInputElement>): void => {
        updateGraphSetting(
            definition.key,
            toNumberValue(event.target.value, Number(currentValue)) as never,
        );
    };

    const onColorChange = (event: ChangeEvent<HTMLInputElement>): void => {
        updateGraphSetting(definition.key, event.target.value as never);
    };

    return (
        <div className="settings-item settings-item-column" key={definition.key}>
            <div>
                <div className="settings-item-title">{definition.title}</div>
                <div className="settings-item-desc">{definition.description}</div>
            </div>

            <div className="settings-graph-control-row">
                {definition.fieldType === "boolean" ? (
                    <input
                        type="checkbox"
                        checked={Boolean(currentValue)}
                        onChange={onBooleanChange}
                    />
                ) : null}

                {definition.fieldType === "number" ? (
                    <input
                        className="settings-graph-input"
                        type="number"
                        value={String(currentValue)}
                        min={definition.min}
                        max={definition.max}
                        step={definition.step ?? 1}
                        onChange={onNumberChange}
                    />
                ) : null}

                {definition.fieldType === "color" ? (
                    <>
                        <input
                            className="settings-graph-color-input"
                            type="color"
                            value={String(currentValue)}
                            onChange={onColorChange}
                        />
                        <input
                            className="settings-graph-input"
                            type="text"
                            value={String(currentValue)}
                            onChange={onColorChange}
                        />
                    </>
                ) : null}
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
    const { settings } = useGraphSettingsState();
    const { currentVaultPath } = useVaultState();
    useGraphSettingsSync(currentVaultPath, true);

    return (
        <div className="settings-item-group">
            <div className="settings-item settings-item-column">
                <div>
                    <div className="settings-item-title">知识图谱设置</div>
                    <div className="settings-item-desc">以下选项覆盖图谱组件全部当前可配置项。</div>
                </div>
                <button
                    type="button"
                    className="settings-shortcut-save-button"
                    onClick={() => {
                        void resetGraphSettings();
                    }}
                >
                    恢复默认
                </button>
                <div className="settings-shortcut-hint">当前配置项数量：{Object.keys(settings).length}</div>
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
export function registerGraphSettingsSection(): void {
    registerSettingsSection({
        id: "graph-component",
        title: "知识图谱",
        order: 40,
        render: () => <GraphSettingsSection />,
    });
}
