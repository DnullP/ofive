/**
 * @module layout/sidebar/types
 * @description 侧边栏子系统共享类型定义。
 *   提供 ActivityBar、SidebarIconBar、Sidebar 等组件间共享的
 *   类型接口，包括活动图标项、拖拽状态、侧栏方向等。
 *
 * @dependencies 无外部依赖
 *
 * @exports
 *   - SidebarSide       侧栏方向
 *   - ActivityIconItem   活动图标项（带 UI 信息）
 *   - IconDragState      图标拖拽进行中的状态快照
 *   - ACTIVITY_ICON_DRAG_TYPE  拖拽 dataTransfer 的 MIME type 常量
 */

import type { ReactNode } from "react";

/**
 * 侧栏方向：左侧 / 右侧。
 */
export type SidebarSide = "left" | "right";

/**
 * 活动图标拖拽的 dataTransfer MIME type。
 * 通过自定义 MIME 类型区分活动图标拖拽与其他拖拽（如 paneview 面板拖拽）。
 */
export const ACTIVITY_ICON_DRAG_TYPE = "application/x-activity-icon";

/**
 * 经合并后的活动图标项，包含所有 UI 渲染所需信息。
 *
 * @field id        - 活动项唯一标识
 * @field title     - 显示标题（用于 tooltip）
 * @field icon      - 显示图标（ReactNode，如 lucide icon）
 * @field section   - 在竖向 ActivityBar 中的区域（top / bottom）
 * @field visible   - 是否可见
 * @field isSettings - 是否为内置设置按钮
 * @field bar       - 所属的图标栏（left = ActivityBar, right = SidebarIconBar）
 */
export interface ActivityIconItem {
    /** 活动项唯一标识 */
    id: string;
    /** 显示标题 */
    title: string;
    /** 显示图标 */
    icon: ReactNode;
    /** 竖向 ActivityBar 中的区域 */
    section: "top" | "bottom";
    /** 是否可见 */
    visible: boolean;
    /** 是否为内置设置按钮 */
    isSettings: boolean;
    /** 所属图标栏 */
    bar: SidebarSide;
}

/**
 * 图标拖拽进行中的状态快照。
 *
 * @field draggedId     - 被拖拽的活动项 ID
 * @field sourceBar     - 拖拽发起的图标栏
 * @field targetSection - 当前悬停的目标区域（仅 ActivityBar 使用）
 * @field targetIndex   - 目标插入索引（-1 表示尚未确定）
 */
export interface IconDragState {
    /** 被拖拽的活动项 ID */
    draggedId: string;
    /** 拖拽发起的图标栏 */
    sourceBar: SidebarSide;
    /** 目标区域（竖向 ActivityBar 中的 top/bottom） */
    targetSection: "top" | "bottom";
    /** 目标插入索引 */
    targetIndex: number;
}
