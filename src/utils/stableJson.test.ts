/**
 * @module utils/stableJson.test
 * @description 稳定 JSON 序列化测试。
 */

import { describe, expect, it } from "bun:test";
import { stableStringify } from "./stableJson";

describe("stableStringify", () => {
    it("应忽略对象 key 插入顺序", () => {
        expect(stableStringify({
            b: 2,
            a: {
                z: true,
                y: "value",
            },
        })).toBe(stableStringify({
            a: {
                y: "value",
                z: true,
            },
            b: 2,
        }));
    });

    it("应保留数组顺序语义", () => {
        expect(stableStringify([{ id: "a" }, { id: "b" }])).not.toBe(
            stableStringify([{ id: "b" }, { id: "a" }]),
        );
    });
});
