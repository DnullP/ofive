/**
 * @module plugins/custom-activity/iconCatalog
 * @description 自定义 activity 可选图标目录。
 *   运行时新增 activity 与静态注册 activity 共用同一套 icon 渲染能力。
 *
 * @dependencies
 *   - react
 *   - lucide-react
 *
 * @exports
 *   - CUSTOM_ACTIVITY_ICON_OPTIONS
 *   - CustomActivityIconKey
 *   - renderCustomActivityIcon
 */

import React, { type ReactNode } from "react";
import {
    Bell,
    Bookmark,
    BookOpen,
    CalendarDays,
    CheckSquare,
    Clock3,
    Compass,
    FolderOpen,
    LayoutPanelLeft,
    MessageSquare,
    Orbit,
    Search,
    Star,
    Workflow,
    Zap,
    type LucideIcon,
} from "lucide-react";

/** 可选图标目录。 */
const ICON_COMPONENTS = {
    search: Search,
    folder: FolderOpen,
    calendar: CalendarDays,
    compass: Compass,
    graph: Orbit,
    workflow: Workflow,
    zap: Zap,
    bookmark: Bookmark,
    star: Star,
    bell: Bell,
    message: MessageSquare,
    clock: Clock3,
    board: LayoutPanelLeft,
    tasks: CheckSquare,
    book: BookOpen,
} satisfies Record<string, LucideIcon>;

/** 图标键类型。 */
export type CustomActivityIconKey = keyof typeof ICON_COMPONENTS;

/**
 * @constant CUSTOM_ACTIVITY_ICON_OPTIONS
 * @description Modal 中展示的全部当前支持图标。
 */
export const CUSTOM_ACTIVITY_ICON_OPTIONS: Array<{
    key: CustomActivityIconKey;
    label: string;
}> = [
    { key: "search", label: "Search" },
    { key: "folder", label: "Folder" },
    { key: "calendar", label: "Calendar" },
    { key: "compass", label: "Compass" },
    { key: "graph", label: "Graph" },
    { key: "workflow", label: "Workflow" },
    { key: "zap", label: "Zap" },
    { key: "bookmark", label: "Bookmark" },
    { key: "star", label: "Star" },
    { key: "bell", label: "Bell" },
    { key: "message", label: "Message" },
    { key: "clock", label: "Clock" },
    { key: "board", label: "Board" },
    { key: "tasks", label: "Tasks" },
    { key: "book", label: "Book" },
];

/**
 * @function renderCustomActivityIcon
 * @description 根据图标键渲染 activity icon。
 * @param iconKey 图标键。
 * @returns 可渲染图标节点。
 */
export function renderCustomActivityIcon(iconKey: CustomActivityIconKey): ReactNode {
    const IconComponent = ICON_COMPONENTS[iconKey] ?? LayoutPanelLeft;
    return React.createElement(IconComponent, { size: 18, strokeWidth: 1.8 });
}