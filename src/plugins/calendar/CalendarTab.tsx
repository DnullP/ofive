/**
 * @module plugins/calendar/CalendarTab
 * @description 日历 Tab 包装组件：从 dockview params 中解析共享状态键，复用 CalendarView。
 * @dependencies
 *  - react
 *  - dockview
 *  - ../../host/layout/openFileService
 *  - ../../host/registry
 *  - ./CalendarView
 *
 * @exports
 *  - CalendarTab
 */

import { type ReactElement } from "react";
import type { IDockviewPanelProps } from "dockview";
import { openFileInDockview } from "../../host/layout/openFileService";
import { readConvertibleViewTabState } from "../../host/registry";
import { CalendarView } from "./CalendarView";

/**
 * @function CalendarTab
 * @description 渲染日历 tab，并负责加载 frontmatter.date 查询结果。
 * @param props Dockview 面板属性。
 * @returns React 元素。
 */
export function CalendarTab(props: IDockviewPanelProps<Record<string, unknown>>): ReactElement {
    const stateKey = readConvertibleViewTabState(props.params)?.stateKey ?? "calendar";

    return (
        <CalendarView
            mode="tab"
            stateKey={stateKey}
            openNote={async (relativePath) => {
                console.info("[calendar-tab] open note", { relativePath, stateKey });
                await openFileInDockview({
                    containerApi: props.containerApi,
                    relativePath,
                });
            }}
        />
    );
}