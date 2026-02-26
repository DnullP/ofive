/**
 * @module layout/editor/registerBuiltinEditPlugins
 * @description 内置编辑插件注册入口：集中注册已拆分的编辑交互插件。
 * @dependencies
 *   - ./editPlugins/wikilinkSuggestEditPlugin
 */

import { registerWikiLinkSuggestEditPlugin } from "./editPlugins/wikilinkSuggestEditPlugin";

/** 是否已完成注册（防止重复执行） */
let registered = false;

/**
 * @function ensureBuiltinEditPluginsRegistered
 * @description 确保内置编辑插件注册仅执行一次。
 *   在编辑器模块初始化时调用（与 syntaxRenderer 注册对称）。
 */
export function ensureBuiltinEditPluginsRegistered(): void {
    if (registered) {
        return;
    }

    registerWikiLinkSuggestEditPlugin();
    registered = true;
}
