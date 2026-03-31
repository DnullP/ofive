/**
 * @module host/store/storeRegistry
 * @description 前端状态注册中心：统一治理 host 与 plugin 侧 store 的元数据、订阅接口与可选贡献能力。
 *   该模块的职责是把“前端状态”收敛到统一枢纽，而不是把 store 缩成某个单一实现。
 *   各 store 仍可保留自己的内部结构，只需在此注册快照、订阅接口及可选 contribution。
 *
 * @dependencies
 *  - react
 *
 * @usage
 * ```ts
 * registerManagedStore({
 *   id: "theme",
 *   title: "Theme Store",
 *   ownerType: "host",
 *   scope: "frontend-local",
 *   getSnapshot: () => getThemeStateSnapshot(),
 *   subscribe: (listener) => subscribeThemeState(listener),
 *   contributions: [
 *     {
 *       kind: "settings",
 *       activate: () => registerThemeSettingsSection(),
 *     },
 *   ],
 * })
 * ```
 *
 * @exports
 *  - ManagedStoreDescriptor
 *  - ManagedStoreContribution
 *  - ManagedStoreSchema
 *  - ManagedStoreSnapshot
 *  - PluginOwnedStoreDescriptor
 *  - registerManagedStore
 *  - registerPluginOwnedStore
 *  - enableManagedStoreContributions
 *  - enableManagedStoreSettings
 *  - getManagedStoresSnapshot
 *  - useManagedStores
 *  - __resetManagedStoreRegistryForTests
 */

import { useSyncExternalStore } from "react";

/**
 * @type ManagedStoreScope
 * @description store 持久化/作用域分类。
 */
export type ManagedStoreScope =
    | "frontend-local"
    | "vault-config"
    | "plugin-private"
    | "backend-service";

/**
 * @type ManagedStoreOwnerType
 * @description store 所有权来源。
 */
export type ManagedStoreOwnerType = "host" | "plugin";

/**
 * @type ManagedStoreContributionKind
 * @description store 可向 host 贡献的能力类型。
 */
export type ManagedStoreContributionKind = "settings";

/**
 * @type ManagedStoreFieldValueType
 * @description store 状态字段值类型。
 */
export type ManagedStoreFieldValueType =
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "record"
    | "union";

/**
 * @interface ManagedStoreStateFieldSchema
 * @description store 状态字段 schema。
 */
export interface ManagedStoreStateFieldSchema {
    /** 字段名 */
    name: string;
    /** 字段说明 */
    description: string;
    /** 值类型 */
    valueType: ManagedStoreFieldValueType;
    /** 初始值摘要 */
    initialValue: string;
    /** 是否为派生字段 */
    derived?: boolean;
    /** 是否持久化 */
    persisted?: boolean;
    /** 可枚举取值 */
    allowedValues?: string[];
    /** 数值范围 */
    range?: {
        min: number;
        max: number;
        step?: number;
    };
    /** 额外约束 */
    constraints?: string[];
}

/**
 * @interface ManagedStoreActionSchema
 * @description store 对外动作 schema。
 */
export interface ManagedStoreActionSchema {
    /** 动作 id */
    id: string;
    /** 动作说明 */
    description: string;
    /** 该动作会更新哪些字段 */
    updates: string[];
    /** 该动作的副作用 */
    sideEffects?: string[];
}

/**
 * @interface ManagedStoreStateSchema
 * @description store 状态 schema。
 */
export interface ManagedStoreStateSchema {
    /** 状态字段定义 */
    fields: ManagedStoreStateFieldSchema[];
    /** 不变量 */
    invariants: string[];
    /** 对外动作 */
    actions: ManagedStoreActionSchema[];
}

/**
 * @interface ManagedStoreValueSpaceFlowSchema
 * @description 值域型状态流 schema，适用于 theme 等简单状态切换 store。
 */
export interface ManagedStoreValueSpaceFlowSchema {
    kind: "value-space";
    /** 流转说明 */
    description: string;
    /** 合法值域/状态空间摘要 */
    stateSpace: string[];
    /** 更新触发来源 */
    updateTriggers: string[];
    /** 失败或兜底处理路径 */
    failureModes: string[];
}

/**
 * @interface ManagedStoreStateNodeSchema
 * @description 状态机节点 schema。
 */
export interface ManagedStoreStateNodeSchema {
    /** 节点 id */
    id: string;
    /** 节点说明 */
    description: string;
}

/**
 * @interface ManagedStoreTransitionSchema
 * @description 状态机流转定义。
 */
export interface ManagedStoreTransitionSchema {
    /** 触发事件 */
    event: string;
    /** 源状态 */
    from: string[];
    /** 目标状态 */
    to: string;
    /** 流转说明 */
    description: string;
    /** 流转副作用 */
    sideEffects?: string[];
}

/**
 * @interface ManagedStoreStateMachineFlowSchema
 * @description 状态机型状态流 schema，适用于加载/保存/失败回滚等复杂 store。
 */
export interface ManagedStoreStateMachineFlowSchema {
    kind: "state-machine";
    /** 流转说明 */
    description: string;
    /** 初始状态 */
    initialState: string;
    /** 状态节点 */
    states: ManagedStoreStateNodeSchema[];
    /** 状态迁移 */
    transitions: ManagedStoreTransitionSchema[];
    /** 失败或兜底处理路径 */
    failureModes: string[];
}

/**
 * @type ManagedStoreFlowSchema
 * @description store 状态流 schema。
 */
export type ManagedStoreFlowSchema =
    | ManagedStoreValueSpaceFlowSchema
    | ManagedStoreStateMachineFlowSchema;

/**
 * @interface ManagedStoreSchema
 * @description store 治理 schema：强制声明状态字段、动作与流转模型。
 */
export interface ManagedStoreSchema {
    /** store 摘要说明 */
    summary: string;
    /** 状态 schema */
    state: ManagedStoreStateSchema;
    /** 状态流 schema */
    flow: ManagedStoreFlowSchema;
}

/**
 * @interface ManagedStoreContribution
 * @description store 对 host 层的可选贡献定义。
 */
export interface ManagedStoreContribution {
    /** 贡献类型 */
    kind: ManagedStoreContributionKind;
    /** 激活贡献，并返回可选清理函数 */
    activate: () => void | (() => void);
}

/**
 * @interface ManagedStoreDescriptor
 * @description store 注册定义。
 */
export interface ManagedStoreDescriptor<TSnapshot = unknown> {
    /** store 唯一标识 */
    id: string;
    /** store 名称 */
    title: string;
    /** store 说明 */
    description?: string;
    /** store 所有权来源 */
    ownerType: ManagedStoreOwnerType;
    /** host store 时可为空；plugin store 时建议填对应 plugin id */
    ownerId?: string;
    /** store 作用域 */
    scope: ManagedStoreScope;
    /** 领域标签 */
    tags?: string[];
    /** store 治理 schema */
    schema: ManagedStoreSchema;
    /** 非响应式读取快照 */
    getSnapshot: () => TSnapshot;
    /** 订阅快照变化 */
    subscribe: (listener: () => void) => () => void;
    /** 可选 contribution 列表 */
    contributions?: ManagedStoreContribution[];
}

/**
 * @interface PluginOwnedStoreDescriptor
 * @description 插件拥有的 store 注册定义。
 *   pluginId 由 helper 外部提供；storeId 为插件内部局部标识，最终会组合成全局 store id。
 */
export interface PluginOwnedStoreDescriptor<TSnapshot = unknown>
    extends Omit<ManagedStoreDescriptor<TSnapshot>, "id" | "ownerType" | "ownerId"> {
    /** 插件内部局部 store 标识 */
    storeId: string;
}

/**
 * @interface ManagedStoreSnapshot
 * @description UI 和治理层消费的 store 描述快照。
 */
export interface ManagedStoreSnapshot {
    id: string;
    title: string;
    description?: string;
    ownerType: ManagedStoreOwnerType;
    ownerId?: string;
    scope: ManagedStoreScope;
    tags: string[];
    contributionKinds: ManagedStoreContributionKind[];
    schema: ManagedStoreSchema;
}

const storesMap = new Map<string, ManagedStoreDescriptor>();
const contributionDisposers = new Map<string, () => void>();
const enabledContributionKinds = new Set<ManagedStoreContributionKind>();
const listeners = new Set<() => void>();
let cachedSnapshot: ManagedStoreSnapshot[] = [];

/**
 * @function buildContributionKey
 * @description 生成 store contribution 的稳定键。
 * @param storeId store id。
 * @param kind contribution 类型。
 * @returns 唯一键。
 */
function buildContributionKey(storeId: string, kind: ManagedStoreContributionKind): string {
    return `${storeId}:${kind}`;
}

/**
 * @function sortSnapshots
 * @description 对 store 快照进行稳定排序。
 * @param snapshots store 快照数组。
 * @returns 排序后的快照。
 */
function sortSnapshots(snapshots: ManagedStoreSnapshot[]): ManagedStoreSnapshot[] {
    return [...snapshots].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * @function rebuildSnapshot
 * @description 重建快照缓存。
 */
function rebuildSnapshot(): void {
    cachedSnapshot = sortSnapshots(
        Array.from(storesMap.values()).map((store) => ({
            id: store.id,
            title: store.title,
            description: store.description,
            ownerType: store.ownerType,
            ownerId: store.ownerId,
            scope: store.scope,
            tags: [...(store.tags ?? [])],
            contributionKinds: (store.contributions ?? []).map((contribution) => contribution.kind),
            schema: store.schema,
        })),
    );
}

/**
 * @function assertNonEmptyStrings
 * @description 校验字符串数组非空且不含空白项。
 * @param values 值数组。
 * @param label 校验标签。
 */
function assertNonEmptyStrings(values: string[], label: string): void {
    if (!Array.isArray(values) || values.length === 0) {
        throw new Error(`[store-registry] ${label} must contain at least one item`);
    }

    values.forEach((value, index) => {
        if (typeof value !== "string" || value.trim().length === 0) {
            throw new Error(`[store-registry] ${label}[${String(index)}] must be a non-empty string`);
        }
    });
}

/**
 * @function assertManagedStoreSchema
 * @description 在运行时校验注册 store 的 schema 是否完整。
 * @param storeId store id。
 * @param schema store schema。
 */
function assertManagedStoreSchema(storeId: string, schema: ManagedStoreSchema): void {
    if (!schema || typeof schema !== "object") {
        throw new Error(`[store-registry] ${storeId} schema.summary is required`);
    }

    if (typeof schema.summary !== "string" || schema.summary.trim().length === 0) {
        throw new Error(`[store-registry] ${storeId} schema.summary is required`);
    }

    if (!Array.isArray(schema.state.fields) || schema.state.fields.length === 0) {
        throw new Error(`[store-registry] ${storeId} schema.state.fields is required`);
    }

    const fieldNames = new Set<string>();
    schema.state.fields.forEach((field) => {
        if (fieldNames.has(field.name)) {
            throw new Error(`[store-registry] ${storeId} has duplicate schema field: ${field.name}`);
        }
        fieldNames.add(field.name);

        if (typeof field.name !== "string" || field.name.trim().length === 0) {
            throw new Error(`[store-registry] ${storeId} field.name is required`);
        }
        if (typeof field.description !== "string" || field.description.trim().length === 0) {
            throw new Error(`[store-registry] ${storeId} field.description is required: ${field.name}`);
        }
        if (typeof field.initialValue !== "string" || field.initialValue.trim().length === 0) {
            throw new Error(`[store-registry] ${storeId} field.initialValue is required: ${field.name}`);
        }
        if (field.allowedValues) {
            assertNonEmptyStrings(field.allowedValues, `${storeId}.${field.name}.allowedValues`);
        }
        if (field.range && field.valueType !== "number") {
            throw new Error(`[store-registry] ${storeId} field.range only applies to number fields: ${field.name}`);
        }
    });

    assertNonEmptyStrings(schema.state.invariants, `${storeId}.schema.state.invariants`);

    if (!Array.isArray(schema.state.actions) || schema.state.actions.length === 0) {
        throw new Error(`[store-registry] ${storeId} schema.state.actions is required`);
    }

    const actionIds = new Set<string>();
    schema.state.actions.forEach((action) => {
        if (actionIds.has(action.id)) {
            throw new Error(`[store-registry] ${storeId} has duplicate action id: ${action.id}`);
        }
        actionIds.add(action.id);

        if (typeof action.id !== "string" || action.id.trim().length === 0) {
            throw new Error(`[store-registry] ${storeId} action.id is required`);
        }
        if (typeof action.description !== "string" || action.description.trim().length === 0) {
            throw new Error(`[store-registry] ${storeId} action.description is required: ${action.id}`);
        }

        if (!Array.isArray(action.updates)) {
            throw new Error(`[store-registry] ${storeId} action.updates must be an array: ${action.id}`);
        }

        const sideEffects = action.sideEffects ?? [];
        if (action.updates.length === 0 && sideEffects.length === 0) {
            throw new Error(`[store-registry] ${storeId} action must declare updates or sideEffects: ${action.id}`);
        }

        action.updates.forEach((fieldName) => {
            if (!fieldNames.has(fieldName)) {
                throw new Error(`[store-registry] ${storeId} action references unknown field ${fieldName}: ${action.id}`);
            }
        });

        if (sideEffects.length > 0) {
            assertNonEmptyStrings(sideEffects, `${storeId}.${action.id}.sideEffects`);
        }
    });

    if (schema.flow.kind === "value-space") {
        if (typeof schema.flow.description !== "string" || schema.flow.description.trim().length === 0) {
            throw new Error(`[store-registry] ${storeId} flow.description is required`);
        }
        assertNonEmptyStrings(schema.flow.stateSpace, `${storeId}.schema.flow.stateSpace`);
        assertNonEmptyStrings(schema.flow.updateTriggers, `${storeId}.schema.flow.updateTriggers`);
        assertNonEmptyStrings(schema.flow.failureModes, `${storeId}.schema.flow.failureModes`);
        return;
    }

    if (typeof schema.flow.description !== "string" || schema.flow.description.trim().length === 0) {
        throw new Error(`[store-registry] ${storeId} flow.description is required`);
    }
    if (!Array.isArray(schema.flow.states) || schema.flow.states.length === 0) {
        throw new Error(`[store-registry] ${storeId} state-machine flow.states is required`);
    }
    if (!Array.isArray(schema.flow.transitions) || schema.flow.transitions.length === 0) {
        throw new Error(`[store-registry] ${storeId} state-machine flow.transitions is required`);
    }
    assertNonEmptyStrings(schema.flow.failureModes, `${storeId}.schema.flow.failureModes`);

    const stateIds = new Set(schema.flow.states.map((state) => state.id));
    if (!stateIds.has(schema.flow.initialState)) {
        throw new Error(`[store-registry] ${storeId} flow.initialState must exist in flow.states`);
    }

    schema.flow.transitions.forEach((transition, index) => {
        if (typeof transition.event !== "string" || transition.event.trim().length === 0) {
            throw new Error(`[store-registry] ${storeId} transition.event is required at index ${String(index)}`);
        }
        assertNonEmptyStrings(transition.from, `${storeId}.transition.from.${String(index)}`);
        transition.from.forEach((stateId) => {
            if (!stateIds.has(stateId)) {
                throw new Error(`[store-registry] ${storeId} transition.from references unknown state ${stateId}`);
            }
        });
        if (!stateIds.has(transition.to)) {
            throw new Error(`[store-registry] ${storeId} transition.to references unknown state ${transition.to}`);
        }
        if (typeof transition.description !== "string" || transition.description.trim().length === 0) {
            throw new Error(`[store-registry] ${storeId} transition.description is required: ${transition.event}`);
        }
        if (transition.sideEffects && transition.sideEffects.length > 0) {
            assertNonEmptyStrings(transition.sideEffects, `${storeId}.transition.sideEffects.${transition.event}`);
        }
    });
}

/**
 * @function emit
 * @description 广播 store registry 变化。
 */
function emit(): void {
    rebuildSnapshot();
    listeners.forEach((listener) => listener());
}

/**
 * @function activateStoreContribution
 * @description 为单个 store 激活指定类型的 contribution。
 * @param store store 描述。
 * @param kind contribution 类型。
 */
function activateStoreContribution(
    store: ManagedStoreDescriptor,
    kind: ManagedStoreContributionKind,
): void {
    if (!enabledContributionKinds.has(kind)) {
        return;
    }

    const contribution = (store.contributions ?? []).find((item) => item.kind === kind);
    if (!contribution) {
        return;
    }

    const contributionKey = buildContributionKey(store.id, kind);
    const previousDispose = contributionDisposers.get(contributionKey);
    if (previousDispose) {
        previousDispose();
        contributionDisposers.delete(contributionKey);
    }

    const dispose = contribution.activate();
    if (typeof dispose === "function") {
        contributionDisposers.set(contributionKey, dispose);
    }
}

/**
 * @function deactivateStoreContribution
 * @description 释放单个 store 的指定类型 contribution。
 * @param storeId store id。
 * @param kind contribution 类型。
 */
function deactivateStoreContribution(
    storeId: string,
    kind: ManagedStoreContributionKind,
): void {
    const contributionKey = buildContributionKey(storeId, kind);
    const dispose = contributionDisposers.get(contributionKey);
    if (!dispose) {
        return;
    }

    dispose();
    contributionDisposers.delete(contributionKey);
}

/**
 * @function deactivateStoreContributions
 * @description 释放单个 store 的全部 contribution。
 * @param storeId store id。
 */
function deactivateStoreContributions(storeId: string): void {
    Array.from(enabledContributionKinds).forEach((kind) => {
        deactivateStoreContribution(storeId, kind);
    });
}

/**
 * @function registerManagedStore
 * @description 注册受治理的 store。
 * @param store store 注册定义。
 * @returns 取消注册函数。
 */
export function registerManagedStore(store: ManagedStoreDescriptor): () => void {
    assertManagedStoreSchema(store.id, store.schema);

    if (storesMap.has(store.id)) {
        deactivateStoreContributions(store.id);
    }

    storesMap.set(store.id, store);
    Array.from(enabledContributionKinds).forEach((kind) => {
        activateStoreContribution(store, kind);
    });
    emit();

    return () => {
        if (!storesMap.has(store.id)) {
            return;
        }

        deactivateStoreContributions(store.id);
        storesMap.delete(store.id);
        emit();
    };
}

/**
 * @function registerPluginOwnedStore
 * @description 注册插件拥有的 store，并自动补全 owner 元数据与全局唯一 id。
 * @param pluginId 插件 id。
 * @param store 插件 store 注册定义。
 * @returns 取消注册函数。
 */
export function registerPluginOwnedStore<TSnapshot = unknown>(
    pluginId: string,
    store: PluginOwnedStoreDescriptor<TSnapshot>,
): () => void {
    return registerManagedStore({
        ...store,
        id: `${pluginId}:${store.storeId}`,
        ownerType: "plugin",
        ownerId: pluginId,
    });
}

/**
 * @function enableManagedStoreContributions
 * @description 启用指定类型的 contribution，并为当前已注册 store 批量激活。
 * @param kind contribution 类型。
 */
export function enableManagedStoreContributions(kind: ManagedStoreContributionKind): void {
    if (enabledContributionKinds.has(kind)) {
        return;
    }

    enabledContributionKinds.add(kind);
    storesMap.forEach((store) => {
        activateStoreContribution(store, kind);
    });
}

/**
 * @function enableManagedStoreSettings
 * @description 兼容层：启用 settings contribution。
 */
export function enableManagedStoreSettings(): void {
    enableManagedStoreContributions("settings");
}

/**
 * @function getManagedStoresSnapshot
 * @description 获取 store registry 快照。
 * @returns store 快照数组。
 */
export function getManagedStoresSnapshot(): ManagedStoreSnapshot[] {
    return cachedSnapshot;
}

/**
 * @function subscribeManagedStores
 * @description 订阅 store registry 变化。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeManagedStores(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * @function useManagedStores
 * @description React Hook：订阅并返回当前 store registry 快照。
 * @returns store 快照数组。
 */
export function useManagedStores(): ManagedStoreSnapshot[] {
    return useSyncExternalStore(
        (listener) => subscribeManagedStores(listener),
        () => getManagedStoresSnapshot(),
        () => getManagedStoresSnapshot(),
    );
}

/**
 * @function __resetManagedStoreRegistryForTests
 * @description 仅供测试使用：清空已注册的 store 与已激活 contribution。
 */
export function __resetManagedStoreRegistryForTests(): void {
    Array.from(contributionDisposers.values()).forEach((dispose) => {
        dispose();
    });
    storesMap.clear();
    contributionDisposers.clear();
    enabledContributionKinds.clear();
    listeners.clear();
    cachedSnapshot = [];
}