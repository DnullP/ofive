/**
 * @module utils/stableJson
 * @description 提供对象 key 顺序无关的 JSON 序列化，用于配置与持久化快照去重。
 */

function normalizeStableJsonValue(value: unknown): unknown {
    if (value === null || typeof value !== "object") {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => normalizeStableJsonValue(item));
    }

    const objectValue = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(objectValue).sort()) {
        result[key] = normalizeStableJsonValue(objectValue[key]);
    }
    return result;
}

/**
 * @function stableStringify
 * @description 生成稳定 JSON 字符串；对象 key 顺序不影响结果，数组顺序保持语义。
 */
export function stableStringify(value: unknown): string {
    return JSON.stringify(normalizeStableJsonValue(value));
}
