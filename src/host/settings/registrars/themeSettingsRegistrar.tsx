/**
 * @module host/settings/registrars/themeSettingsRegistrar
 * @description 风格设置注册：提供全局主题切换。
 * @dependencies
 *  - react
 *  - ../../store/themeStore
 *  - ../settingsRegistry
 */

import { useMemo, type ChangeEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { updateFeatureSetting, useConfigState } from "../../store/configStore";
import { updateThemeMode, useThemeState, type ThemeMode } from "../../store/themeStore";
import { registerSettingsSection } from "../settingsRegistry";

const THEME_MODE_OPTIONS: Array<{ value: ThemeMode; labelKey: string; descKey: string }> = [
    {
        value: "dark",
        labelKey: "settings.themeDark",
        descKey: "settings.themeDarkDesc",
    },
    {
        value: "light",
        labelKey: "settings.themeLight",
        descKey: "settings.themeLightDesc",
    },
    {
        value: "kraft",
        labelKey: "settings.themeKraft",
        descKey: "settings.themeKraftDesc",
    },
];

/**
 * @function clampStepNumber
 * @description 将字符串输入限制在指定范围，并对齐到给定步进。
 * @param raw 原始输入。
 * @param min 最小值。
 * @param max 最大值。
 * @param step 步进。
 * @param fallback 解析失败时的回退值。
 * @returns 处理后的数值。
 */
function clampStepNumber(raw: string, min: number, max: number, step: number, fallback: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    const next = Math.max(min, Math.min(max, parsed));
    return Number((Math.round(next / step) * step).toFixed(2));
}

/**
 * @function GlassSettingNumberRow
 * @description 渲染单个毛玻璃数值控制项。
 * @param props 控件所需属性。
 * @returns React 节点。
 */
function GlassSettingNumberRow(props: {
    id: string;
    title: string;
    description: string;
    value: number;
    min: number;
    max: number;
    step: number;
    suffix: string;
    showRange?: boolean;
    onChange: (nextValue: number) => void;
}): ReactNode {
    const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
        props.onChange(clampStepNumber(event.target.value, props.min, props.max, props.step, props.value));
    };

    return (
        <div className="settings-compact-row settings-compact-row--stacked">
            <div className="settings-compact-info">
                <span className="settings-compact-title">{props.title}</span>
                <span className="settings-compact-desc">{props.description}</span>
            </div>

            <div className="settings-glass-control-row">
                {props.showRange === false ? null : (
                    <input
                        id={props.id}
                        className="settings-glass-range-input"
                        type="range"
                        min={props.min}
                        max={props.max}
                        step={props.step}
                        value={props.value}
                        onChange={handleChange}
                    />
                )}
                <div className="settings-glass-value-group">
                    <input
                        className="settings-compact-number-input"
                        type="number"
                        min={props.min}
                        max={props.max}
                        step={props.step}
                        value={props.value}
                        onChange={handleChange}
                    />
                    <span className="settings-glass-value-suffix">{props.suffix}</span>
                </div>
            </div>
        </div>
    );
}

function ThemeSettingsSection(): ReactNode {
    const { t } = useTranslation();
    const themeState = useThemeState();
    const configState = useConfigState();
    const { featureSettings } = configState;
    const isWindowsRuntime = useMemo(() => {
        if (typeof navigator === "undefined") {
            return false;
        }

        return `${navigator.userAgent} ${navigator.platform}`.toLowerCase().includes("win");
    }, []);

    return (
        <div className="settings-item-group">
            <div className="settings-compact-row-column">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.themeTitle")}</span>
                    <span className="settings-compact-desc">{t("settings.themeDesc")}</span>
                </div>

                <div className="settings-theme-mode-row">
                    {THEME_MODE_OPTIONS.map((option) => {
                        const isActive = themeState.themeMode === option.value;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                className={`settings-theme-mode-button ${isActive ? "active" : ""}`}
                                onClick={() => {
                                    updateThemeMode(option.value);
                                }}
                            >
                                <span className="settings-theme-mode-button-title">{t(option.labelKey)}</span>
                                <span className="settings-theme-mode-button-desc">{t(option.descKey)}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <label className="settings-compact-row" htmlFor="glass-effect-switch">
                <div className="settings-compact-info">
                    <span className="settings-compact-title">{t("settings.enableGlassEffect")}</span>
                    <span className="settings-compact-desc">{t("settings.enableGlassEffectDesc")}</span>
                </div>
                <input
                    id="glass-effect-switch"
                    type="checkbox"
                    checked={featureSettings.glassEffectEnabled}
                    onChange={(event) => {
                        void updateFeatureSetting("glassEffectEnabled", event.target.checked);
                    }}
                />
            </label>

            {featureSettings.glassEffectEnabled ? (
                <>
                    <GlassSettingNumberRow
                        id="glass-tint-opacity"
                        title={t("settings.glassTintOpacity")}
                        description={t("settings.glassTintOpacityDesc")}
                        value={featureSettings.glassTintOpacity}
                        min={0.02}
                        max={0.24}
                        step={0.01}
                        suffix={t("settings.glassOpacityUnit")}
                        onChange={(nextValue) => {
                            void updateFeatureSetting("glassTintOpacity", nextValue);
                        }}
                    />
                    <GlassSettingNumberRow
                        id="glass-surface-opacity"
                        title={t("settings.glassSurfaceOpacity")}
                        description={t("settings.glassSurfaceOpacityDesc")}
                        value={featureSettings.glassSurfaceOpacity}
                        min={0.08}
                        max={0.4}
                        step={0.01}
                        suffix={t("settings.glassOpacityUnit")}
                        onChange={(nextValue) => {
                            void updateFeatureSetting("glassSurfaceOpacity", nextValue);
                        }}
                    />
                    <GlassSettingNumberRow
                        id="glass-inactive-surface-opacity"
                        title={t("settings.glassInactiveSurfaceOpacity")}
                        description={t("settings.glassInactiveSurfaceOpacityDesc")}
                        value={featureSettings.glassInactiveSurfaceOpacity}
                        min={0.12}
                        max={0.5}
                        step={0.01}
                        suffix={t("settings.glassOpacityUnit")}
                        onChange={(nextValue) => {
                            void updateFeatureSetting("glassInactiveSurfaceOpacity", nextValue);
                        }}
                    />
                    <GlassSettingNumberRow
                        id="glass-blur-radius"
                        title={t("settings.glassBlurRadius")}
                        description={t("settings.glassBlurRadiusDesc")}
                        value={featureSettings.glassBlurRadius}
                        min={4}
                        max={24}
                        step={1}
                        suffix={t("settings.glassBlurRadiusUnit")}
                        onChange={(nextValue) => {
                            void updateFeatureSetting("glassBlurRadius", nextValue);
                        }}
                    />
                    {isWindowsRuntime ? (
                        <>
                            <GlassSettingNumberRow
                                id="windows-acrylic-focused-red"
                                title={t("settings.windowsAcrylicFocusedRed")}
                                description={t("settings.windowsAcrylicFocusedRedDesc")}
                                value={featureSettings.windowsAcrylicFocusedRed}
                                min={0}
                                max={255}
                                step={1}
                                suffix={t("settings.glassChannelUnit")}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicFocusedRed", nextValue);
                                }}
                            />
                            <GlassSettingNumberRow
                                id="windows-acrylic-focused-green"
                                title={t("settings.windowsAcrylicFocusedGreen")}
                                description={t("settings.windowsAcrylicFocusedGreenDesc")}
                                value={featureSettings.windowsAcrylicFocusedGreen}
                                min={0}
                                max={255}
                                step={1}
                                suffix={t("settings.glassChannelUnit")}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicFocusedGreen", nextValue);
                                }}
                            />
                            <GlassSettingNumberRow
                                id="windows-acrylic-focused-blue"
                                title={t("settings.windowsAcrylicFocusedBlue")}
                                description={t("settings.windowsAcrylicFocusedBlueDesc")}
                                value={featureSettings.windowsAcrylicFocusedBlue}
                                min={0}
                                max={255}
                                step={1}
                                suffix={t("settings.glassChannelUnit")}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicFocusedBlue", nextValue);
                                }}
                            />
                            <GlassSettingNumberRow
                                id="windows-acrylic-focused-alpha"
                                title={t("settings.windowsAcrylicFocusedAlpha")}
                                description={t("settings.windowsAcrylicFocusedAlphaDesc")}
                                value={featureSettings.windowsAcrylicFocusedAlpha}
                                min={0}
                                max={255}
                                step={1}
                                suffix={t("settings.glassChannelUnit")}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicFocusedAlpha", nextValue);
                                }}
                            />
                            <GlassSettingNumberRow
                                id="windows-acrylic-inactive-red"
                                title={t("settings.windowsAcrylicInactiveRed")}
                                description={t("settings.windowsAcrylicInactiveRedDesc")}
                                value={featureSettings.windowsAcrylicInactiveRed}
                                min={0}
                                max={255}
                                step={1}
                                suffix={t("settings.glassChannelUnit")}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicInactiveRed", nextValue);
                                }}
                            />
                            <GlassSettingNumberRow
                                id="windows-acrylic-inactive-green"
                                title={t("settings.windowsAcrylicInactiveGreen")}
                                description={t("settings.windowsAcrylicInactiveGreenDesc")}
                                value={featureSettings.windowsAcrylicInactiveGreen}
                                min={0}
                                max={255}
                                step={1}
                                suffix={t("settings.glassChannelUnit")}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicInactiveGreen", nextValue);
                                }}
                            />
                            <GlassSettingNumberRow
                                id="windows-acrylic-inactive-blue"
                                title={t("settings.windowsAcrylicInactiveBlue")}
                                description={t("settings.windowsAcrylicInactiveBlueDesc")}
                                value={featureSettings.windowsAcrylicInactiveBlue}
                                min={0}
                                max={255}
                                step={1}
                                suffix={t("settings.glassChannelUnit")}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicInactiveBlue", nextValue);
                                }}
                            />
                            <GlassSettingNumberRow
                                id="windows-acrylic-inactive-alpha"
                                title={t("settings.windowsAcrylicInactiveAlpha")}
                                description={t("settings.windowsAcrylicInactiveAlphaDesc")}
                                value={featureSettings.windowsAcrylicInactiveAlpha}
                                min={0}
                                max={255}
                                step={1}
                                suffix={t("settings.glassChannelUnit")}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicInactiveAlpha", nextValue);
                                }}
                            />

                            <label className="settings-compact-row" htmlFor="windows-acrylic-disable-system-backdrop">
                                <div className="settings-compact-info">
                                    <span className="settings-compact-title">{t("settings.windowsAcrylicDisableSystemBackdrop")}</span>
                                    <span className="settings-compact-desc">{t("settings.windowsAcrylicDisableSystemBackdropDesc")}</span>
                                </div>
                                <input
                                    id="windows-acrylic-disable-system-backdrop"
                                    type="checkbox"
                                    checked={featureSettings.windowsAcrylicDisableSystemBackdrop}
                                    onChange={(event) => {
                                        void updateFeatureSetting("windowsAcrylicDisableSystemBackdrop", event.target.checked);
                                    }}
                                />
                            </label>

                            <GlassSettingNumberRow
                                id="windows-acrylic-focused-accent-flags"
                                title={t("settings.windowsAcrylicFocusedAccentFlags")}
                                description={t("settings.windowsAcrylicFocusedAccentFlagsDesc")}
                                value={featureSettings.windowsAcrylicFocusedAccentFlags}
                                min={0}
                                max={4294967295}
                                step={1}
                                suffix={t("settings.glassRawUnit")}
                                showRange={false}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicFocusedAccentFlags", nextValue);
                                }}
                            />
                            <GlassSettingNumberRow
                                id="windows-acrylic-focused-animation-id"
                                title={t("settings.windowsAcrylicFocusedAnimationId")}
                                description={t("settings.windowsAcrylicFocusedAnimationIdDesc")}
                                value={featureSettings.windowsAcrylicFocusedAnimationId}
                                min={0}
                                max={4294967295}
                                step={1}
                                suffix={t("settings.glassRawUnit")}
                                showRange={false}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicFocusedAnimationId", nextValue);
                                }}
                            />
                            <GlassSettingNumberRow
                                id="windows-acrylic-inactive-accent-flags"
                                title={t("settings.windowsAcrylicInactiveAccentFlags")}
                                description={t("settings.windowsAcrylicInactiveAccentFlagsDesc")}
                                value={featureSettings.windowsAcrylicInactiveAccentFlags}
                                min={0}
                                max={4294967295}
                                step={1}
                                suffix={t("settings.glassRawUnit")}
                                showRange={false}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicInactiveAccentFlags", nextValue);
                                }}
                            />
                            <GlassSettingNumberRow
                                id="windows-acrylic-inactive-animation-id"
                                title={t("settings.windowsAcrylicInactiveAnimationId")}
                                description={t("settings.windowsAcrylicInactiveAnimationIdDesc")}
                                value={featureSettings.windowsAcrylicInactiveAnimationId}
                                min={0}
                                max={4294967295}
                                step={1}
                                suffix={t("settings.glassRawUnit")}
                                showRange={false}
                                onChange={(nextValue) => {
                                    void updateFeatureSetting("windowsAcrylicInactiveAnimationId", nextValue);
                                }}
                            />
                        </>
                    ) : null}
                </>
            ) : null}

            {configState.error ? <div className="settings-tab-error">{configState.error}</div> : null}
        </div>
    );
}

export function registerThemeSettingsSection(): void {
    registerSettingsSection({
        id: "theme-style",
        title: "settings.themeSection",
        order: 20,
        description: "settings.themeSectionDesc",
        searchTerms: ["theme", "appearance", "glass", "acrylic", "dark", "light", "kraft", "主题", "风格", "毛玻璃", "透明"],
        render: () => <ThemeSettingsSection />,
    });
}