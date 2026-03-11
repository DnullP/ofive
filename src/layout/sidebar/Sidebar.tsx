/**
 * @module layout/sidebar/Sidebar
 * @description 统一侧边栏容器组件，左右侧栏共用。
 *   提供标准的 header + content + 拖拽调宽手柄结构。
 *   左侧栏的 header 由外部传入（标题文本），
 *   右侧栏的 header 由外部传入（SidebarIconBar）。
 *
 * @dependencies
 *   - react
 *   - ./types (SidebarSide)
 *
 * @exports
 *   - Sidebar          侧边栏容器组件
 *   - SidebarProps      组件属性接口
 */

import { type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import type { SidebarSide } from "./types";
import "./Sidebar.css";

/**
 * 侧边栏容器组件属性。
 *
 * @field side       - 侧栏方向（left / right）
 * @field header     - 头部渲染内容（左侧为标题 header，右侧为 SidebarIconBar）
 * @field children   - 主内容区（PaneviewReact 或空状态占位）
 * @field width      - 当前宽度（px）
 * @field onBeginResize - 拖拽调宽开始回调
 * @field ariaLabel  - 无障碍标签
 */
export interface SidebarProps {
    /** 侧栏方向 */
    side: SidebarSide;
    /** 头部渲染内容 */
    header: ReactNode;
    /** 主内容区 */
    children: ReactNode;
    /** 当前宽度（px） */
    width: number;
    /** 拖拽调宽事件回调 */
    onBeginResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
    /** 无障碍标签 */
    ariaLabel: string;
}

/**
 * 统一侧边栏容器组件。
 *
 * 渲染结构：
 *   <section class="sidebar sidebar-{side}">
 *     [左边缘拖拽手柄 — 仅右侧栏]
 *     {header}   — 由调用方自行提供（可以是标题文本 / SidebarIconBar 等）
 *     <div class="sidebar-content">
 *       {children}
 *     </div>
 *     [右边缘拖拽手柄 — 仅左侧栏]
 *   </section>
 *
 * @param props SidebarProps
 * @returns 侧边栏 JSX
 */
export function Sidebar({
    side,
    header,
    children,
    onBeginResize,
    ariaLabel,
}: SidebarProps): ReactNode {
    return (
        /* styles: .sidebar — 侧栏容器基础样式（flex column + border + bg） */
        /* styles: .sidebar-left / .sidebar-right — 左右方向特化样式 */
        <section
            className={`sidebar sidebar-${side}`}
            aria-label={ariaLabel}
            data-testid={`sidebar-${side}`}
        >
            {/* 右侧栏的左边缘调宽手柄 */}
            {side === "right" && (
                /* styles: .sidebar-resize-handle.left-edge — 左边缘拖拽手柄 */
                <div
                    className="sidebar-resize-handle left-edge"
                    onMouseDown={onBeginResize}
                />
            )}

            {/* header 区域由调用方提供（标题文本或 SidebarIconBar） */}
            {header}

            {/* styles: .sidebar-content — 内容区（flex:1 + overflow） */}
            <div className="sidebar-content">
                {children}
            </div>

            {/* 左侧栏的右边缘调宽手柄 */}
            {side === "left" && (
                /* styles: .sidebar-resize-handle.right-edge — 右边缘拖拽手柄 */
                <div
                    className="sidebar-resize-handle right-edge"
                    onMouseDown={onBeginResize}
                />
            )}
        </section>
    );
}
