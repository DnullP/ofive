/**
 * @module plugins/markdown-codemirror/editor/lineNumbersModeExtension.test
 * @description 行号模式扩展单元测试：验证相对行号模式会向 CodeMirror 注入
 *   自定义 `formatNumber`，并对同一编辑器状态输出正确的相对行号，确保设置项真正
 *   作用到行号扩展构建链路。
 */

import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "bun:test";

import { buildLineNumbersExtension } from "./lineNumbersModeExtension";

/**
 * @interface InternalFacetProviderLike
 * @description 测试中用于解包 CodeMirror 扩展内部 FacetProvider 结构的最小形状。
 */
interface InternalFacetProviderLike {
    value?: {
        formatNumber?: (lineNo: number, state: EditorState) => string;
    };
}

/**
 * @function extractFormatNumber
 * @description 从行号扩展返回值中提取内部 `formatNumber` 配置。
 *   `lineNumbers()` 返回的扩展数组首项为内部 FacetProvider，relative 模式会在此处
 *   挂载自定义 `formatNumber`，absolute 模式则保持缺省。
 *
 * @param extension 行号模式扩展。
 * @returns `formatNumber` 函数；若未配置自定义格式化则返回 `undefined`。
 */
function extractFormatNumber(
    extension: ReturnType<typeof buildLineNumbersExtension>,
): ((lineNo: number, state: EditorState) => string) | undefined {
    if (!Array.isArray(extension)) {
        return undefined;
    }

    const provider = extension[0] as InternalFacetProviderLike | undefined;
    return provider?.value?.formatNumber;
}

describe("buildLineNumbersExtension", () => {
    test("relative 模式应注入自定义 formatNumber 并输出相对行号", () => {
        const state = EditorState.create({
            doc: ["alpha", "bravo", "charlie", "delta", "echo"].join("\n"),
            selection: {
                anchor: ["alpha", "bravo"].join("\n").length + 1,
            },
        });

        const absoluteFormatter = extractFormatNumber(
            buildLineNumbersExtension("absolute"),
        );
        const relativeFormatter = extractFormatNumber(
            buildLineNumbersExtension("relative"),
        );

        expect(absoluteFormatter).toBeUndefined();
        expect(relativeFormatter).toBeDefined();
        expect(relativeFormatter?.(1, state)).toBe("2");
        expect(relativeFormatter?.(2, state)).toBe("1");
        expect(relativeFormatter?.(3, state)).toBe("3");
        expect(relativeFormatter?.(4, state)).toBe("1");
        expect(relativeFormatter?.(5, state)).toBe("2");
    });
});