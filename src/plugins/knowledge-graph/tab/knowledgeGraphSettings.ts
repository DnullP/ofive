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
 *  - buildKnowledgeGraphConfig
 */

import type { GraphConfigInterface } from "@cosmos.gl/graph";

/**
 * @constant DEFAULT_KNOWLEDGE_GRAPH_SETTINGS
 * @description 知识图谱设置默认值（与当前产品默认体验保持一致）。
 */
export const DEFAULT_KNOWLEDGE_GRAPH_SETTINGS = {
    backgroundColor: "#020617",
    pointDefaultColor: "#60a5fa",
    pointDefaultSize: 2.5,
    pointSizeScale: 1,
    pointOpacity: 1,
    linkDefaultColor: "#64748b",
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
export type SettingFieldType = "boolean" | "number" | "color";

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
 * @constant KNOWLEDGE_GRAPH_SETTING_DEFINITIONS
 * @description 图谱设置项元数据（覆盖当前全部可配置参数）。
 */
export const KNOWLEDGE_GRAPH_SETTING_DEFINITIONS: KnowledgeGraphSettingDefinition[] = [
    { key: "backgroundColor", title: "graph.backgroundColor", description: "graph.backgroundColorDesc", fieldType: "color" },
    { key: "pointDefaultColor", title: "graph.pointDefaultColor", description: "graph.pointDefaultColorDesc", fieldType: "color" },
    { key: "pointDefaultSize", title: "graph.pointDefaultSize", description: "graph.pointDefaultSizeDesc", fieldType: "number", min: 1, max: 30, step: 0.1 },
    { key: "pointSizeScale", title: "graph.pointSizeScale", description: "graph.pointSizeScaleDesc", fieldType: "number", min: 0.1, max: 10, step: 0.1 },
    { key: "pointOpacity", title: "graph.pointOpacity", description: "graph.pointOpacityDesc", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "linkDefaultColor", title: "graph.linkDefaultColor", description: "graph.linkDefaultColorDesc", fieldType: "color" },
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
    };
}
