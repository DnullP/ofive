/**
 * @module plugins/markdown-codemirror/editor/editorKeyboardBridge
 * @description 编辑器键盘桥接模块：统一处理 Vim handoff、宿主快捷键分发、表格编辑器协同与删词快捷键。
 * @dependencies
 *  - codemirror
 *  - @replit/codemirror-vim
 *  - ../../../host/commands/shortcutDispatcher
 *  - ../../../host/conditions/conditionEvaluator
 *  - ./editorModePolicy
 *  - obeditor
 *
 * @example
 *   const detach = attachEditorKeyboardBridge({
 *     articleId: "file:demo",
 *     view,
 *     getBindings: () => bindings,
 *     getManagedShortcutCandidates: () => candidates,
 *     getCurrentVaultPath: () => "/vault",
 *     isVimModeEnabled: () => true,
 *     executeEditorCommand: (commandId) => console.log(commandId),
 *     focusWidgetNavigationTarget: () => false,
 *     frontmatterSelectors: {
 *       focusable: "[data-frontmatter-field-focusable='true']",
 *       navigation: "[data-frontmatter-vim-nav='true']",
 *     },
 *   });
 *
 * @exports
 *  - handleEditorKeydown: 处理单次 keydown 事件
 *  - attachEditorKeyboardBridge: 绑定/解绑编辑器 keydown 监听
 */

import { EditorView } from "codemirror";
import type { CommandId } from "../../../host/commands/commandSystem";
import { dispatchShortcut } from "../../../host/commands/shortcutDispatcher";
import { notifyTabCloseShortcutTriggered } from "../../../host/commands/shortcutEvents";
import { createConditionContext } from "../../../host/conditions/conditionEvaluator";
import {
    applyResolvedVimHandoff,
    flushFocusedMarkdownTableEditor,
    handleVimImeKeydown,
    isMarkdownTableEditorFocused,
    resolvePlainTextVimKeydownKey,
    resolveEditorBodyVimHandoff,
    type VimHandoffWidget,
    type VimHandoffWidgetPosition,
} from "obeditor";

interface ClosestCapableTarget extends EventTarget {
    closest(selector: string): Element | null;
}

function isClosestCapableTarget(target: EventTarget | null): target is ClosestCapableTarget {
    return typeof target === "object"
        && target !== null
        && "closest" in target
        && typeof target.closest === "function";
}

/**
 * @interface EditorKeyboardEventLike
 * @description 键盘桥接处理所需的最小事件接口，兼容真实 KeyboardEvent 与测试桩。
 */
export interface EditorKeyboardEventLike {
    /** 当前按下的键。 */
    key: string;
    /** 物理按键编码，例如 KeyJ；输入法组合态下 key 可能退化为 Process。 */
    code?: string;
    /** IME 组合阶段的浏览器 keyCode。 */
    keyCode?: number;
    /** 是否处于输入法组合态。 */
    isComposing?: boolean;
    /** Command/Meta 键状态。 */
    metaKey: boolean;
    /** Control 键状态。 */
    ctrlKey: boolean;
    /** Alt 键状态。 */
    altKey: boolean;
    /** Shift 键状态。 */
    shiftKey: boolean;
    /** 当前事件目标。 */
    target: EventTarget | null;
    /** 查询附加修饰键状态，例如 AltGraph。 */
    getModifierState?: (key: string) => boolean;
    /** 阻止浏览器默认行为。 */
    preventDefault(): void;
    /** 阻止事件冒泡。 */
    stopPropagation(): void;
}

/**
 * @interface FrontmatterKeyboardSelectors
 * @description frontmatter 焦点与导航层使用的 DOM 选择器集合。
 */
export interface FrontmatterKeyboardSelectors {
    /** 可编辑 frontmatter 字段。 */
    focusable: string;
    /** Vim 导航层目标。 */
    navigation: string;
}

export interface MarkdownTableKeyboardSelectors {
    /** Markdown table widget 根容器。 */
    shell: string;
}

/**
 * @interface EditorKeyboardBridgeDependencies
 * @description 键盘桥接的可注入依赖，便于测试与后续替换实现。
 */
export interface EditorKeyboardBridgeDependencies {
    /** 宿主快捷键分发器。 */
    dispatchShortcut: typeof dispatchShortcut;
    /** 条件上下文构造器。 */
    createConditionContext: typeof createConditionContext;
    /** 编辑器正文 Vim handoff 解析器。 */
    resolveEditorBodyVimHandoff: typeof resolveEditorBodyVimHandoff;
    /** Tab 关闭快捷键通知。 */
    notifyTabCloseShortcutTriggered: typeof notifyTabCloseShortcutTriggered;
    /** Markdown 表格编辑器焦点判断。 */
    isMarkdownTableEditorFocused: typeof isMarkdownTableEditorFocused;
    /** 刷新 Markdown 表格编辑器缓冲。 */
    flushFocusedMarkdownTableEditor: typeof flushFocusedMarkdownTableEditor;
    /** Vim IME keydown 处理器。 */
    handleVimImeKeydown: typeof handleVimImeKeydown;
}

/**
 * @interface EditorKeyboardBridgeBaseOptions
 * @description 绑定键盘桥接所需的长期依赖集合。
 */
export interface EditorKeyboardBridgeBaseOptions {
    /** 当前文章 id。 */
    articleId: string;
    /** 当前 EditorView。 */
    view: EditorView;
    /** 读取当前快捷键绑定。 */
    getBindings(): Record<CommandId, string>;
    /** 读取当前受管快捷键候选。 */
    getManagedShortcutCandidates(): string[];
    /** 读取当前 vault 路径。 */
    getCurrentVaultPath(): string | null | undefined;
    /** 读取当前 Vim 开关状态。 */
    isVimModeEnabled(): boolean;
    /** 执行宿主命令。 */
    executeEditorCommand(commandId: CommandId): void;
    /** 将焦点切入隐藏 widget 的导航层。 */
    focusWidgetNavigationTarget(
        widget: VimHandoffWidget,
        position: VimHandoffWidgetPosition,
        blockFrom?: number,
    ): boolean;
    /** frontmatter 相关 DOM 选择器。 */
    frontmatterSelectors: FrontmatterKeyboardSelectors;
    /** Markdown table 相关 DOM 选择器。 */
    markdownTableSelectors: MarkdownTableKeyboardSelectors;
    /** 可选的测试/替换依赖。 */
    dependencies?: Partial<EditorKeyboardBridgeDependencies>;
}

/**
 * @interface HandleEditorKeydownOptions
 * @description 处理单次 keydown 所需的参数。
 */
export interface HandleEditorKeydownOptions extends EditorKeyboardBridgeBaseOptions {
    /** 当前要处理的键盘事件。 */
    event: EditorKeyboardEventLike;
}

const DEFAULT_DEPENDENCIES: EditorKeyboardBridgeDependencies = {
    dispatchShortcut,
    createConditionContext,
    resolveEditorBodyVimHandoff,
    notifyTabCloseShortcutTriggered,
    isMarkdownTableEditorFocused,
    flushFocusedMarkdownTableEditor,
    handleVimImeKeydown,
};

/**
 * @function resolveEditorShortcutFocusedComponent
 * @description 根据事件目标解析快捷键焦点上下文。
 * @param target 当前事件目标。
 * @param selectors frontmatter 选择器集合。
 * @returns 正文或 frontmatter 的焦点组件标识。
 */
function resolveEditorShortcutFocusedComponent(
    target: EventTarget | null,
    selectors: FrontmatterKeyboardSelectors,
    markdownTableSelectors: MarkdownTableKeyboardSelectors,
): string {
    if (
        typeof HTMLElement !== "undefined" &&
        target instanceof HTMLElement &&
        target.closest(selectors.focusable)
    ) {
        return "tab:codemirror-frontmatter";
    }

    if (isClosestCapableTarget(target) && target.closest(markdownTableSelectors.shell)) {
        return "tab:codemirror-widget";
    }

    return "tab:codemirror";
}

/**
 * @function handleEditorKeydown
 * @description 处理单次编辑器 keydown 事件，统一协调 Vim handoff、删词与宿主快捷键。
 * @param options 事件处理参数。
 * @returns void。
 */
export function handleEditorKeydown(options: HandleEditorKeydownOptions): void {
    const dependencies: EditorKeyboardBridgeDependencies = {
        ...DEFAULT_DEPENDENCIES,
        ...options.dependencies,
    };
    const { event, view } = options;
    const isComposing = event.isComposing || event.keyCode === 229;
    const vimKeydownKey = resolvePlainTextVimKeydownKey(event, Boolean(isComposing));

    const eventTarget = isClosestCapableTarget(event.target)
        ? event.target
        : null;
    const isFrontmatterNavigationTarget = !!eventTarget?.closest(options.frontmatterSelectors.navigation);
    const isFrontmatterFieldTarget = !!eventTarget?.closest(options.frontmatterSelectors.focusable);
    const isMarkdownTableTarget = !!eventTarget?.closest(options.markdownTableSelectors.shell);

    if (
        options.isVimModeEnabled()
        && !isFrontmatterNavigationTarget
        && !isFrontmatterFieldTarget
        && !isMarkdownTableTarget
    ) {
        const handoffResult = dependencies.resolveEditorBodyVimHandoff({
            view,
            key: vimKeydownKey ?? event.key,
            isVimModeEnabled: options.isVimModeEnabled(),
        });

        if (handoffResult) {
            const handled = applyResolvedVimHandoff(
                view,
                handoffResult,
                options.focusWidgetNavigationTarget,
            );
            if (handled) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
    }

    if (isComposing) {
        if (
            options.isVimModeEnabled()
            && !isFrontmatterNavigationTarget
            && !isFrontmatterFieldTarget
            && !isMarkdownTableTarget
            && dependencies.handleVimImeKeydown({
                event,
                view,
                vimKey: vimKeydownKey,
            })
        ) {
            return;
        }

        return;
    }

    const resolution = dependencies.dispatchShortcut({
        event: event as KeyboardEvent,
        bindings: options.getBindings(),
        source: "editor",
        conditionContext: dependencies.createConditionContext({
            focusedComponent: resolveEditorShortcutFocusedComponent(
                event.target,
                options.frontmatterSelectors,
                options.markdownTableSelectors,
            ),
            activeTabId: options.articleId,
            activeEditorArticleId: options.articleId,
            currentVaultPath: options.getCurrentVaultPath(),
        }),
        managedShortcutCandidates: isMarkdownTableTarget ? [] : options.getManagedShortcutCandidates(),
    });

    if (dependencies.isMarkdownTableEditorFocused()) {
        if (resolution.shouldPreventDefault) {
            event.preventDefault();
        }
        if (resolution.shouldStopPropagation) {
            event.stopPropagation();
        }

        if (resolution.kind === "block-native") {
            return;
        }

        if (resolution.commandId?.startsWith("editor.")) {
            return;
        }

        if (resolution.kind === "execute") {
            dependencies.flushFocusedMarkdownTableEditor();
        }
    }

    if (resolution.kind === "none") {
        return;
    }

    if (resolution.shouldPreventDefault) {
        event.preventDefault();
    }
    if (resolution.shouldStopPropagation) {
        event.stopPropagation();
    }

    if (resolution.notifyTabClose) {
        dependencies.notifyTabCloseShortcutTriggered();
    }

    if (resolution.kind === "block-native" || !resolution.commandId) {
        return;
    }

    options.executeEditorCommand(resolution.commandId);
}

/**
 * @function attachEditorKeyboardBridge
 * @description 将编辑器 keydown 监听绑定到 view.dom，并返回解绑函数。
 * @param options 键盘桥接参数。
 * @returns 解绑当前监听器的清理函数。
 */
export function attachEditorKeyboardBridge(
    options: EditorKeyboardBridgeBaseOptions,
): () => void {
    const handleKeydown = (event: KeyboardEvent): void => {
        handleEditorKeydown({
            ...options,
            event,
        });
    };

    options.view.dom.addEventListener("keydown", handleKeydown, true);

    return () => {
        options.view.dom.removeEventListener("keydown", handleKeydown, true);
    };
}
