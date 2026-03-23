/**
 * @module host/layout/vaultTabScope
 * @description 统一管理主区域 Tab 在仓库切换时的生命周期策略。
 *
 *   该模块解决两个问题：
 *   1. Tab 打开时，将组件 ID 与生命周期作用域固化进 params，避免后续仅凭运行时实例难以判断其归属。
 *   2. 仓库切换时，用稳定规则识别哪些 Tab 应随旧仓库一起失效。
 *
 * @dependencies
 *   - ../registry/tabComponentRegistry
 *
 * @example
 *   const nextParams = decorateTabParamsWithLifecycle({
 *       componentId: "codemirror",
 *       lifecycleScope: "vault",
 *       params: { path: "notes/demo.md" },
 *   });
 *
 *   const shouldClose = shouldCloseTabOnVaultChange({
 *       panelId: "file:notes/demo.md",
 *       panelParams: nextParams,
 *   });
 */

import type { TabLifecycleScope } from "../registry/tabComponentRegistry";

/**
 * @constant TAB_COMPONENT_ID_PARAM
 * @description 注入到 Tab params 中的组件 ID 元数据键。
 */
export const TAB_COMPONENT_ID_PARAM = "__hostTabComponentId";

/**
 * @constant TAB_LIFECYCLE_SCOPE_PARAM
 * @description 注入到 Tab params 中的生命周期作用域元数据键。
 */
export const TAB_LIFECYCLE_SCOPE_PARAM = "__hostTabLifecycleScope";

/**
 * @interface DecorateTabParamsInput
 * @description 为 Tab params 注入生命周期元数据时所需的输入。
 */
interface DecorateTabParamsInput {
    /** Tab 组件 ID。 */
    componentId: string;
    /** 生命周期作用域。 */
    lifecycleScope: TabLifecycleScope;
    /** 原始 params。 */
    params?: Record<string, unknown>;
}

/**
 * @interface VaultChangePanelInput
 * @description 仓库切换时用于判断单个 Tab 是否应关闭的输入。
 */
interface VaultChangePanelInput {
    /** Dockview panel ID。 */
    panelId: string;
    /** Panel 当前 params。 */
    panelParams?: Record<string, unknown>;
}

/**
 * @function isTabLifecycleScope
 * @description 判断一个未知值是否为支持的 Tab 生命周期作用域。
 * @param value 待判断值。
 * @returns 若为合法作用域则返回 true。
 */
function isTabLifecycleScope(value: unknown): value is TabLifecycleScope {
    return value === "global" || value === "vault";
}

/**
 * @function decorateTabParamsWithLifecycle
 * @description 将组件 ID 与生命周期作用域写入 Tab params。
 * @param input 装饰所需输入。
 * @returns 带有生命周期元数据的新 params 对象。
 */
export function decorateTabParamsWithLifecycle(input: DecorateTabParamsInput): Record<string, unknown> {
    return {
        ...(input.params ?? {}),
        [TAB_COMPONENT_ID_PARAM]: input.componentId,
        [TAB_LIFECYCLE_SCOPE_PARAM]: input.lifecycleScope,
    };
}

/**
 * @function resolveTabLifecycleScopeForVaultChange
 * @description 解析指定 Tab 在仓库切换时的生命周期作用域。
 * @param input 当前 panel 快照。
 * @returns 生命周期作用域。
 */
export function resolveTabLifecycleScopeForVaultChange(
    input: VaultChangePanelInput,
): TabLifecycleScope {
    const scopedValue = input.panelParams?.[TAB_LIFECYCLE_SCOPE_PARAM];
    if (isTabLifecycleScope(scopedValue)) {
        return scopedValue;
    }

    if (input.panelId.startsWith("file:")) {
        return "vault";
    }

    return "global";
}

/**
 * @function shouldCloseTabOnVaultChange
 * @description 判断一个主区 Tab 是否应在仓库切换后关闭。
 * @param input 当前 panel 快照。
 * @returns true 表示应关闭当前 Tab。
 */
export function shouldCloseTabOnVaultChange(input: VaultChangePanelInput): boolean {
    return resolveTabLifecycleScopeForVaultChange(input) === "vault";
}