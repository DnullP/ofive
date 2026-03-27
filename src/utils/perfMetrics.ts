/**
 * @module utils/perfMetrics
 * @description 前端性能指标模块：提供低侵入的全局性能采集能力。
 *   设计目标是通过 `PerformanceObserver` 与 `web-vitals` 自动覆盖大部分
 *   启动与交互体感指标，而不是在业务模块中逐个插入计时代码。
 * @dependencies
 *  - web-vitals
 *
 * @example
 *   setupFrontendPerfMonitoring();
 *
 * @exports
 *  - PerfMetricRecord
 *  - recordPerfMetric
 *  - setupFrontendPerfMonitoring
 *  - getRecordedPerfMetrics
 *  - clearRecordedPerfMetrics
 */

import {
    onCLS,
    onFCP,
    onINP,
    onLCP,
    onTTFB,
    type Metric,
} from "web-vitals";

/**
 * @type PerfMetricStatus
 * @description 性能指标状态。
 */
export type PerfMetricStatus = "ok" | "warn";

/**
 * @interface PerfMetricRecord
 * @description 单条结构化性能指标。
 */
export interface PerfMetricRecord {
    /** 指标协议版本。 */
    schemaVersion: "ofive.perf.metric.v1";
    /** 指标名称。 */
    name: string;
    /** 指标分类。 */
    category: "web-vitals" | "performance-observer" | "playwright-derived";
    /** 指标状态。 */
    status: PerfMetricStatus;
    /** 运行时。 */
    runtime: "browser";
    /** 起始时间戳。 */
    startedAt: number;
    /** 结束时间戳。 */
    finishedAt: number;
    /** 持续时间（毫秒）。 */
    durationMs: number;
    /** 附加上下文。 */
    details: Record<string, unknown>;
}

declare global {
    interface Window {
        /** Playwright 与调试工具读取的前端性能指标缓冲区。 */
        __OFIVE_PERF_METRICS__?: PerfMetricRecord[];
    }
}

const perfMetricsBuffer: PerfMetricRecord[] = [];
let monitoringInitialized = false;

/**
 * @function nowPerf
 * @description 获取高精度计时值。
 * @returns 当前性能时钟毫秒值。
 */
function nowPerf(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }

    return Date.now();
}

/**
 * @function timeOrigin
 * @description 获取浏览器 time origin。
 * @returns 纪元毫秒时间戳。
 */
function timeOrigin(): number {
    if (typeof performance !== "undefined" && typeof performance.timeOrigin === "number") {
        return performance.timeOrigin;
    }

    return Date.now() - nowPerf();
}

/**
 * @function cloneDetails
 * @description 复制附加上下文字段，避免外部后续修改影响已记录指标。
 * @param details 原始上下文。
 * @returns 复制后的上下文对象。
 */
function cloneDetails(details?: Record<string, unknown>): Record<string, unknown> {
    if (!details) {
        return {};
    }

    return { ...details };
}

/**
 * @function appendMetricToWindow
 * @description 将指标同步到浏览器全局缓冲区，供 Playwright 与调试读取。
 * @param metric 已完成的性能指标。
 */
function appendMetricToWindow(metric: PerfMetricRecord): void {
    if (typeof window === "undefined") {
        return;
    }

    if (!Array.isArray(window.__OFIVE_PERF_METRICS__)) {
        window.__OFIVE_PERF_METRICS__ = [];
    }

    window.__OFIVE_PERF_METRICS__.push(metric);
}

/**
 * @function recordPerfMetric
 * @description 记录一条已完成的性能指标，并输出结构化日志。
 * @param metric 性能指标。
 */
export function recordPerfMetric(metric: PerfMetricRecord): void {
    perfMetricsBuffer.push(metric);
    appendMetricToWindow(metric);
    console.info("[perf-metric]", JSON.stringify(metric));
}

/**
 * @function createMetricFromDuration
 * @description 根据持续时间和性能时钟起点构建结构化指标。
 * @param name 指标名称。
 * @param category 指标分类。
 * @param durationMs 持续时间。
 * @param startedAtPerf 起始 performance.now()。
 * @param details 附加信息。
 * @param status 指标状态。
 * @returns 结构化指标。
 */
function createMetricFromDuration(
    name: string,
    category: PerfMetricRecord["category"],
    durationMs: number,
    startedAtPerf: number,
    details?: Record<string, unknown>,
    status: PerfMetricStatus = "ok",
): PerfMetricRecord {
    const startedAt = Math.round(timeOrigin() + startedAtPerf);
    const finishedAt = Math.round(startedAt + durationMs);
    return {
        schemaVersion: "ofive.perf.metric.v1",
        name,
        category,
        status,
        runtime: "browser",
        startedAt,
        finishedAt,
        durationMs: Number(durationMs.toFixed(3)),
        details: cloneDetails(details),
    };
}

/**
 * @function recordWebVitalMetric
 * @description 将 web-vitals 指标转换为统一结构后写入缓冲区。
 * @param metric web-vitals 输出结果。
 */
function recordWebVitalMetric(metric: Metric): void {
    const startedAtPerf = metric.entries[0]?.startTime ?? Math.max(0, metric.value);
    recordPerfMetric(
        createMetricFromDuration(
            `frontend.vitals.${metric.name.toLowerCase()}`,
            "web-vitals",
            metric.value,
            startedAtPerf,
            {
                id: metric.id,
                rating: metric.rating,
                delta: metric.delta,
                entryCount: metric.entries.length,
            },
        ),
    );
}

/**
 * @function observeEntryType
 * @description 订阅指定 PerformanceEntry 类型并转换为统一指标。
 * @param entryType 待监听 entry 类型。
 * @param onEntry 单条 entry 回调。
 */
function observeEntryType(
    entryType: string,
    onEntry: (entry: PerformanceEntry) => void,
): void {
    if (typeof PerformanceObserver === "undefined") {
        return;
    }

    const supportedEntryTypes = Array.isArray(PerformanceObserver.supportedEntryTypes)
        ? PerformanceObserver.supportedEntryTypes
        : [];
    if (!supportedEntryTypes.includes(entryType)) {
        return;
    }

    try {
        const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach(onEntry);
        });
        observer.observe({ type: entryType, buffered: true });
    } catch (error) {
        console.warn("[perf-metric] performance observer setup failed", {
            entryType,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * @function recordNavigationMetric
 * @description 记录一次 navigation 性能条目。
 */
function recordNavigationMetric(): void {
    if (typeof performance === "undefined") {
        return;
    }

    const navigationEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!navigationEntry) {
        return;
    }

    recordPerfMetric(
        createMetricFromDuration(
            "frontend.performance.navigation",
            "performance-observer",
            navigationEntry.duration,
            navigationEntry.startTime,
            {
                domInteractiveMs: Number(navigationEntry.domInteractive.toFixed(3)),
                domCompleteMs: Number(navigationEntry.domComplete.toFixed(3)),
                loadEventEndMs: Number(navigationEntry.loadEventEnd.toFixed(3)),
                type: navigationEntry.type,
            },
        ),
    );
}

/**
 * @function setupFrontendPerfMonitoring
 * @description 初始化前端全局性能采集，只应执行一次。
 */
export function setupFrontendPerfMonitoring(): void {
    if (monitoringInitialized) {
        return;
    }
    monitoringInitialized = true;

    recordNavigationMetric();

    onCLS(recordWebVitalMetric);
    onFCP(recordWebVitalMetric);
    onINP(recordWebVitalMetric);
    onLCP(recordWebVitalMetric);
    onTTFB(recordWebVitalMetric);

    observeEntryType("paint", (entry) => {
        recordPerfMetric(
            createMetricFromDuration(
                `frontend.performance.paint.${entry.name}`,
                "performance-observer",
                entry.startTime,
                0,
                {
                    entryType: entry.entryType,
                },
            ),
        );
    });

    observeEntryType("longtask", (entry) => {
        recordPerfMetric(
            createMetricFromDuration(
                "frontend.performance.longtask",
                "performance-observer",
                entry.duration,
                entry.startTime,
                {
                    entryType: entry.entryType,
                    name: entry.name,
                },
                entry.duration >= 100 ? "warn" : "ok",
            ),
        );
    });
}

/**
 * @function getRecordedPerfMetrics
 * @description 获取当前进程内已经记录的性能指标快照。
 * @returns 性能指标数组副本。
 */
export function getRecordedPerfMetrics(): PerfMetricRecord[] {
    return perfMetricsBuffer.map((metric) => ({
        ...metric,
        details: { ...metric.details },
    }));
}

/**
 * @function clearRecordedPerfMetrics
 * @description 清空当前已记录的性能指标与未完成跨度，仅用于测试重置。
 */
export function clearRecordedPerfMetrics(): void {
    perfMetricsBuffer.length = 0;

    if (typeof window !== "undefined") {
        window.__OFIVE_PERF_METRICS__ = [];
    }

    monitoringInitialized = false;
}