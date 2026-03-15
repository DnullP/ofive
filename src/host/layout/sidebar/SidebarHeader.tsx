/**
 * @module host/layout/sidebar/SidebarHeader
 * @description 侧栏标题组件：左侧展示标题，右侧展示由注册表提供的可点击图标按钮。
 * @dependencies
 *   - react
 *   - ../../registry/sidebarHeaderActionRegistry
 */

import { type ReactNode } from "react";
import {
    resolveSidebarHeaderActionTitle,
    type SidebarHeaderActionContext,
    type SidebarHeaderActionDescriptor,
} from "../../registry/sidebarHeaderActionRegistry";

/**
 * @interface SidebarHeaderProps
 * @description 侧栏标题组件参数。
 */
export interface SidebarHeaderProps {
    /** 标题文本 */
    title: string;
    /** 右侧动作按钮列表 */
    actions: SidebarHeaderActionDescriptor[];
    /** 点击动作时的上下文 */
    actionContext: SidebarHeaderActionContext;
    /** 测试标识 */
    testId?: string;
}

/**
 * @function SidebarHeader
 * @description 渲染侧栏标题和右侧按钮区域。
 * @param props 组件参数。
 * @returns React 节点。
 */
export function SidebarHeader(props: SidebarHeaderProps): ReactNode {
    return (
        <header
            className="sidebar-header window-drag-region"
            data-tauri-drag-region
            data-testid={props.testId}
        >
            {/* sidebar-header__title: 标题文本区域，保留窗口拖拽能力 */}
            <span className="sidebar-header__title">{props.title}</span>
            {/* sidebar-header__actions: 右侧按钮区域，禁用窗口拖拽以允许点击 */}
            <div className="sidebar-header__actions">
                {props.actions.map((action) => {
                    const title = resolveSidebarHeaderActionTitle(action.title);
                    return (
                        <button
                            key={action.id}
                            type="button"
                            className="sidebar-header__action-button"
                            title={title}
                            aria-label={title}
                            onMouseDown={(event) => {
                                // 保留文件树当前焦点，便于命令系统继续读取选中项。
                                event.preventDefault();
                            }}
                            onClick={() => {
                                action.onClick(props.actionContext);
                            }}
                        >
                            {action.icon}
                        </button>
                    );
                })}
            </div>
        </header>
    );
}