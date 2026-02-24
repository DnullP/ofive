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
    pointDefaultSize: 5,
    pointSizeScale: 1,
    pointOpacity: 1,
    linkDefaultColor: "#64748b",
    linkDefaultWidth: 1.8,
    linkWidthScale: 1,
    linkOpacity: 0.6,
    simulationDecay: 3200,
    simulationGravity: 0,
    simulationCenter: 0.36,
    simulationRepulsion: 0.3,
    simulationRepulsionTheta: 1.15,
    simulationLinkSpring: 0.52,
    simulationLinkDistance: 22,
    simulationRepulsionFromMouse: 2,
    simulationFriction: 0.978,
    simulationCluster: 0.1,
    enableRightClickRepulsion: false,
    enableZoom: true,
    enableDrag: true,
    enableSimulationDuringZoom: false,
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
    { key: "backgroundColor", title: "背景颜色", description: "图谱画布背景色。", fieldType: "color" },
    { key: "pointDefaultColor", title: "节点颜色", description: "节点默认颜色。", fieldType: "color" },
    { key: "pointDefaultSize", title: "节点大小", description: "节点默认半径。", fieldType: "number", min: 1, max: 30, step: 0.1 },
    { key: "pointSizeScale", title: "节点缩放系数", description: "节点大小整体倍率。", fieldType: "number", min: 0.1, max: 10, step: 0.1 },
    { key: "pointOpacity", title: "节点透明度", description: "节点整体透明度。", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "linkDefaultColor", title: "边颜色", description: "边默认颜色。", fieldType: "color" },
    { key: "linkDefaultWidth", title: "边宽度", description: "边默认宽度。", fieldType: "number", min: 0.1, max: 20, step: 0.1 },
    { key: "linkWidthScale", title: "边缩放系数", description: "边宽度整体倍率。", fieldType: "number", min: 0.1, max: 10, step: 0.1 },
    { key: "linkOpacity", title: "边透明度", description: "边整体透明度。", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "simulationDecay", title: "衰减系数", description: "仿真衰减速度。", fieldType: "number", min: 100, max: 10000, step: 10 },
    { key: "simulationGravity", title: "重力", description: "仿真重力系数。", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "simulationCenter", title: "中心力", description: "中心聚拢系数。", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "simulationRepulsion", title: "斥力", description: "节点间斥力系数。", fieldType: "number", min: 0, max: 3, step: 0.01 },
    { key: "simulationRepulsionTheta", title: "斥力 Theta", description: "斥力近似参数。", fieldType: "number", min: 0.1, max: 3, step: 0.01 },
    { key: "simulationLinkSpring", title: "弹簧系数", description: "边弹簧强度。", fieldType: "number", min: 0, max: 3, step: 0.01 },
    { key: "simulationLinkDistance", title: "边目标距离", description: "边的最小期望距离。", fieldType: "number", min: 1, max: 200, step: 1 },
    { key: "simulationRepulsionFromMouse", title: "鼠标斥力", description: "鼠标施加斥力强度。", fieldType: "number", min: 0, max: 10, step: 0.1 },
    { key: "simulationFriction", title: "摩擦系数", description: "运动阻尼系数。", fieldType: "number", min: 0, max: 1, step: 0.001 },
    { key: "simulationCluster", title: "聚类系数", description: "聚类力强度。", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "enableRightClickRepulsion", title: "右键斥力", description: "是否启用右键鼠标斥力。", fieldType: "boolean" },
    { key: "enableZoom", title: "允许缩放", description: "是否允许缩放交互。", fieldType: "boolean" },
    { key: "enableDrag", title: "允许拖拽", description: "是否允许拖拽节点。", fieldType: "boolean" },
    { key: "enableSimulationDuringZoom", title: "缩放时仿真", description: "缩放期间保持仿真运行。", fieldType: "boolean" },
    { key: "fitViewOnInit", title: "初始化 fitView", description: "初始化时是否自动适配视图。", fieldType: "boolean" },
    { key: "fitViewDelay", title: "fitView 延迟", description: "初始化 fitView 延迟（毫秒）。", fieldType: "number", min: 0, max: 5000, step: 10 },
    { key: "fitViewPadding", title: "fitView 边距", description: "初始化 fitView 边距比例。", fieldType: "number", min: 0, max: 1, step: 0.01 },
    { key: "fitViewDuration", title: "fitView 动画", description: "初始化 fitView 动画时长（毫秒）。", fieldType: "number", min: 0, max: 5000, step: 10 },
    { key: "pixelRatio", title: "像素比", description: "画布渲染像素比。", fieldType: "number", min: 1, max: 4, step: 0.1 },
    { key: "scalePointsOnZoom", title: "缩放时节点放大", description: "缩放时节点是否同步缩放。", fieldType: "boolean" },
    { key: "scaleLinksOnZoom", title: "缩放时边放大", description: "缩放时边是否同步缩放。", fieldType: "boolean" },
    { key: "pointSamplingDistance", title: "点采样距离", description: "可见点采样距离（像素）。", fieldType: "number", min: 10, max: 1000, step: 1 },
    { key: "showFPSMonitor", title: "FPS 监视器", description: "是否显示性能监视器。", fieldType: "boolean" },
    { key: "spaceSize", title: "仿真空间大小", description: "仿真空间边长。", fieldType: "number", min: 256, max: 8192, step: 1 },
    { key: "rescalePositions", title: "重缩放坐标", description: "是否自动重缩放点位坐标。", fieldType: "boolean" },
];

/**
 * @function buildKnowledgeGraphConfig
 * @description 将知识图谱设置映射为 Graph 配置对象。
 * @param settings 知识图谱设置。
 * @returns Graph 配置。
 */
export function buildKnowledgeGraphConfig(settings: KnowledgeGraphSettings): GraphConfigInterface {
    return {
        ...settings,
    };
}
