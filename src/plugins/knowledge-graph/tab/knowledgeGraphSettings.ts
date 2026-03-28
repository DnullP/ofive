/**
 * @module layout/knowledgeGraphSettings
 * @description 知识图谱设置模型：定义默认值、字段元数据与配置映射。
 * @dependencies
 *  - @cosmos.gl/graph
 *
 * @example
 *   const config = buildKnowledgeGraphConfig(settings)
 *
 * @exports
 *  - DEFAULT_KNOWLEDGE_GRAPH_SETTINGS
 *  - KNOWLEDGE_GRAPH_SETTING_DEFINITIONS
 *  - mergeKnowledgeGraphSettings
 *  - buildKnowledgeGraphConfig
 */

import type { GraphConfigInterface } from "@cosmos.gl/graph";

/**
 * @constant KNOWLEDGE_GRAPH_THEME_COLOR_TOKENS
 * @description 图谱内部渲染颜色与全局主题 token 的映射关系。
 */
const KNOWLEDGE_GRAPH_THEME_COLOR_TOKENS = {
    backgroundColor: "graph-bg-primary",
    pointDefaultColor: "graph-point-color",
    pointGreyoutColor: "graph-point-greyout-color",
    hoveredPointRingColor: "graph-point-ring-hover-color",
    focusedPointRingColor: "graph-point-ring-focus-color",
    linkDefaultColor: "graph-link-color",
    hoveredLinkColor: "graph-link-hover-color",
} as const;

/**
 * @type KnowledgeGraphThemeColorKey
 * @description 图谱内部主题颜色配置键。
 */
type KnowledgeGraphThemeColorKey = keyof typeof KNOWLEDGE_GRAPH_THEME_COLOR_TOKENS;

/**
 * @function readKnowledgeGraphThemeColorToken
 * @description 读取当前主题下指定图谱 token 的计算后颜色值。
 * @param tokenName 主题 token 名称，不包含前导 `--`。
 * @returns 颜色字符串；不可读取时返回 null。
 */
function readKnowledgeGraphThemeColorToken(tokenName: string): string | null {
    if (typeof window === "undefined") {
        return null;
    }

    const rootStyle = window.getComputedStyle(document.documentElement);
    const rawValue = rootStyle.getPropertyValue(`--${tokenName}`).trim();
    if (rawValue.length === 0) {
        return null;
    }

    if (typeof document.createElement !== "function") {
        return rawValue;
    }

    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.pointerEvents = "none";
    probe.style.opacity = "0";
    probe.style.color = `var(--${tokenName})`;

    const mountTarget = document.body ?? document.documentElement;
    if (!mountTarget || typeof mountTarget.appendChild !== "function") {
        return rawValue;
    }

    mountTarget.appendChild(probe);
    const resolvedValue = window.getComputedStyle(probe).color.trim();
    probe.remove();

    return resolvedValue.length > 0 ? resolvedValue : rawValue;
}

/**
 * @function resolveKnowledgeGraphThemeColor
 * @description 解析指定图谱颜色键在当前主题下的实际颜色值。
 * @param key 图谱内部主题颜色配置键。
 * @returns 实际颜色值；若无法解析则返回空字符串。
 */
function resolveKnowledgeGraphThemeColor(key: KnowledgeGraphThemeColorKey): string {
    return readKnowledgeGraphThemeColorToken(KNOWLEDGE_GRAPH_THEME_COLOR_TOKENS[key]) ?? "";
}

/**
 * @function createKnowledgeGraphThemeConfig
 * @description 构建仅由主题控制的图谱颜色配置。
 * @returns 图谱颜色配置。
 */
function createKnowledgeGraphThemeConfig(): Pick<GraphConfigInterface, KnowledgeGraphThemeColorKey> {
    return {
        backgroundColor: resolveKnowledgeGraphThemeColor("backgroundColor"),
        pointDefaultColor: resolveKnowledgeGraphThemeColor("pointDefaultColor"),
        pointGreyoutColor: resolveKnowledgeGraphThemeColor("pointGreyoutColor"),
        hoveredPointRingColor: resolveKnowledgeGraphThemeColor("hoveredPointRingColor"),
        focusedPointRingColor: resolveKnowledgeGraphThemeColor("focusedPointRingColor"),
        linkDefaultColor: resolveKnowledgeGraphThemeColor("linkDefaultColor"),
        hoveredLinkColor: resolveKnowledgeGraphThemeColor("hoveredLinkColor"),
    };
}

/**
 * @constant DEFAULT_KNOWLEDGE_GRAPH_SETTINGS
 * @description 知识图谱设置默认值。
 *   仅包含允许持久化和用户调整的结构/交互参数。
 *   图谱配色完全由主题 token 控制，不暴露为 setting。
 */
export const DEFAULT_KNOWLEDGE_GRAPH_SETTINGS = {
    pointDefaultSize: 2.5,
    pointSizeScale: 1,
    pointOpacity: 1,
    renderHoveredPointRing: true,
    linkDefaultWidth: 1,
    linkWidthScale: 0.9,
    linkOpacity: 0.43,
    simulationDecay: 24000,
    simulationGravity: 0,
    simulationCenter: 1,
    simulationRepulsion: 1.2,
    simulationRepulsionTheta: 1.05,
    simulationLinkSpring: 0.83,
    simulationLinkDistance: 54,
    simulationRepulsionFromMouse: 2,
    simulationFriction: 0.978,
    simulationCluster: 0.66,
    enableRightClickRepulsion: false,
    enableZoom: true,
    enableDrag: true,
    enableSimulationDuringZoom: true,
    fitViewOnInit: false,
    fitViewDelay: 0,
    fitViewPadding: 0.2,
    fitViewDuration: 0,
    pixelRatio: 2,
    scalePointsOnZoom: true,
    scaleLinksOnZoom: false,
    pointSamplingDistance: 150,
    showFPSMonitor: false,
    spaceSize: 2048,
    rescalePositions: false,
    labelVisibleZoomLevel: 3.8,
} as const;

/**
 * @type KnowledgeGraphSettings
 * @description 知识图谱设置对象类型。
 */
export type KnowledgeGraphSettings = {
    [K in keyof typeof DEFAULT_KNOWLEDGE_GRAPH_SETTINGS]: (typeof DEFAULT_KNOWLEDGE_GRAPH_SETTINGS)[K];
};

/**
 * @type KnowledgeGraphSettingKey
 * @description 知识图谱设置键。
 */
export type KnowledgeGraphSettingKey = keyof KnowledgeGraphSettings;

/**
 * @type SettingFieldType
 * @description 设置字段展示类型。
 */
export type SettingFieldType = "boolean" | "number";

/**
 * @interface KnowledgeGraphSettingDefinition
 * @description 单个知识图谱设置项定义。
 */
export interface KnowledgeGraphSettingDefinition {
    /** 设置键 */
    key: KnowledgeGraphSettingKey;
    /** 设置标题 */
    title: string;
    /** 设置说明 */
    description: string;
    /** 展示字段类型 */
    fieldType: SettingFieldType;
    /** 数值最小值 */
    min?: number;
    /** 数值最大值 */
    max?: number;
    /** 数值步进 */
    step?: number;
}

/**
 * @function mergeKnowledgeGraphSettings
 * @description 将候选设置与默认值合并，并丢弃任何未纳入 setting 模型的字段。
 * @param partialSettings 候选设置。
 * @returns 结构完整且已清洗的图谱设置。
 */
export function mergeKnowledgeGraphSettings(
    partialSettings: Partial<KnowledgeGraphSettings> | null | undefined,
): KnowledgeGraphSettings {
    const merged = { ...DEFAULT_KNOWLEDGE_GRAPH_SETTINGS } as KnowledgeGraphSettings;
    if (!partialSettings) {
        return merged;
    }

    (Object.keys(DEFAULT_KNOWLEDGE_GRAPH_SETTINGS) as KnowledgeGraphSettingKey[]).forEach((key) => {
        const value = partialSettings[key];
        if (value !== undefined) {
            (merged[key] as KnowledgeGraphSettings[typeof key]) = value as KnowledgeGraphSettings[typeof key];
        }
    });

    return merged;
}

/**
 * @constant KNOWLEDGE_GRAPH_SETTING_DEFINITIONS
 * @description 图谱设置项元数据（覆盖当前全部可配置参数）。
 */
export const KNOWLEDGE_GRAPH_SETTING_DEFINITIONS: KnowledgeGraphSettingDefinition[] = [
    { key: "pointDefaultSize", title: "graph.pointDefaultSize", description: "graph.pointDefaultSizeDesc", fieldType: "number", min: 1, max: 30, step: 0.1 },
    { key: "pointSizeScale", title: "graph.pointSizeScale", description: "graph.pointSizeScaleDesc", fieldType: "number", min: 0.1, max: 10, step: 0.1 },
    { key: "pointOpacity", title: "graph.pointOpacity", description: "graph.pointOpacityDesc", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "linkDefaultWidth", title: "graph.linkDefaultWidth", description: "graph.linkDefaultWidthDesc", fieldType: "number", min: 0.1, max: 20, step: 0.1 },
    { key: "linkWidthScale", title: "graph.linkWidthScale", description: "graph.linkWidthScaleDesc", fieldType: "number", min: 0.1, max: 10, step: 0.1 },
    { key: "linkOpacity", title: "graph.linkOpacity", description: "graph.linkOpacityDesc", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "simulationDecay", title: "graph.simulationDecay", description: "graph.simulationDecayDesc", fieldType: "number", min: 100, max: 10000, step: 10 },
    { key: "simulationGravity", title: "graph.simulationGravity", description: "graph.simulationGravityDesc", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "simulationCenter", title: "graph.simulationCenter", description: "graph.simulationCenterDesc", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "simulationRepulsion", title: "graph.simulationRepulsion", description: "graph.simulationRepulsionDesc", fieldType: "number", min: 0, max: 3, step: 0.01 },
    { key: "simulationRepulsionTheta", title: "graph.simulationRepulsionTheta", description: "graph.simulationRepulsionThetaDesc", fieldType: "number", min: 0.1, max: 3, step: 0.01 },
    { key: "simulationLinkSpring", title: "graph.simulationLinkSpring", description: "graph.simulationLinkSpringDesc", fieldType: "number", min: 0, max: 3, step: 0.01 },
    { key: "simulationLinkDistance", title: "graph.simulationLinkDistance", description: "graph.simulationLinkDistanceDesc", fieldType: "number", min: 1, max: 200, step: 1 },
    { key: "simulationRepulsionFromMouse", title: "graph.simulationRepulsionFromMouse", description: "graph.simulationRepulsionFromMouseDesc", fieldType: "number", min: 0, max: 10, step: 0.1 },
    { key: "simulationFriction", title: "graph.simulationFriction", description: "graph.simulationFrictionDesc", fieldType: "number", min: 0, max: 1, step: 0.001 },
    { key: "simulationCluster", title: "graph.simulationCluster", description: "graph.simulationClusterDesc", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "enableRightClickRepulsion", title: "graph.enableRightClickRepulsion", description: "graph.enableRightClickRepulsionDesc", fieldType: "boolean" },
    { key: "enableZoom", title: "graph.enableZoom", description: "graph.enableZoomDesc", fieldType: "boolean" },
    { key: "enableDrag", title: "graph.enableDrag", description: "graph.enableDragDesc", fieldType: "boolean" },
    { key: "enableSimulationDuringZoom", title: "graph.enableSimulationDuringZoom", description: "graph.enableSimulationDuringZoomDesc", fieldType: "boolean" },
    { key: "fitViewOnInit", title: "graph.fitViewOnInit", description: "graph.fitViewOnInitDesc", fieldType: "boolean" },
    { key: "fitViewDelay", title: "graph.fitViewDelay", description: "graph.fitViewDelayDesc", fieldType: "number", min: 0, max: 5000, step: 10 },
    { key: "fitViewPadding", title: "graph.fitViewPadding", description: "graph.fitViewPaddingDesc", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "fitViewDuration", title: "graph.fitViewDuration", description: "graph.fitViewDurationDesc", fieldType: "number", min: 0, max: 5000, step: 10 },
    { key: "pixelRatio", title: "graph.pixelRatio", description: "graph.pixelRatioDesc", fieldType: "number", min: 1, max: 4, step: 0.1 },
    { key: "scalePointsOnZoom", title: "graph.scalePointsOnZoom", description: "graph.scalePointsOnZoomDesc", fieldType: "boolean" },
    { key: "scaleLinksOnZoom", title: "graph.scaleLinksOnZoom", description: "graph.scaleLinksOnZoomDesc", fieldType: "boolean" },
    { key: "pointSamplingDistance", title: "graph.pointSamplingDistance", description: "graph.pointSamplingDistanceDesc", fieldType: "number", min: 10, max: 1000, step: 1 },
    { key: "showFPSMonitor", title: "graph.showFPSMonitor", description: "graph.showFPSMonitorDesc", fieldType: "boolean" },
    { key: "spaceSize", title: "graph.spaceSize", description: "graph.spaceSizeDesc", fieldType: "number", min: 256, max: 8192, step: 1 },
    { key: "rescalePositions", title: "graph.rescalePositions", description: "graph.rescalePositionsDesc", fieldType: "boolean" },
    { key: "labelVisibleZoomLevel", title: "graph.labelVisibleZoomLevel", description: "graph.labelVisibleZoomLevelDesc", fieldType: "number", min: 0.01, max: 10, step: 0.01 },
];

/**
 * @function buildKnowledgeGraphConfig
 * @description 将知识图谱设置映射为 Graph 配置对象。
 *   排除仅供前端 UI 使用而非 Graph 引擎配置的字段（如 labelVisibleZoomLevel）。
 * @param settings 知识图谱设置。
 * @returns Graph 配置。
 */
export function buildKnowledgeGraphConfig(settings: KnowledgeGraphSettings): GraphConfigInterface {
    const { labelVisibleZoomLevel: _ignored, ...graphConfig } = settings;

    return {
        ...graphConfig,
        ...createKnowledgeGraphThemeConfig(),
    };
}
