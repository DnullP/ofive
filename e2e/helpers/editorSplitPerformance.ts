/**
 * @module e2e/helpers/editorSplitPerformance
 * @description 编辑器 split 拖拽性能回归测试 helper。
 */

import type { Page } from "@playwright/test";

export const LIVE_EDITOR_SELECTOR = ".cm-editor:not([data-editor-preview-mirror-node='true'])";
export const PREVIEW_MIRROR_SELECTOR = "[data-editor-preview-mirror='true']";
export const PREVIEW_MIRROR_EDITOR_SELECTOR = ".cm-editor[data-editor-preview-mirror-node='true']";
export const PREVIEW_MIRROR_FALLBACK_SELECTOR = ".cm-editor-preview-mirror__fallback";
export const PREVIEW_TABLE_SKELETON_SELECTOR = "[data-editor-preview-table-skeleton='true']";

export interface DragPerformanceSample {
    frameDeltas: number[];
    maxFrameDelta: number;
    framesOver50: number;
    longTaskCount: number;
    longTaskMax: number;
}

export interface PreviewFrameSnapshot {
    overlayCount: number;
    overlaySectionCount: number;
    previewMirrorCount: number;
    previewMirrorEditorCount: number;
    previewFallbackCount: number;
    previewTableSkeletonCount: number;
    previewRealTableShellCount: number;
    liveEditorCount: number;
}

declare global {
    interface Window {
        __stopEditorSplitDragPerf?: () => DragPerformanceSample;
    }
}

export async function waitOneAnimationFrame(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
    }));
}

export async function installDragPerformanceSampler(page: Page): Promise<void> {
    await page.evaluate(() => {
        const existingStop = window.__stopEditorSplitDragPerf;
        existingStop?.();

        const frameDeltas: number[] = [];
        const longTasks: number[] = [];
        let active = true;
        const startTime = performance.now();
        let previousFrameTime = 0;
        let frameId = 0;
        let observer: PerformanceObserver | null = null;

        const tick = (timestamp: number): void => {
            if (!active) {
                return;
            }
            if (previousFrameTime > 0) {
                frameDeltas.push(timestamp - previousFrameTime);
            }
            previousFrameTime = timestamp;
            frameId = window.requestAnimationFrame(tick);
        };

        if (typeof PerformanceObserver !== "undefined") {
            try {
                observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.startTime >= startTime) {
                            longTasks.push(entry.duration);
                        }
                    }
                });
                observer.observe({ type: "longtask" });
            } catch {
                observer = null;
            }
        }

        frameId = window.requestAnimationFrame(tick);
        window.__stopEditorSplitDragPerf = () => {
            active = false;
            window.cancelAnimationFrame(frameId);
            observer?.disconnect();
            return {
                frameDeltas,
                maxFrameDelta: Math.max(0, ...frameDeltas),
                framesOver50: frameDeltas.filter((delta) => delta > 50).length,
                longTaskCount: longTasks.length,
                longTaskMax: Math.max(0, ...longTasks),
            };
        };
    });
}

export async function stopDragPerformanceSampler(page: Page): Promise<DragPerformanceSample> {
    return page.evaluate(() => {
        const stop = window.__stopEditorSplitDragPerf;
        if (!stop) {
            throw new Error("editor split drag performance sampler is not installed");
        }
        return stop();
    });
}

export async function readPreviewFrame(page: Page): Promise<PreviewFrameSnapshot> {
    return page.evaluate((selectors) => {
        const overlay = document.querySelector<HTMLElement>("[data-layout-tab-preview-overlay='true']");
        return {
            overlayCount: overlay ? 1 : 0,
            overlaySectionCount: overlay?.querySelectorAll(".layout-v2-tab-section").length ?? 0,
            previewMirrorCount: overlay?.querySelectorAll(selectors.previewMirror).length ?? 0,
            previewMirrorEditorCount: overlay?.querySelectorAll(selectors.previewMirrorEditor).length ?? 0,
            previewFallbackCount: overlay?.querySelectorAll(selectors.previewFallback).length ?? 0,
            previewTableSkeletonCount: overlay?.querySelectorAll(selectors.previewTableSkeleton).length ?? 0,
            previewRealTableShellCount: overlay?.querySelectorAll(".cm-markdown-table-widget .mtv-shell").length ?? 0,
            liveEditorCount: document.querySelectorAll(selectors.liveEditor).length,
        };
    }, {
        previewMirror: PREVIEW_MIRROR_SELECTOR,
        previewMirrorEditor: PREVIEW_MIRROR_EDITOR_SELECTOR,
        previewFallback: PREVIEW_MIRROR_FALLBACK_SELECTOR,
        previewTableSkeleton: PREVIEW_TABLE_SKELETON_SELECTOR,
        liveEditor: LIVE_EDITOR_SELECTOR,
    });
}
