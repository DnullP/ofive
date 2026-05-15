/**
 * @module utils/useDebouncedValue
 * @description React hook：将高频输入值延后提交给昂贵计算或异步查询。
 */

import { useEffect, useState } from "react";

/**
 * @function useDebouncedValue
 * @description 返回延后更新的值；可在清空、关闭等重置场景立即同步。
 * @param value 原始输入值。
 * @param delayMs 防抖等待时间，单位毫秒。
 * @param updateImmediately 是否跳过等待并立刻同步。
 * @returns 防抖后的值。
 */
export function useDebouncedValue<T>(value: T, delayMs: number, updateImmediately = false): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        if (updateImmediately || delayMs <= 0) {
            setDebouncedValue(value);
            return;
        }

        const timer = window.setTimeout(() => {
            setDebouncedValue(value);
        }, delayMs);

        return () => {
            window.clearTimeout(timer);
        };
    }, [delayMs, updateImmediately, value]);

    return debouncedValue;
}
