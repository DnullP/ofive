/**
 * @module plugins/calendar/CalendarPanel
 * @description 日历 Panel 包装组件：从 PanelRenderContext 中解析共享状态键，
 *   复用 CalendarView 的共享逻辑，并使用 panel 模式的紧凑布局。
 *
 * @dependencies
 *  - react
 *  - ../../host/layout
 *  - ./CalendarView
 *
 * @exports
 *  - CalendarPanel
 */

import { type ReactElement } from "react";
import type { PanelRenderContext } from "../../host/layout";
import { CalendarView } from "./CalendarView";

/**
 * @function CalendarPanel
 * @description 渲染侧边栏中的日历 Panel。
 * @param context 面板渲染上下文。
 * @returns React 元素。
 */
export function CalendarPanel(context: PanelRenderContext): ReactElement {
    const stateKey = context.convertibleView?.stateKey ?? "calendar";

    return (
        <CalendarView
            mode="panel"
            stateKey={stateKey}
            openNote={async (relativePath) => {
                console.info("[calendar-panel] open note", { relativePath, stateKey });
                await context.openFile({ relativePath });
            }}
        />
    );
}
