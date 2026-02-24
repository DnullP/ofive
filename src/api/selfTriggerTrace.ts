/**
 * @module api/selfTriggerTrace
 * @description 写入溯源（write trace）管理模块：
 *   负责跟踪由当前前端实例触发的文件写入操作，
 *   防止后端文件系统 watcher 回流事件导致不必要的 reload。
 * @dependencies 无外部依赖
 *
 * @example
 *   const traceId = createWriteTraceId();
 *   registerLocalWriteTrace(traceId);
 *   // 稍后后端事件回流时：
 *   isSelfTriggeredPayload({ sourceTraceId: traceId }) // → true
 *
 * @exports
 *  - createWriteTraceId: 生成唯一 traceId
 *  - registerLocalWriteTrace: 注册写入 traceId
 *  - isSelfTriggeredPayload: 判断事件是否为自触发
 *  - clearAllWriteTraces: 清空所有 trace（仅测试用）
 */

/**
 * @constant LOCAL_WRITE_TRACE_TTL_MS
 * @description 本地写入 trace 过期时间（毫秒）。
 *   事件从后端 watcher 回流到前端的最大预期延迟为 5 秒，
 *   保守设置 15 秒以覆盖高负载场景。
 */
export const LOCAL_WRITE_TRACE_TTL_MS = 15_000;

/**
 * @description 按 traceId 索引的过期时间（Unix 毫秒），
 *   用于快速查找当前前端实例是否注册过该 traceId。
 */
const localWriteTraceExpiryById = new Map<string, number>();

/**
 * @interface TraceAwarePayload
 * @description 包含溯源字段的事件负载接口。
 */
export interface TraceAwarePayload {
    /** 来源 traceId：由前端携带，后端 watcher 回填 */
    sourceTraceId: string | null;
}

/**
 * @function cleanupExpiredWriteTrace
 * @description 清理本地过期写入 trace，避免内存持续增长。
 * @param now 当前毫秒时间戳。
 */
function cleanupExpiredWriteTrace(now: number): void {
    localWriteTraceExpiryById.forEach((expireAt, traceId) => {
        if (expireAt <= now) {
            localWriteTraceExpiryById.delete(traceId);
        }
    });
}

/**
 * @function createWriteTraceId
 * @description 为一次本地保存生成全局唯一 traceId。
 * @returns traceId 字符串，前缀 "vault-save-"。
 */
export function createWriteTraceId(): string {
    const globalCrypto = globalThis.crypto;
    if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
        return `vault-save-${globalCrypto.randomUUID()}`;
    }

    return `vault-save-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * @function registerLocalWriteTrace
 * @description 注册写入 traceId 到本地缓存，供后续事件回流判断。
 * @param traceId 写入操作 traceId。
 */
export function registerLocalWriteTrace(traceId: string): void {
    const now = Date.now();
    cleanupExpiredWriteTrace(now);
    localWriteTraceExpiryById.set(traceId, now + LOCAL_WRITE_TRACE_TTL_MS);
}

/**
 * @function isSelfTriggeredPayload
 * @description 判断事件负载是否由当前前端实例的写入触发。
 *   匹配条件：sourceTraceId 非空、存在于本地缓存且未过期。
 * @param payload 包含 sourceTraceId 的事件负载。
 * @returns true 表示该事件来自本前端实例的写入。
 */
export function isSelfTriggeredPayload(payload: TraceAwarePayload): boolean {
    const traceId = payload.sourceTraceId?.trim();
    if (!traceId) {
        return false;
    }

    const now = Date.now();
    cleanupExpiredWriteTrace(now);
    const expireAt = localWriteTraceExpiryById.get(traceId);
    if (!expireAt || expireAt <= now) {
        if (expireAt) {
            localWriteTraceExpiryById.delete(traceId);
        }
        return false;
    }
    return true;
}

/**
 * @function clearAllWriteTraces
 * @description 清空所有 trace 记录。仅用于测试重置。
 */
export function clearAllWriteTraces(): void {
    localWriteTraceExpiryById.clear();
}

/**
 * @function getActiveTraceCount
 * @description 返回当前活跃（未过期）的 trace 数量。仅用于测试断言。
 * @returns 活跃数量。
 */
export function getActiveTraceCount(): number {
    const now = Date.now();
    cleanupExpiredWriteTrace(now);
    return localWriteTraceExpiryById.size;
}
