/**
 * @module layout/sidebar/ActivityBar
 * @description 竖向活动栏组件（左侧），用于切换面板分组、打开设置等。
 *   支持拖拽排序、右键上下文菜单、向右侧 SidebarIconBar 跨栏拖拽。
 *   纯展示组件，所有状态与事件由外部（DockviewLayout）管理。
 *
 * @dependencies
 *   - react
 *   - ./types (ActivityIconItem, IconDragState, ACTIVITY_ICON_DRAG_TYPE)
 *
 * @exports
 *   - ActivityBar        竖向活动栏组件
 *   - ActivityBarProps    组件属性接口
 */

import {
    type ReactNode,
    type DragEvent as ReactDragEvent,
    type MouseEvent as ReactMouseEvent,
} from "react";
import type { ActivityIconItem, IconDragState } from "./types";
import "./ActivityBar.css";

/**
 * 竖向活动栏组件属性。
 *
 * @field topItems           - 顶部区域可见图标列表
 * @field bottomItems        - 底部区域可见图标列表
 * @field activeItemId       - 当前激活的活动项 ID
 * @field dragState          - 图标拖拽进行中状态（null 表示无拖拽）
 * @field onItemClick        - 图标点击回调
 * @field onItemDragStart    - 图标拖拽开始回调
 * @field onItemDragEnd      - 图标拖拽结束回调
 * @field onItemDragOver     - 图标 dragover 回调（用于计算插入位置）
 * @field onSectionDragOver  - 区域空白处 dragover 回调
 * @field onDrop             - 拖拽放置回调
 * @field onItemContextMenu  - 图标右键菜单回调
 * @field onBackgroundContextMenu - 空白处右键菜单回调
 * @field ariaLabel          - 无障碍标签
 */
export interface ActivityBarProps {
    /** 顶部区域可见图标列表 */
    topItems: ActivityIconItem[];
    /** 底部区域可见图标列表 */
    bottomItems: ActivityIconItem[];
    /** 当前激活的活动项 ID（null 表示无激活） */
    activeItemId: string | null;
    /** 图标拖拽状态 */
    dragState: IconDragState | null;
    /** 图标点击回调 */
    onItemClick: (item: ActivityIconItem) => void;
    /** 图标拖拽开始 */
    onItemDragStart: (itemId: string) => (e: ReactDragEvent<HTMLButtonElement>) => void;
    /** 图标拖拽结束 */
    onItemDragEnd: () => void;
    /** 图标 dragover */
    onItemDragOver: (section: "top" | "bottom", index: number) => (e: ReactDragEvent<HTMLButtonElement>) => void;
    /** 区域容器 dragover */
    onSectionDragOver: (section: "top" | "bottom", count: number) => (e: ReactDragEvent<HTMLDivElement>) => void;
    /** 放置回调 */
    onDrop: (e: ReactDragEvent<HTMLElement>) => void;
    /** 图标右键菜单 */
    onItemContextMenu: (item: ActivityIconItem) => (e: ReactMouseEvent<HTMLButtonElement>) => void;
    /** 空白处右键菜单 */
    onBackgroundContextMenu: (e: ReactMouseEvent<HTMLElement>) => void | Promise<void>;
    /** 无障碍标签 */
    ariaLabel: string;
}

/**
 * 指示器所需视觉间隙（px）。
 * 拖拽时，目标插入位置下方的图标通过 CSS transform 向下偏移此距离，
 * 以在不改变布局的前提下创建放置指示器的视觉空间。
 */
const INDICATOR_GAP = 5;

/**
 * 活动栏单项步距（px）= 项高度(36) + CSS gap(6)。
 * 与 .activity-bar-item { height: 36px } 及
 * .activity-bar-top/bottom { gap: 6px } 对应。
 */
const ITEM_STRIDE = 42;

/** CSS gap 值（px），与 .activity-bar-top/bottom { gap } 对应。 */
const ITEM_GAP = 6;

/**
 * 计算某区域的拖拽指示器是否应显示及其插入索引。
 * 当被拖拽项在同一区域的相邻位置时不显示（无实际移动效果）。
 *
 * @param dragState   当前拖拽状态
 * @param section     目标区域
 * @param sectionItems 该区域的项列表
 * @returns [是否显示, 有效插入索引]；不显示时返回 [false, -1]
 */
function getDropIndicatorInfo(
    dragState: IconDragState | null,
    section: "top" | "bottom",
    sectionItems: ActivityIconItem[],
): [show: boolean, dropIndex: number] {
    if (!dragState || dragState.targetSection !== section || dragState.targetIndex < 0) {
        return [false, -1];
    }
    const { draggedId, targetIndex } = dragState;
    const draggedIndex = sectionItems.findIndex((i) => i.id === draggedId);
    if (draggedIndex >= 0 && (targetIndex === draggedIndex || targetIndex === draggedIndex + 1)) {
        return [false, -1];
    }
    return [true, targetIndex];
}

/**
 * 渲染一个区域（top 或 bottom）内的图标列表+拖拽指示器。
 *
 * @param sectionItems  该区域的可见图标列表
 * @param section       区域类型
 * @param props         ActivityBar 传入的事件回调等
 * @returns JSX 元素数组
 */
function renderSection(
    sectionItems: ActivityIconItem[],
    section: "top" | "bottom",
    props: ActivityBarProps,
): ReactNode[] {
    const {
        activeItemId,
        dragState,
        onItemClick,
        onItemDragStart,
        onItemDragEnd,
        onItemDragOver,
        onItemContextMenu,
    } = props;

    const elements: ReactNode[] = [];
    const [showIndicator, dropIndex] = getDropIndicatorInfo(dragState, section, sectionItems);

    for (let i = 0; i < sectionItems.length; i++) {
        const item = sectionItems[i];
        /* 目标插入位置下方的图标通过 transform 向下偏移，
           创建视觉间隙但不改变布局位置（碰撞体不变）。 */
        const shouldShift = showIndicator && i >= dropIndex;
        elements.push(
            /* styles: .activity-bar-item — 图标按钮基础样式 */
            /* styles: .activity-bar-item.active — 激活态（高亮背景） */
            /* styles: .activity-bar-item.dragging — 拖拽中（降低透明度） */
            <button
                key={item.id}
                type="button"
                draggable
                className={[
                    "activity-bar-item",
                    "window-no-drag",
                    !item.isSettings && item.id === activeItemId ? "active" : "",
                    dragState?.draggedId === item.id ? "dragging" : "",
                ].filter(Boolean).join(" ")}
                title={item.title}
                data-visual-shift={shouldShift ? String(INDICATOR_GAP) : undefined}
                style={shouldShift ? { transform: `translateY(${String(INDICATOR_GAP)}px)` } : undefined}
                onClick={() => {
                    onItemClick(item);
                }}
                onDragStart={onItemDragStart(item.id)}
                onDragEnd={onItemDragEnd}
                onDragOver={onItemDragOver(section, i)}
                onContextMenu={onItemContextMenu(item)}
            >
                {item.icon}
            </button>,
        );
    }

    /* 拖拽放置指示器：绝对定位在视觉间隙中，覆盖间隙区域以捕获 dragover 事件。
       使用 ::after 伪元素渲染 3px 高亮横线。 */
    if (showIndicator) {
        /* 间隙起点：dropIndex 之前项的底边 */
        const gapStart = dropIndex === 0 ? 0 : dropIndex * ITEM_STRIDE - ITEM_GAP;
        /* 间隙高度：原始 gap + transform 偏移（有 shifted 项时） */
        const hasShiftedItems = dropIndex < sectionItems.length;
        const gapHeight = dropIndex === 0
            ? INDICATOR_GAP
            : hasShiftedItems
                ? ITEM_GAP + INDICATOR_GAP
                : ITEM_GAP;
        elements.push(
            /* styles: .activity-bar-drop-indicator — 绝对定位的放置指示器容器 */
            <div
                key={`drop-indicator-${section}`}
                className="activity-bar-drop-indicator"
                style={{ top: `${String(gapStart)}px`, height: `${String(gapHeight)}px` }}
                onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                }}
            />,
        );
    }

    return elements;
}

/**
 * 竖向活动栏组件。
 *
 * 渲染结构：
 *   <aside class="activity-bar">
 *     <div class="activity-bar-top"> ... icons + indicators ... </div>
 *     <div class="activity-bar-bottom"> ... icons + indicators ... </div>
 *   </aside>
 *
 * @param props ActivityBarProps
 * @returns 活动栏 JSX
 */
export function ActivityBar(props: ActivityBarProps): ReactNode {
    const {
        topItems,
        bottomItems,
        dragState,
        onSectionDragOver,
        onDrop,
        onBackgroundContextMenu,
        ariaLabel,
    } = props;

    return (
        /* styles: .activity-bar — 竖向 flex 容器 + 边框 + 背景 */
        /* styles: .activity-bar-drag-region — 无拖拽时启用窗口拖拽 */
        <aside
            className={`activity-bar ${dragState ? "" : "activity-bar-drag-region"}`}
            aria-label={ariaLabel}
            data-tauri-drag-region={dragState ? undefined : true}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); }}
            onContextMenu={(e) => { void onBackgroundContextMenu(e); }}
        >
            {/* styles: .activity-bar-top — 顶部区域容器 */}
            <div
                className="activity-bar-top"
                onDragOver={onSectionDragOver("top", topItems.length)}
            >
                {renderSection(topItems, "top", props)}
            </div>

            {/* styles: .activity-bar-bottom — 底部区域容器 */}
            <div
                className="activity-bar-bottom"
                onDragOver={onSectionDragOver("bottom", bottomItems.length)}
            >
                {renderSection(bottomItems, "bottom", props)}
            </div>
        </aside>
    );
}
