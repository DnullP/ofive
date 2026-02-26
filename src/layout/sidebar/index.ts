/**
 * @module layout/sidebar
 * @description 侧边栏子系统导出：包含 ActivityBar、SidebarIconBar、Sidebar 及共享类型。
 */

export { ActivityBar } from "./ActivityBar";
export type { ActivityBarProps } from "./ActivityBar";

export { SidebarIconBar } from "./SidebarIconBar";
export type { SidebarIconBarProps } from "./SidebarIconBar";

export { Sidebar } from "./Sidebar";
export type { SidebarProps } from "./Sidebar";

export { ACTIVITY_ICON_DRAG_TYPE } from "./types";
export type {
    SidebarSide,
    ActivityIconItem,
    IconDragState,
} from "./types";
