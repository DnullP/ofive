/**
 * @module commands/focusContext
 * @description 焦点上下文模块：基于 dockview 布局层级提供通用的组件焦点检测与快捷键条件匹配。
 *
 *   系统中存在两类 dockview 容器：
 *     - **侧栏面板（Panel）**：由 PaneviewReact 管理，容器标记 `data-panel-id`
 *     - **主区标签（Tab）**：由 DockviewReact 管理，容器标记 `data-tab-component`
 *
 *   焦点检测通过 DOM `closest()` 查找最近的标记容器，生成结构化标识字符串：
 *     - `"panel:<panelId>"` — 侧栏面板聚焦（如 `"panel:files"`）
 *     - `"tab:<component>"` — 主区标签聚焦（如 `"tab:codemirror"`）
 *     - `"other"` — 未匹配任何容器
 *
 *   快捷键条件（ShortcutCondition）通过映射表关联到 FocusedComponent 标识，
 *   新增面板/标签类型只需在 CONDITION_FOCUSED_COMPONENT_MAP 中添加映射。
 *
 * @dependencies 无
 *
 * @state
 *   - currentFocusedComponent (string) ["other"] — 当前聚焦组件标识
 *
 * @lifecycle
 *   - 初始化时机：DockviewLayout 挂载时调用 initFocusTracking()
 *   - 数据来源：全局 focusin 事件驱动，DOM 属性检测
 *   - 更新触发：任何元素获得焦点
 *   - 清理时机：DockviewLayout 卸载时调用返回的清理函数
 *
 * 导出：
 *  - ShortcutCondition 类型 — 快捷键触发条件标识
 *  - FocusedComponent 类型 — 当前聚焦组件标识字符串
 *  - SHORTCUT_CONDITION_LABELS 常量 — 条件到可读标签的映射
 *  - PANEL_ID_DATA_ATTR / TAB_COMPONENT_DATA_ATTR — 容器标记属性名
 *  - detectFocusedComponentFromElement 函数 — 从 DOM 元素检测聚焦组件
 *  - detectFocusedComponentFromEvent 函数 — 从键盘事件检测聚焦组件
 *  - isConditionSatisfied 函数 — 判断条件是否在给定焦点上下文中满足
 *  - getCurrentFocusedComponent 函数 — 获取当前聚焦组件
 *  - initFocusTracking 函数 — 初始化焦点追踪与日志
 */

/**
 * @type ShortcutCondition
 * @description 快捷键触发条件标识。
 *   当命令定义中携带该条件时，仅当对应组件聚焦时快捷键才会激活该命令。
 *   设计为可扩展的联合类型，后续新增条件只需在此添加新值并更新 CONDITION_FOCUSED_COMPONENT_MAP。
 */
export type ShortcutCondition = "editorFocused" | "fileTreeFocused";

/**
 * @type FocusedComponent
 * @description 当前聚焦的组件标识字符串。
 *   格式为 `"panel:<panelId>"` | `"tab:<component>"` | `"other"`。
 *   与具体面板/标签无关，由 DOM 属性动态确定。
 */
export type FocusedComponent = string;

/**
 * @constant SHORTCUT_CONDITION_LABELS
 * @description 条件标识到人类可读标签的映射，用于设置 UI 展示。
 */
export const SHORTCUT_CONDITION_LABELS: Record<ShortcutCondition, string> = {
    /* 编辑器标签聚焦时激活 */
    editorFocused: "focusContext.editorFocused",
    /* 文件树面板聚焦时激活 */
    fileTreeFocused: "focusContext.fileTreeFocused",
};

/**
 * @constant CONDITION_FOCUSED_COMPONENT_MAP
 * @description 快捷键条件到 FocusedComponent 标识的映射。
 *   新增条件或面板类型时，在此添加对应的映射条目即可。
 */
const CONDITION_FOCUSED_COMPONENT_MAP: Record<ShortcutCondition, string> = {
    /* 编辑器标签 → tab:codemirror */
    editorFocused: "tab:codemirror",
    /* 文件树面板 → panel:files */
    fileTreeFocused: "panel:files",
};

/**
 * @constant PANEL_ID_DATA_ATTR
 * @description 侧栏面板容器的 data 属性名（放在 pane-panel-content 外层）。
 *   值为面板 id，如 "files"、"outline"。
 */
export const PANEL_ID_DATA_ATTR = "data-panel-id";

/**
 * @constant TAB_COMPONENT_DATA_ATTR
 * @description 主区标签容器的 data 属性名（放在 tab 组件外层）。
 *   值为 component key，如 "codemirror"、"settings"。
 */
export const TAB_COMPONENT_DATA_ATTR = "data-tab-component";

/** data-panel-id 选择器 */
const PANEL_ID_SELECTOR = `[${PANEL_ID_DATA_ATTR}]`;

/** data-tab-component 选择器 */
const TAB_COMPONENT_SELECTOR = `[${TAB_COMPONENT_DATA_ATTR}]`;

/**
 * @function detectFocusedComponentFromElement
 * @description 根据 DOM 元素，通过向上查找最近的标记容器确定其所属组件。
 *   优先级：tab:* > panel:* > other。
 *   检测逻辑完全基于 dockview 布局的 data 属性，不依赖具体组件 CSS 类名。
 * @param element DOM 元素。
 * @returns 聚焦组件标识字符串。
 */
export function detectFocusedComponentFromElement(element: HTMLElement | null): FocusedComponent {
    if (!element) {
        return "other";
    }

    // 优先检测主区标签（tab 容器嵌套在 panel 容器之上，优先级更高）
    const tabContainer = element.closest(TAB_COMPONENT_SELECTOR) as HTMLElement | null;
    if (tabContainer) {
        const component = tabContainer.getAttribute(TAB_COMPONENT_DATA_ATTR);
        if (component) {
            return `tab:${component}`;
        }
    }

    // 检测侧栏面板
    const panelContainer = element.closest(PANEL_ID_SELECTOR) as HTMLElement | null;
    if (panelContainer) {
        const panelId = panelContainer.getAttribute(PANEL_ID_DATA_ATTR);
        if (panelId) {
            return `panel:${panelId}`;
        }
    }

    return "other";
}

/**
 * @function detectFocusedComponentFromEvent
 * @description 根据键盘事件的目标元素检测当前聚焦的组件。
 * @param event 键盘事件。
 * @returns 聚焦组件标识字符串。
 */
export function detectFocusedComponentFromEvent(event: KeyboardEvent): FocusedComponent {
    return detectFocusedComponentFromElement(event.target as HTMLElement | null);
}

/**
 * @function isConditionSatisfied
 * @description 判断指定的快捷键条件是否在给定焦点上下文中满足。
 *   当 condition 为 undefined（无条件）时始终返回 true，表示全局命令。
 *   匹配通过 CONDITION_FOCUSED_COMPONENT_MAP 查表完成，无需硬编码 switch/case。
 * @param condition 快捷键条件；undefined 表示无条件限制。
 * @param focused 当前聚焦组件标识字符串。
 * @returns 条件满足返回 true。
 */
export function isConditionSatisfied(
    condition: ShortcutCondition | undefined,
    focused: FocusedComponent,
): boolean {
    if (!condition) {
        return true;
    }

    const expectedFocused = CONDITION_FOCUSED_COMPONENT_MAP[condition];
    if (!expectedFocused) {
        return false;
    }

    return focused === expectedFocused;
}

/** 当前聚焦组件（模块级状态） */
let currentFocusedComponent: FocusedComponent = "other";

/**
 * @function getCurrentFocusedComponent
 * @description 获取当前聚焦组件标识。
 * @returns 当前聚焦组件标识字符串。
 */
export function getCurrentFocusedComponent(): FocusedComponent {
    return currentFocusedComponent;
}

/** 焦点追踪清理函数 */
let focusTrackingCleanup: (() => void) | null = null;

/**
 * @function initFocusTracking
 * @description 初始化焦点追踪：监听全局 focusin 事件，在组件焦点变化时更新状态并记录日志。
 *   重复调用会先清理前一次的监听。
 * @returns 清理函数，用于移除事件监听。
 *
 * @副作用
 *   - 修改模块状态 currentFocusedComponent
 *   - 注册全局 focusin 事件监听
 *   - 输出日志：info 级别记录组件焦点切换
 */
export function initFocusTracking(): () => void {
    // 清理上一次的监听
    if (focusTrackingCleanup) {
        focusTrackingCleanup();
        focusTrackingCleanup = null;
    }

    const handleFocusIn = (event: FocusEvent): void => {
        const target = event.target as HTMLElement | null;
        const nextFocused = detectFocusedComponentFromElement(target);

        if (nextFocused !== currentFocusedComponent) {
            const previousFocused = currentFocusedComponent;
            currentFocusedComponent = nextFocused;

            console.info("[focusContext] component focus changed", {
                from: previousFocused,
                to: nextFocused,
                targetTag: target?.tagName?.toLowerCase() ?? "null",
                targetClass: target?.className?.slice(0, 60) ?? "",
            });
        }
    };

    window.addEventListener("focusin", handleFocusIn, { capture: true });

    const cleanup = (): void => {
        window.removeEventListener("focusin", handleFocusIn, { capture: true });
    };

    focusTrackingCleanup = cleanup;

    console.info("[focusContext] focus tracking initialized");

    return cleanup;
}
