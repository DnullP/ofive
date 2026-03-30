/**
 * @module plugins/markdown-codemirror/editor/components/FrontmatterYamlVisualEditor.test
 * @description FrontmatterYamlVisualEditor 纯函数单元测试，验证新增字段类型与默认字段名生成规则。
 */

import { describe, expect, test } from "bun:test";
import {
    buildDefaultValueByFieldType,
    convertValueToFieldType,
    resolveNextFieldKey,
} from "./FrontmatterYamlVisualEditor";

describe("buildDefaultValueByFieldType", () => {
    test("should build default values by field type", () => {
        expect(buildDefaultValueByFieldType("string")).toBe("");
        expect(buildDefaultValueByFieldType("number")).toBe(0);
        expect(buildDefaultValueByFieldType("boolean")).toBe(false);
        expect(buildDefaultValueByFieldType("list")).toEqual([]);
        expect(buildDefaultValueByFieldType("null")).toBeNull();
    });
});

describe("resolveNextFieldKey", () => {
    test("should create the first available key by field type", () => {
        expect(resolveNextFieldKey({}, "string")).toBe("newField");
        expect(resolveNextFieldKey({}, "number")).toBe("numberField");
        expect(resolveNextFieldKey({}, "boolean")).toBe("booleanField");
    });

    test("should append numeric suffix when base key already exists", () => {
        expect(resolveNextFieldKey({ newField: "", newField2: "" }, "string")).toBe("newField3");
        expect(resolveNextFieldKey({ listField: [], listField2: [] }, "list")).toBe("listField3");
    });
});

describe("convertValueToFieldType", () => {
    test("should keep meaningful information when converting to list", () => {
        expect(convertValueToFieldType("tag", "list")).toEqual(["tag"]);
        expect(convertValueToFieldType(null, "list")).toEqual([]);
    });

    test("should convert common values to boolean and number", () => {
        expect(convertValueToFieldType("true", "boolean")).toBe(true);
        expect(convertValueToFieldType("", "boolean")).toBe(false);
        expect(convertValueToFieldType("42", "number")).toBe(42);
        expect(convertValueToFieldType("abc", "number")).toBe(0);
    });

    test("should convert list and null values to string", () => {
        expect(convertValueToFieldType(["a", "b"], "string")).toBe("a, b");
        expect(convertValueToFieldType(null, "string")).toBe("");
    });
});