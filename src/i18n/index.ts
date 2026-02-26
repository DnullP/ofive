/**
 * @module i18n
 * @description 国际化（i18n）初始化模块，基于 i18next + react-i18next。
 *
 * @dependencies
 *  - i18next
 *  - react-i18next
 *  - ./locales/zh （中文资源包）
 *  - ./locales/en （英文资源包）
 *
 * @usage
 *   // 在 main.tsx 中引入即可完成初始化：
 *   import "./i18n";
 *
 *   // 在 React 组件中使用：
 *   import { useTranslation } from "react-i18next";
 *   const { t } = useTranslation();
 *   t("app.homeTitle");
 *
 *   // 在非 React 模块中使用：
 *   import i18n from "./i18n";
 *   i18n.t("common.save");
 *
 * @exports
 *  - i18n: i18next 实例
 *  - SUPPORTED_LANGUAGES: 支持的语言列表
 *  - type SupportedLanguage: 支持的语言类型
 *  - changeLanguage: 切换语言的函数
 *  - getCurrentLanguage: 获取当前语言
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh";
import en from "./locales/en";

/**
 * 支持的语言标识。
 */
export type SupportedLanguage = "zh" | "en";

/**
 * 支持的语言列表，用于 UI 展示和设置选项。
 */
export const SUPPORTED_LANGUAGES: Array<{
    /** 语言标识 */
    code: SupportedLanguage;
    /** 语言名称（本地语言显示） */
    nativeLabel: string;
}> = [
        { code: "zh", nativeLabel: "中文" },
        { code: "en", nativeLabel: "English" },
    ];

/** 本地存储中语言偏好的 key */
const LANGUAGE_STORAGE_KEY = "ofive-language";

/**
 * @function getInitialLanguage
 * @description 获取初始语言：优先使用本地存储中的偏好，否则使用浏览器语言。
 *   在非浏览器环境（如 Bun 测试运行时）下安全降级为默认语言 "zh"。
 * @returns 初始语言标识。
 */
function getInitialLanguage(): SupportedLanguage {
    /* 非浏览器环境（Bun test 等）安全降级 */
    if (typeof localStorage === "undefined") {
        return "zh";
    }
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "zh" || stored === "en") {
        return stored;
    }
    /* 浏览器语言以 zh 开头则使用中文，否则英文 */
    if (typeof navigator === "undefined") {
        return "zh";
    }
    const browserLang = navigator.language;
    if (browserLang.startsWith("zh")) {
        return "zh";
    }
    return "en";
}

i18n.use(initReactI18next).init({
    resources: {
        zh: { translation: zh },
        en: { translation: en },
    },
    lng: getInitialLanguage(),
    fallbackLng: "zh",
    interpolation: {
        /* React 已内置 XSS 防护，不需要 i18next 转义 */
        escapeValue: false,
    },
});

/**
 * @function changeLanguage
 * @description 切换当前语言并持久化到 localStorage。
 *   在非浏览器环境下跳过持久化。
 * @param language 目标语言标识。
 */
export async function changeLanguage(language: SupportedLanguage): Promise<void> {
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }
    await i18n.changeLanguage(language);
    console.info(`[i18n] language changed to: ${language}`);
}

/**
 * @function getCurrentLanguage
 * @description 获取当前生效的语言标识。
 * @returns 当前语言标识。
 */
export function getCurrentLanguage(): SupportedLanguage {
    return (i18n.language as SupportedLanguage) ?? "zh";
}

export default i18n;
