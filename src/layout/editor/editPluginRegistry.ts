/**
 * @module layout/editor/editPluginRegistry
 * @description 编辑器交互插件注册中心：通过"注册 + 插件"机制统一管理编辑器中需要产生交互行为的扩展。
 *
 *   与 syntaxRenderRegistry（仅负责装饰/渲染，不产生编辑）不同，editPlugin 需要：
 *   1. 监听用户输入并拦截或增强编辑行为（如自动补全、模板触发）；
 *   2. 渲染浮层或弹窗等 UI 元素（如补全列表、内联提示）；
 *   3. 可能发起异步操作（如后端查询、网络请求）；
 *   4. 对文档产生修改（替换、插入等事务性操作）。
 *
 *   editPlugin 的典型应用场景包括但不限于：
 *   - WikiLink `[[]]` 自动补全
 *   - LaTeX 快速触发
 *   - 粘贴 URL 自动获取网页标题
 *   - 表格编辑增强
 *
 * @dependencies
 *   - @codemirror/view（Extension / ViewPlugin / EditorView）
 *
 * @example
 *   // 注册插件并获取 CodeMirror Extension
 *   registerEditPlugin(myPlugin);
 *   const extensions = getRegisteredEditPluginExtensions(context);
 *
 *   // 取消注册
 *   unregisterEditPlugin("wikilink-suggest");
 *
 * @exports
 *   - EditPluginRegistration    — 插件注册项接口
 *   - EditPluginContext         — 插件创建时的上下文接口
 *   - registerEditPlugin        — 注册编辑插件
 *   - unregisterEditPlugin      — 取消注册编辑插件
 *   - getRegisteredEditPluginExtensions — 获取所有已注册插件的 CM Extension
 */

import type { Extension } from "@codemirror/state";

/* ================================================================== */
/*  接口定义                                                           */
/* ================================================================== */

/**
 * @interface EditPluginContext
 * @description 编辑插件实例化时的上下文信息。
 *   由编辑器宿主在创建 EditorState 时提供。
 *   插件不应缓存此对象引用——上下文中的回调可能在编辑器生命周期内更新。
 *
 *   - getCurrentFilePath  获取当前编辑文件的相对路径
 *   - getExistingMarkdownPaths  获取 vault 中所有已存在的 Markdown 路径列表
 */
export interface EditPluginContext {
    /** 获取当前编辑文件的相对路径（不含 vault 根前缀） */
    getCurrentFilePath: () => string;
}

/**
 * @interface EditPluginRegistration
 * @description 编辑插件注册项。
 *   每个插件需要提供唯一 id 和一个工厂函数，
 *   工厂函数接收上下文并返回一组 CodeMirror Extension。
 *
 *   - id            插件唯一标识符
 *   - createExtensions  工厂函数，返回 CM Extension 数组
 */
export interface EditPluginRegistration {
    /** 插件唯一标识符（如 "wikilink-suggest"、"latex-trigger"） */
    id: string;

    /**
     * 创建插件所需的 CodeMirror 扩展集合。
     *
     * @param context 编辑器宿主提供的上下文
     * @returns 一组 CodeMirror Extension（ViewPlugin / StateField / Facet 等）
     */
    createExtensions: (context: EditPluginContext) => Extension[];
}

/* ================================================================== */
/*  注册中心实现                                                       */
/* ================================================================== */

/** 已注册的编辑插件集合（按 id 键控） */
const editPluginMap = new Map<string, EditPluginRegistration>();

/**
 * @function registerEditPlugin
 * @description 注册一个编辑插件；若已存在同 id 插件，将被覆盖。
 * @param registration 插件注册项。
 * @returns 取消注册的清理函数。
 */
export function registerEditPlugin(
    registration: EditPluginRegistration,
): () => void {
    editPluginMap.set(registration.id, registration);
    console.info("[edit-plugin] registered", { id: registration.id });

    return () => {
        if (editPluginMap.get(registration.id) === registration) {
            editPluginMap.delete(registration.id);
            console.info("[edit-plugin] unregistered", { id: registration.id });
        }
    };
}

/**
 * @function unregisterEditPlugin
 * @description 按 id 取消注册编辑插件。
 * @param pluginId 插件唯一标识符。
 */
export function unregisterEditPlugin(pluginId: string): void {
    if (editPluginMap.delete(pluginId)) {
        console.info("[edit-plugin] unregistered", { id: pluginId });
    }
}

/**
 * @function getRegisteredEditPluginExtensions
 * @description 获取所有已注册编辑插件的 CodeMirror Extension 集合。
 *   在编辑器初始化（创建 EditorState）时调用。
 * @param context 编辑器上下文。
 * @returns 扁平化后的 Extension 数组。
 */
export function getRegisteredEditPluginExtensions(
    context: EditPluginContext,
): Extension[] {
    const extensions: Extension[] = [];

    for (const registration of editPluginMap.values()) {
        try {
            const pluginExtensions = registration.createExtensions(context);
            extensions.push(...pluginExtensions);
            console.debug("[edit-plugin] created extensions", {
                id: registration.id,
                extensionCount: pluginExtensions.length,
            });
        } catch (error) {
            console.error("[edit-plugin] createExtensions failed", {
                id: registration.id,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return extensions;
}
