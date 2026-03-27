/**
 * @module i18n/uiLanguage
 * @description 共享高频界面语言语义层，提供类似 design token 的统一 key 入口。
 *
 * @dependencies
 *  - ./index
 *
 * @example
 *  import { UI_LANGUAGE, translateUiLanguage } from "../i18n/uiLanguage";
 *  translateUiLanguage(UI_LANGUAGE.overlays.navigateList);
 *
 * @exports
 *  - UI_LANGUAGE 共享界面语言 key 映射
 *  - translateUiLanguage 非 React 场景的翻译辅助函数
 */

import i18n from "./index";

/**
 * @constant UI_LANGUAGE
 * @description 共享高频界面语言 key 映射表。
 */
export const UI_LANGUAGE = {
    overlays: {
        navigateList: "uiLanguage.overlays.navigateList",
    },
    actions: {
        open: "uiLanguage.actions.open",
        run: "uiLanguage.actions.run",
    },
    labels: {
        keyword: "uiLanguage.labels.keyword",
        tagFilter: "uiLanguage.labels.tagFilter",
    },
} as const;

/**
 * @function translateUiLanguage
 * @description 在非 React 模块中读取共享界面语言文案。
 * @param key 共享文案 key。
 * @param options i18n 插值参数。
 * @returns 翻译后的文案。
 */
export function translateUiLanguage(
    key: string,
    options?: Record<string, unknown>,
): string {
    return i18n.t(key, options);
}