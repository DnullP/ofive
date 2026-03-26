/**
 * @module host/conditions/conditionEvaluator
 * @description 条件评估子系统：统一定义条件上下文、条件注册表、内置条件与纯函数评估逻辑。
 * @dependencies 无
 *
 * @example
 *   const context = createConditionContext({
 *     focusedComponent: "tab:codemirror",
 *     activeTabId: "file:notes/demo.md",
 *   });
 *   const allowed = evaluateConditions(["editorFocused", "activeTabPresent"], context);
 */

/**
 * @type BuiltinShortcutCondition
 * @description 当前支持的内置快捷键条件标识。
 */
export type BuiltinShortcutCondition =
    | "editorFocused"
    | "fileTreeFocused"
    | "activeTabPresent"
    | "activeEditorPresent"
    | "vaultLoaded"
    | "overlayClosed";

/**
 * @type ShortcutCondition
 * @description 快捷键条件标识。
 *   支持内置条件与未来通过注册表扩展的 host / plugin 条件。
 */
export type ShortcutCondition = BuiltinShortcutCondition | string;

/**
 * @interface ConditionContext
 * @description 条件评估输入上下文。
 *   该上下文是对 host/store 与后端桥接状态的快照抽象，而非新的状态中心。
 */
export interface ConditionContext {
    /** 当前聚焦组件标识。 */
    focusedComponent: string;
    /** 当前活动标签页 id。 */
    activeTabId?: string | null;
    /** 是否存在活动标签页。 */
    hasActiveTab?: boolean;
    /** 当前活跃编辑器对应文章 id。 */
    activeEditorArticleId?: string | null;
    /** 是否存在活跃编辑器。 */
    hasActiveEditor?: boolean;
    /** 当前仓库路径。 */
    currentVaultPath?: string | null;
    /** 当前仓库是否已加载。 */
    hasCurrentVault?: boolean;
    /** overlay / modal 是否处于打开态。 */
    isOverlayOpen?: boolean;
}

/**
 * @interface ConditionDefinition
 * @description 单个条件定义。
 */
export interface ConditionDefinition {
    /** 条件 id。 */
    id: ShortcutCondition;
    /** 条件展示文案 i18n key。 */
    label: string;
    /** 评估函数。 */
    evaluate: (context: ConditionContext) => boolean;
}

/**
 * @constant SHORTCUT_CONDITION_LABELS
 * @description 条件标识到 i18n 键的映射。
 */
export const SHORTCUT_CONDITION_LABELS: Record<BuiltinShortcutCondition, string> = {
    editorFocused: "focusContext.editorFocused",
    fileTreeFocused: "focusContext.fileTreeFocused",
    activeTabPresent: "conditions.activeTabPresent",
    activeEditorPresent: "conditions.activeEditorPresent",
    vaultLoaded: "conditions.vaultLoaded",
    overlayClosed: "conditions.overlayClosed",
};

/**
 * @constant builtinConditionDefinitions
 * @description 当前内置条件定义列表。
 */
const builtinConditionDefinitions: ConditionDefinition[] = [
    {
        id: "editorFocused",
        label: SHORTCUT_CONDITION_LABELS.editorFocused,
        evaluate: (context) => context.focusedComponent === "tab:codemirror",
    },
    {
        id: "fileTreeFocused",
        label: SHORTCUT_CONDITION_LABELS.fileTreeFocused,
        evaluate: (context) => context.focusedComponent === "panel:files",
    },
    {
        id: "activeTabPresent",
        label: SHORTCUT_CONDITION_LABELS.activeTabPresent,
        evaluate: (context) => context.hasActiveTab === true,
    },
    {
        id: "activeEditorPresent",
        label: SHORTCUT_CONDITION_LABELS.activeEditorPresent,
        evaluate: (context) => context.hasActiveEditor === true,
    },
    {
        id: "vaultLoaded",
        label: SHORTCUT_CONDITION_LABELS.vaultLoaded,
        evaluate: (context) => context.hasCurrentVault === true,
    },
    {
        id: "overlayClosed",
        label: SHORTCUT_CONDITION_LABELS.overlayClosed,
        evaluate: (context) => context.isOverlayOpen === false,
    },
];

const conditionDefinitionMap = new Map<ShortcutCondition, ConditionDefinition>(
    builtinConditionDefinitions.map((definition) => [definition.id, definition]),
);

/**
 * @function getConditionDefinition
 * @description 获取单个条件定义。
 * @param condition 条件 id。
 * @returns 条件定义；未找到返回 undefined。
 */
export function getConditionDefinition(
    condition: ShortcutCondition,
): ConditionDefinition | undefined {
    return conditionDefinitionMap.get(condition);
}

/**
 * @function getConditionDefinitions
 * @description 获取当前已注册的条件定义列表。
 * @returns 条件定义数组。
 */
export function getConditionDefinitions(): ConditionDefinition[] {
    return Array.from(conditionDefinitionMap.values());
}

/**
 * @function registerConditionDefinition
 * @description 注册单个条件定义；若与内置条件重名则覆盖当前映射。
 * @param definition 条件定义。
 * @returns 取消注册函数。
 */
export function registerConditionDefinition(
    definition: ConditionDefinition,
): () => void {
    conditionDefinitionMap.set(definition.id, definition);

    return () => {
        unregisterConditionDefinition(definition.id);
    };
}

/**
 * @function unregisterConditionDefinition
 * @description 注销指定条件；若为内置条件则回退到内置定义。
 * @param condition 条件 id。
 */
export function unregisterConditionDefinition(
    condition: ShortcutCondition,
): void {
    const builtinDefinition = builtinConditionDefinitions.find((definition) => definition.id === condition);
    if (builtinDefinition) {
        conditionDefinitionMap.set(condition, builtinDefinition);
        return;
    }

    conditionDefinitionMap.delete(condition);
}

/**
 * @function createConditionContext
 * @description 构建条件上下文快照。
 * @param context 部分上下文输入。
 * @returns 规范化后的条件上下文。
 */
export function createConditionContext(
    context: ConditionContext,
): ConditionContext {
    const activeTabId = context.activeTabId ?? null;
    const activeEditorArticleId = context.activeEditorArticleId ?? null;
    const currentVaultPath = context.currentVaultPath ?? null;

    return {
        focusedComponent: context.focusedComponent ?? "other",
        activeTabId,
        hasActiveTab: context.hasActiveTab ?? Boolean(activeTabId),
        activeEditorArticleId,
        hasActiveEditor: context.hasActiveEditor ?? Boolean(activeEditorArticleId),
        currentVaultPath,
        hasCurrentVault: context.hasCurrentVault ?? Boolean(currentVaultPath && currentVaultPath.trim().length > 0),
        isOverlayOpen: context.isOverlayOpen ?? false,
    };
}

/**
 * @function evaluateCondition
 * @description 在给定上下文中评估单个条件是否满足。
 *   当前第一版仅接入焦点类条件，后续可逐步扩展到更多前后端派生状态。
 * @param condition 条件标识；undefined 表示无条件限制。
 * @param context 条件上下文快照。
 * @returns 条件满足返回 true。
 */
export function evaluateCondition(
    condition: ShortcutCondition | undefined,
    context: ConditionContext,
): boolean {
    if (!condition) {
        return true;
    }

    const definition = getConditionDefinition(condition);
    if (!definition) {
        return false;
    }

    return definition.evaluate(createConditionContext(context));
}

/**
 * @function evaluateConditions
 * @description 以 AND 语义评估多个条件。
 * @param conditions 条件列表；为空或 undefined 时视为无条件限制。
 * @param context 条件上下文快照。
 * @returns 所有条件满足时返回 true。
 */
export function evaluateConditions(
    conditions: readonly ShortcutCondition[] | undefined,
    context: ConditionContext,
): boolean {
    if (!conditions || conditions.length === 0) {
        return true;
    }

    const normalizedContext = createConditionContext(context);
    return conditions.every((condition) => evaluateCondition(condition, normalizedContext));
}

/**
 * @function getConditionLabel
 * @description 获取条件对应的 i18n 标签。
 * @param condition 条件 id。
 * @returns 标签 key；未找到时返回 null。
 */
export function getConditionLabel(
    condition: ShortcutCondition,
): string | null {
    return getConditionDefinition(condition)?.label ?? null;
}