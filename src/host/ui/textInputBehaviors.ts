/**
 * @module host/ui/textInputBehaviors
 * @description 统一管理文本输入行为，关闭 macOS 等平台上的自动纠错、自动大写与拼写辅助。
 */

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

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
