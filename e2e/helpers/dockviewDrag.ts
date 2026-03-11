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
    const tgtX = tgtBox.x + tgtBox.width / 2;
    const tgtY = tgtBox.y + tgtBox.height / 2;

    /* 在浏览器上下文中派发 HTML5 DragEvent 序列 */
    await page.evaluate(
        ({ sx, sy, tx, ty }) => {
            /**
             * 根据坐标找到对应 DOM 元素并派发 DragEvent
             */
            function fire(
                type: string,
                x: number,
                y: number,
                dataTransfer: DataTransfer,
            ): void {
                const el = document.elementFromPoint(x, y);
                if (!el) return;
                const event = new DragEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    dataTransfer,
                });
                el.dispatchEvent(event);
            }

            const dt = new DataTransfer();

            /* 1. dragstart on source */
            fire("dragstart", sx, sy, dt);

            /* 2. dragover on target（多次触发以激活 drop zone） */
            fire("dragenter", tx, ty, dt);
            fire("dragover", tx, ty, dt);
            fire("dragover", tx, ty, dt);

            /* 3. drop on target */
            fire("drop", tx, ty, dt);

            /* 4. dragend on source */
            fire("dragend", sx, sy, dt);
        },
        { sx: srcX, sy: srcY, tx: tgtX, ty: tgtY },
    );

    /* 等待 React 状态更新 */
    await page.waitForTimeout(300);
}
