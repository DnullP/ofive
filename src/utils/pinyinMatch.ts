/**
 * @module utils/pinyinMatch
 * @description 拼音匹配工具：将包含中文字符的文本转为拼音，支持全拼和首字母匹配。
 *   用于快速切换等场景，允许用户通过输入拼音匹配中文文件名。
 *
 * @dependencies
 *  - pinyin-pro
 *
 * @example
 *   scorePinyinMatch("日记", "riji");   // 返回分值（命中全拼）
 *   scorePinyinMatch("日记", "rj");     // 返回分值（命中首字母）
 *   scorePinyinMatch("hello", "hello"); // 返回 null（无中文，不走拼音匹配）
 *
 * @exports
 *  - scorePinyinMatch: 计算拼音匹配分值
 *  - containsChinese: 判断文本是否包含中文字符
 */

import { pinyin } from "pinyin-pro";

/**
 * 匹配 CJK 统一表意文字的正则。
 */
const CJK_PATTERN = /[\u4e00-\u9fff]/;

/**
 * @function containsChinese
 * @description 判断文本是否包含中文字符。
 * @param text 待检测文本。
 * @returns 是否包含中文。
 */
export function containsChinese(text: string): boolean {
    return CJK_PATTERN.test(text);
}

/**
 * @function looksLikePinyin
 * @description 判断查询串是否可能为拼音输入（仅包含 ASCII 字母和空格）。
 * @param query 查询串。
 * @returns 是否像拼音输入。
 */
export function looksLikePinyin(query: string): boolean {
    return /^[a-zA-Z\s]+$/.test(query.trim());
}

/**
 * @function scorePinyinMatch
 * @description 计算拼音匹配分值。当文本包含中文且查询像拼音时，尝试以下匹配：
 *   1. 全拼完全相等 → 100
 *   2. 全拼前缀匹配 → 80
 *   3. 全拼包含匹配 → 60
 *   4. 首字母完全相等 → 70
 *   5. 首字母前缀匹配 → 55
 *   6. 首字母包含匹配 → 40
 *   匹配均基于去空格的拼音。
 *
 * @param text 原始文本（如文件名）。
 * @param query 用户查询串（如 "riji"、"rj"）。
 * @returns 匹配分值；未命中或不适用时返回 null。
 */
export function scorePinyinMatch(text: string, query: string): number | null {
    if (!containsChinese(text)) {
        return null;
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery || !looksLikePinyin(normalizedQuery)) {
        return null;
    }

    const fullPinyin = pinyin(text, { toneType: "none", type: "array" })
        .join("")
        .toLowerCase();

    const initials = pinyin(text, { pattern: "first", toneType: "none", type: "array" })
        .join("")
        .toLowerCase();

    const queryNoSpaces = normalizedQuery.replace(/\s+/g, "");

    if (fullPinyin === queryNoSpaces) {
        return 100;
    }
    if (fullPinyin.startsWith(queryNoSpaces)) {
        return 80;
    }

    if (initials === queryNoSpaces) {
        return 70;
    }
    if (initials.startsWith(queryNoSpaces)) {
        return 55;
    }

    if (fullPinyin.includes(queryNoSpaces)) {
        return 60;
    }
    if (initials.includes(queryNoSpaces)) {
        return 40;
    }

    return null;
}
