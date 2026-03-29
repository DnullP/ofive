/**
 * @module host/layout/textInputBehaviors
 * @description 统一管理浮窗文本输入行为，关闭 macOS 等平台上的自动纠错、自动大写与拼写辅助。
 * @dependencies
 *   - react
 *
 * @example
 *   <input {...modalPlainTextInputProps} />
 *
 * @exports
 *   - modalPlainTextInputProps
 *   - modalPlainTextAreaProps
 */

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * @constant modalPlainTextInputProps
 * @description modal / overlay 文本输入框的统一属性，避免系统文本辅助打断输入。
 */
export const modalPlainTextInputProps: Pick<
InputHTMLAttributes<HTMLInputElement>,
"autoComplete" | "autoCorrect" | "autoCapitalize" | "spellCheck"
> & {
    "data-gramm": "false";
} = {
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "none",
    spellCheck: false,
    "data-gramm": "false",
};

/**
 * @constant modalPlainTextAreaProps
 * @description modal / overlay 文本域的统一属性，供后续 textarea 场景复用。
 */
export const modalPlainTextAreaProps: Pick<
TextareaHTMLAttributes<HTMLTextAreaElement>,
"autoComplete" | "autoCorrect" | "autoCapitalize" | "spellCheck"
> & {
    "data-gramm": "false";
} = {
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "none",
    spellCheck: false,
    "data-gramm": "false",
};