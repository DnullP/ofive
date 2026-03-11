/**
 * @module layout/sidebar/SidebarIconBar
 * @description 横向图标栏组件，嵌入右侧栏 header 区域。
 *   显示被分配到右侧栏的活动图标，支持接收从左侧 ActivityBar 拖入的图标。
 *   点击面板容器类图标切换右侧栏活动分组，点击触发类图标执行自定义操作。
 *   纯展示组件，所有状态与事件由外部（DockviewLayout）管理。
 *
 * @dependencies
 *   - react
 *   - ./types (ActivityIconItem, IconDragState, ACTIVITY_ICON_DRAG_TYPE)
 *
 * @exports
 *   - SidebarIconBar        横向图标栏组件
 *   - SidebarIconBarProps    组件属性接口
 */

import {
    type ReactNode,
    type DragEvent as ReactDragEvent,
} from "react";
import type { ActivityIconItem, IconDragState } from "./types";
import "./SidebarIconBar.css";

/**
 * 横向图标栏组件属性。
 *
 * @field items        - 显示在右侧栏的可见图标列表
 * @field activeItemId - 当前激活的右侧活动项 ID
 * @field dragState    - 图标拖拽状态
 * @field onItemClick  - 图标点击回调
 * @field onDragOver   - 区域 dragover 回调（接受来自 ActivityBar 的拖拽）
 * @field onDrop       - 放置回调（图标从 ActivityBar 拖入）
 * @field onDragLeave  - 拖拽离开回调
 * @field isDragOver   - 是否有拖拽悬停在此区域
 * @field onItemDragStart - 图标拖拽开始回调（支持拖回左侧）
 * @field onItemDragEnd   - 图标拖拽结束回调
 */
export interface SidebarIconBarProps {
    /** 右侧栏图标列表 */
    items: ActivityIconItem[];
    /** 当前激活的右侧活动项 ID */
    activeItemId: string | null;
    /** 图标拖拽状态 */
    dragState: IconDragState | null;
    /** 图标点击 */
    onItemClick: (item: ActivityIconItem) => void;
    /** 区域 dragover */
    onDragOver: (e: ReactDragEvent<HTMLDivElement>) => void;
    /** 放置 */
    onDrop: (e: ReactDragEvent<HTMLDivElement>) => void;
    /** 拖拽离开 */
    onDragLeave: () => void;
    /** 是否有拖拽悬停 */
    isDragOver: boolean;
    /** 图标拖拽开始（支持从右侧栏拖回左侧） */
    onItemDragStart: (itemId: string) => (e: ReactDragEvent<HTMLButtonElement>) => void;
    /** 图标拖拽结束 */
    onItemDragEnd: () => void;
}

/**
 * 横向图标栏组件。
 *
 * 渲染结构：
 *   <div class="sidebar-icon-bar [drag-over]">
 *     {items.map(icon button)}
 *     [空状态时显示提示文字]
 *   </div>
 *
 * @param props SidebarIconBarProps
 * @returns 横向图标栏 JSX
 */
export function SidebarIconBar(props: SidebarIconBarProps): ReactNode {
    const {
        items,
        activeItemId,
        dragState,
        onItemClick,
        onDragOver,
        onDrop,
        onDragLeave,
        isDragOver,
        onItemDragStart,
        onItemDragEnd,
    } = props;

    return (
        /* styles: .sidebar-icon-bar — 横向 flex 容器 + 拖入高亮 */
        <div
            className={`sidebar-icon-bar${isDragOver ? " drag-over" : ""}`}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragLeave={onDragLeave}
        >
            {items.length > 0 ? (
                items.map((item) => (
                    /* styles: .sidebar-icon-bar-item — 横向图标按钮 */
                    /* styles: .sidebar-icon-bar-item.active — 激活态 */
                    /* styles: .sidebar-icon-bar-item.dragging — 拖拽中 */
                    <button
                        key={item.id}
                        type="button"
                        draggable
                        className={[
                            "sidebar-icon-bar-item",
                            "window-no-drag",
                            item.id === activeItemId ? "active" : "",
                            dragState?.draggedId === item.id ? "dragging" : "",
                        ].filter(Boolean).join(" ")}
                        title={item.title}
                        data-testid={`right-activity-icon-${item.id}`}
                        onClick={() => {
                            onItemClick(item);
                        }}
                        onDragStart={onItemDragStart(item.id)}
                        onDragEnd={onItemDragEnd}
                    >
                        {item.icon}
                    </button>
                ))
            ) : (
                /* styles: .sidebar-icon-bar-empty — 空状态提示 */
                <span className="sidebar-icon-bar-empty" />
            )}
        </div>
    );
}
