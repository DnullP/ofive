/**
 * @module plugins/architecture-devtools/architectureRegistry
 * @description 架构元数据注册中心：聚合插件、模块、状态、事件与接口的
 *   架构描述，供架构可视化 DevTools 统一消费。
 *
 *   设计目标：
 *   - 支持内置模块与未来插件以 slice 形式增量注册架构信息。
 *   - 将“运行时 UI 注册”和“静态架构依赖”解耦，避免 DevTools 与具体模块硬编码。
 *   - 为后续高度插件化场景提供统一的架构声明协议。
 *
 * @dependencies
 *   - react (useSyncExternalStore)
 *
 * @example
 *   registerArchitectureSlice({
 *     id: "demo-plugin",
 *     title: "Demo Plugin",
 *     nodes: [
 *       {
 *         id: "plugin:demo",
 *         title: "demoPlugin",
 *         kind: "plugin",
 *         summary: "示例插件",
 *       },
 *     ],
 *     edges: [],
 *   });
 *
 * @exports
 *   - ArchitectureNodeKind
 *   - ArchitectureEdgeKind
 *   - ArchitectureNode
 *   - ArchitectureEdge
 *   - ArchitectureSlice
 *   - ArchitectureSnapshot
 *   - registerArchitectureSlice
 *   - unregisterArchitectureSlice
 *   - getArchitectureSnapshot
 *   - subscribeArchitecture
 *   - useArchitectureSnapshot
 */

import { useSyncExternalStore } from "react";

/**
 * @type ArchitectureNodeKind
 * @description 架构节点类别。
 */
export type ArchitectureNodeKind =
    | "plugin"
    | "ui-module"
    | "store"
    | "event"
    | "frontend-api"
    | "backend-api";

/**
 * @type ArchitectureModuleLayer
 * @description 界面模块的层级分类。
 */
export type ArchitectureModuleLayer = "infrastructure" | "plugin-logic";

/**
 * @type ArchitectureEdgeKind
 * @description 架构边类别，表示依赖关系的语义。
 */
export type ArchitectureEdgeKind =
    | "registers-ui"
    | "reads-state"
    | "writes-state"
    | "subscribes-event"
    | "emits-event"
    | "calls-api"
    | "bridges-event"
    | "persists-config";

/**
 * @interface ArchitectureNode
 * @description 架构图中的单个节点描述。
 * @field id - 节点唯一标识。
 * @field title - 节点标题。
 * @field kind - 节点类别。
 * @field summary - 节点摘要。
 * @field location - 对应源码位置。
 * @field details - 细项说明列表。
 */
export interface ArchitectureNode {
    /** 节点唯一标识 */
    id: string;
    /** 节点标题 */
    title: string;
    /** 节点类别 */
    kind: ArchitectureNodeKind;
    /** 节点摘要 */
    summary: string;
    /** 模块层级，仅 ui-module 使用 */
    moduleLayer?: ArchitectureModuleLayer;
    /** 源码位置 */
    location?: string;
    /** 细项说明 */
    details?: string[];
}

/**
 * @function compareModuleLayers
 * @description 为模块层级提供稳定排序。
 * @param left 左侧模块层级。
 * @param right 右侧模块层级。
 * @returns 排序比较值。
 */
function compareModuleLayers(
    left?: ArchitectureModuleLayer,
    right?: ArchitectureModuleLayer,
): number {
    const order: ArchitectureModuleLayer[] = ["infrastructure", "plugin-logic"];
    return order.indexOf(left ?? "infrastructure") - order.indexOf(right ?? "infrastructure");
}

/**
 * @interface ArchitectureEdge
 * @description 架构图中的单条依赖边。
 * @field from - 依赖发起方节点 ID。
 * @field to - 被依赖节点 ID。
 * @field kind - 依赖语义。
 * @field label - 简短标签。
 */
export interface ArchitectureEdge {
    /** 依赖发起方 */
    from: string;
    /** 被依赖方 */
    to: string;
    /** 依赖语义 */
    kind: ArchitectureEdgeKind;
    /** 边标签 */
    label?: string;
}

/**
 * @interface ArchitectureSlice
 * @description 一组可独立注册的架构元数据切片。
 * @field id - 切片唯一标识。
 * @field title - 切片标题。
 * @field nodes - 节点集合。
 * @field edges - 边集合。
 */
export interface ArchitectureSlice {
    /** 切片唯一标识 */
    id: string;
    /** 切片标题 */
    title: string;
    /** 节点集合 */
    nodes: ArchitectureNode[];
    /** 边集合 */
    edges: ArchitectureEdge[];
}

/**
 * @interface ArchitectureSnapshot
 * @description 注册中心聚合后的完整快照。
 * @field slices - 当前已注册切片。
 * @field nodes - 去重后的节点。
 * @field edges - 去重后的边。
 */
export interface ArchitectureSnapshot {
    /** 当前已注册切片 */
    slices: ArchitectureSlice[];
    /** 聚合节点 */
    nodes: ArchitectureNode[];
    /** 聚合边 */
    edges: ArchitectureEdge[];
}

const slices = new Map<string, ArchitectureSlice>();
const listeners = new Set<() => void>();

let cachedSnapshot: ArchitectureSnapshot = {
    slices: [],
    nodes: [],
    edges: [],
};

/**
 * @function compareNodeKinds
 * @description 为节点类别提供稳定排序。
 * @param left 左侧类别。
 * @param right 右侧类别。
 * @returns 排序比较值。
 */
function compareNodeKinds(
    left: ArchitectureNodeKind,
    right: ArchitectureNodeKind,
): number {
    const order: ArchitectureNodeKind[] = [
        "plugin",
        "ui-module",
        "store",
        "event",
        "frontend-api",
        "backend-api",
    ];

    return order.indexOf(left) - order.indexOf(right);
}

/**
 * @function emit
 * @description 重建缓存快照并广播变化。
 */
function emit(): void {
    const nodeMap = new Map<string, ArchitectureNode>();
    const edgeMap = new Map<string, ArchitectureEdge>();

    const nextSlices = Array.from(slices.values()).sort((left, right) => {
        return left.title.localeCompare(right.title);
    });

    nextSlices.forEach((slice) => {
        slice.nodes.forEach((node) => {
            nodeMap.set(node.id, node);
        });
        slice.edges.forEach((edge) => {
            const edgeId = `${edge.from}->${edge.to}:${edge.kind}:${edge.label ?? ""}`;
            edgeMap.set(edgeId, edge);
        });
    });

    cachedSnapshot = {
        slices: nextSlices,
        nodes: Array.from(nodeMap.values()).sort((left, right) => {
            const kindDelta = compareNodeKinds(left.kind, right.kind);
            if (kindDelta !== 0) {
                return kindDelta;
            }

            if (left.kind === "ui-module" && right.kind === "ui-module") {
                const layerDelta = compareModuleLayers(left.moduleLayer, right.moduleLayer);
                if (layerDelta !== 0) {
                    return layerDelta;
                }
            }

            return left.title.localeCompare(right.title);
        }),
        edges: Array.from(edgeMap.values()).sort((left, right) => {
            const fromDelta = left.from.localeCompare(right.from);
            if (fromDelta !== 0) {
                return fromDelta;
            }
            const toDelta = left.to.localeCompare(right.to);
            if (toDelta !== 0) {
                return toDelta;
            }
            return left.kind.localeCompare(right.kind);
        }),
    };

    listeners.forEach((listener) => listener());
}

/**
 * @function registerArchitectureSlice
 * @description 注册一组架构元数据。
 * @param slice 架构切片。
 * @returns 取消注册函数。
 */
export function registerArchitectureSlice(slice: ArchitectureSlice): () => void {
    slices.set(slice.id, slice);
    console.info("[architectureRegistry] registered slice", {
        id: slice.id,
        nodes: slice.nodes.length,
        edges: slice.edges.length,
    });
    emit();

    return () => {
        unregisterArchitectureSlice(slice.id);
    };
}

/**
 * @function unregisterArchitectureSlice
 * @description 注销指定架构切片。
 * @param id 切片 ID。
 */
export function unregisterArchitectureSlice(id: string): void {
    if (!slices.has(id)) {
        return;
    }

    slices.delete(id);
    console.info("[architectureRegistry] unregistered slice", { id });
    emit();
}

/**
 * @function getArchitectureSnapshot
 * @description 获取当前聚合后的架构快照。
 * @returns 架构快照。
 */
export function getArchitectureSnapshot(): ArchitectureSnapshot {
    return cachedSnapshot;
}

/**
 * @function subscribeArchitecture
 * @description 订阅架构注册中心变化。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeArchitecture(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * @function useArchitectureSnapshot
 * @description React Hook：订阅并返回当前架构快照。
 * @returns 当前架构快照。
 */
export function useArchitectureSnapshot(): ArchitectureSnapshot {
    return useSyncExternalStore(
        (listener) => subscribeArchitecture(listener),
        () => getArchitectureSnapshot(),
        () => getArchitectureSnapshot(),
    );
}