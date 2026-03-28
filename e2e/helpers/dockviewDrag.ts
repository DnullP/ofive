/**
 * @module e2e/helpers/dockviewDrag
 * @description Dockview HTML5 拖拽辅助工具。
 *
 * Playwright 的 `dragTo()` 使用鼠标事件序列，但 dockview 依赖 HTML5
 * Drag and Drop API（dragstart / dragover / drop / dragend）。
 * 本模块通过在浏览器中直接派发 DragEvent 来模拟完整的拖拽流程。
 *
 * @dependencies
 *   - @playwright/test (Page, Locator)
 *
 * @example
 *   import { dockviewDragPanel } from "./helpers/dockviewDrag";
 *   await dockviewDragPanel(page, sourceLocator, targetLocator);
 */

import type { Locator, Page } from "@playwright/test";

/**
 * @interface DockviewDragTargetOffset
 * @description 拖放目标点在目标元素中的归一化偏移。
 */
export interface DockviewDragTargetOffset {
    /** 水平偏移：0 为最左，1 为最右。 */
    x: number;
    /** 垂直偏移：0 为最上，1 为最下。 */
    y: number;
}

/**
 * @interface DockviewMouseDragOptions
 * @description 基于真实鼠标事件拖拽 Dockview tab 时的节奏控制参数。
 */
export interface DockviewMouseDragOptions {
    /** 结束点悬停次数，用来等待 Dockview 渲染边缘 drop anchor。 */
    finalHoverRepeats?: number;
    /** 每次结束点悬停的等待时长。 */
    finalHoverDelayMs?: number;
    /** 释放鼠标后的额外等待时长。 */
    settleDelayMs?: number;
}

/**
 * 在 dockview PaneviewReact 面板之间执行 HTML5 拖拽。
 *
 * 通过 `page.evaluate` 在浏览器上下文中派发一整套 DragEvent，
 * 模拟用户从 source 拖拽到 target 释放的过程。
 *
 * @param page - Playwright Page 实例
 * @param source - 拖拽源 Locator（面板头 .dv-pane-header）
 * @param target - 放置目标 Locator（面板头 / 空占位区 / icon bar）
 *
 * @throws 当 source 或 target 不可见或 boundingBox 为 null 时抛出断言错误
 */
export async function dockviewDragPanel(
    page: Page,
    source: Locator,
    target: Locator,
    targetOffset: DockviewDragTargetOffset = { x: 0.5, y: 0.5 },
): Promise<void> {
    /* 确保两个元素可见 */
    await source.waitFor({ state: "visible" });
    await target.waitFor({ state: "visible" });

    const srcBox = await source.boundingBox();
    const tgtBox = await target.boundingBox();
    if (!srcBox || !tgtBox) {
        throw new Error("dockviewDragPanel: source or target boundingBox is null");
    }

    /* 计算中心点坐标 */
    const srcX = srcBox.x + srcBox.width / 2;
    const srcY = srcBox.y + srcBox.height / 2;
    const tgtX = tgtBox.x + tgtBox.width * targetOffset.x;
    const tgtY = tgtBox.y + tgtBox.height * targetOffset.y;

    /* 在浏览器上下文中按分帧节奏派发 HTML5 DragEvent 序列。 */
    await page.evaluate(
        async ({ sx, sy, tx, ty }) => {
            const wait = (ms: number): Promise<void> => {
                return new Promise((resolve) => window.setTimeout(resolve, ms));
            };

            const nextFrame = (): Promise<void> => {
                return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
            };

            function resolveDispatchElement(x: number, y: number): Element | null {
                const element = document.elementFromPoint(x, y);
                if (!element) {
                    return null;
                }

                return element.closest(
                    ".dv-drop-target-anchor, .dv-drop-target-dropzone, .dv-groupview, .dv-tabs-and-actions-container, .dv-content-container, .dv-tab, .dv-pane-header, [data-testid$='-sidebar-empty']",
                ) ?? element;
            }

            /**
             * 根据坐标找到对应 DOM 元素并派发 DragEvent
             */
            function fire(
                type: string,
                x: number,
                y: number,
                dataTransfer: DataTransfer,
            ): Element | null {
                const el = resolveDispatchElement(x, y);
                if (!el) return null;
                const event = new DragEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    dataTransfer,
                });
                el.dispatchEvent(event);
                return el;
            }

            const dt = new DataTransfer();
            let lastHovered: Element | null = null;

            function hover(x: number, y: number): void {
                const nextTarget = resolveDispatchElement(x, y);

                if (lastHovered && lastHovered !== nextTarget) {
                    const leaveEvent = new DragEvent("dragleave", {
                        bubbles: true,
                        cancelable: true,
                        clientX: x,
                        clientY: y,
                        dataTransfer: dt,
                    });
                    lastHovered.dispatchEvent(leaveEvent);
                }

                if (nextTarget && nextTarget !== lastHovered) {
                    const enterEvent = new DragEvent("dragenter", {
                        bubbles: true,
                        cancelable: true,
                        clientX: x,
                        clientY: y,
                        dataTransfer: dt,
                    });
                    nextTarget.dispatchEvent(enterEvent);
                }

                fire("dragover", x, y, dt);
                lastHovered = nextTarget;
            }

            const waypoints = [0.25, 0.5, 0.75, 0.92, 1].map((progress) => {
                return {
                    x: sx + (tx - sx) * progress,
                    y: sy + (ty - sy) * progress,
                };
            });

            /* 1. dragstart on source */
            fire("dragstart", sx, sy, dt);
            await nextFrame();

            /* 2. 沿路径多次 dragover，逐步激活 dockview drop zone */
            for (const point of waypoints) {
                hover(point.x, point.y);
                await nextFrame();
            }

            /* 3. 在最终边缘点短暂停留，等待 dockview 渲染 drop anchor */
            for (let attempt = 0; attempt < 4; attempt += 1) {
                hover(tx, ty);
                await wait(24);
            }

            /* 4. drop on target */
            fire("drop", tx, ty, dt);
            await nextFrame();

            /* 5. dragend on source */
            fire("dragend", sx, sy, dt);
        },
        { sx: srcX, sy: srcY, tx: tgtX, ty: tgtY },
    );

    /* 等待 React 状态更新 */
    await page.waitForTimeout(300);
}

/**
 * 在 Dockview 主区执行接近真实用户操作的鼠标拖拽。
 *
 * 该方法使用 Playwright `mouse` API 派发 pointer/mouse 序列，
 * 让浏览器自行触发真实的 dragstart/dragover/drop/dragend 生命周期，
 * 用于验证 synthetic DragEvent 无法覆盖的时序问题。
 *
 * @param page - Playwright Page 实例。
 * @param source - 拖拽源 tab Locator。
 * @param target - 放置目标 Locator。
 * @param targetOffset - 放置目标点在目标元素中的归一化偏移。
 * @param options - 鼠标拖拽节奏控制参数。
 *
 * @throws 当 source 或 target 不可见或 boundingBox 为空时抛出异常。
 */
export async function dockviewMouseDragPanel(
    page: Page,
    source: Locator,
    target: Locator,
    targetOffset: DockviewDragTargetOffset = { x: 0.5, y: 0.5 },
    options: DockviewMouseDragOptions = {},
): Promise<void> {
    await source.waitFor({ state: "visible" });
    await target.waitFor({ state: "visible" });

    const srcBox = await source.boundingBox();
    const tgtBox = await target.boundingBox();
    if (!srcBox || !tgtBox) {
        throw new Error("dockviewMouseDragPanel: source or target boundingBox is null");
    }

    const srcX = srcBox.x + srcBox.width / 2;
    const srcY = srcBox.y + srcBox.height / 2;
    const tgtX = tgtBox.x + tgtBox.width * targetOffset.x;
    const tgtY = tgtBox.y + tgtBox.height * targetOffset.y;
    const finalHoverRepeats = options.finalHoverRepeats ?? 4;
    const finalHoverDelayMs = options.finalHoverDelayMs ?? 32;
    const settleDelayMs = options.settleDelayMs ?? 320;

    const waypoints = [0.12, 0.28, 0.48, 0.7, 0.88, 1].map((progress) => ({
        x: srcX + (tgtX - srcX) * progress,
        y: srcY + (tgtY - srcY) * progress,
    }));

    await page.mouse.move(srcX, srcY);
    await page.waitForTimeout(16);
    await page.mouse.down();

    /* 先做一个很小的位移，稳定触发浏览器原生 dragstart。 */
    await page.mouse.move(srcX + 8, srcY + 4, { steps: 6 });
    await page.waitForTimeout(24);

    for (const point of waypoints) {
        await page.mouse.move(point.x, point.y, { steps: 10 });
        await page.waitForTimeout(20);
    }

    /* 在最终落点附近微调，给 Dockview 足够时间展示边缘 drop zone。 */
    for (let index = 0; index < finalHoverRepeats; index += 1) {
        const jitterX = index % 2 === 0 ? -3 : 3;
        const jitterY = index % 2 === 0 ? -2 : 2;
        await page.mouse.move(tgtX + jitterX, tgtY + jitterY, { steps: 6 });
        await page.waitForTimeout(finalHoverDelayMs);
    }

    await page.mouse.move(tgtX, tgtY, { steps: 4 });
    await page.waitForTimeout(finalHoverDelayMs);
    await page.mouse.up();
    await page.waitForTimeout(settleDelayMs);
}
