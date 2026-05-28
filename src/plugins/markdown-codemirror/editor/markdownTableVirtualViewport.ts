/**
 * @module plugins/markdown-codemirror/editor/markdownTableVirtualViewport
 * @description Markdown 表格虚拟行窗口与 CodeMirror 滚动容器的几何换算。
 */

export interface MarkdownTableVirtualViewport {
    top: number;
    bottom: number;
}

export interface MarkdownTableVirtualViewportGeometry {
    scrollerScrollTop: number;
    scrollerClientHeight: number;
    scrollerTop: number;
    tableTop: number;
    headerHeight: number;
}

function safeNumber(value: number, fallback = 0): number {
    return Number.isFinite(value) ? value : fallback;
}

export function resolveMarkdownTableBodyTopInScroller(
    geometry: MarkdownTableVirtualViewportGeometry,
): number {
    return safeNumber(geometry.tableTop)
        - safeNumber(geometry.scrollerTop)
        + Math.max(0, safeNumber(geometry.scrollerScrollTop))
        + Math.max(0, safeNumber(geometry.headerHeight));
}

export function resolveMarkdownTableVirtualViewport(
    geometry: MarkdownTableVirtualViewportGeometry,
): MarkdownTableVirtualViewport {
    const scrollerScrollTop = Math.max(0, safeNumber(geometry.scrollerScrollTop));
    const scrollerClientHeight = Math.max(0, safeNumber(geometry.scrollerClientHeight));
    const bodyTopInScroller = resolveMarkdownTableBodyTopInScroller(geometry);
    const viewportTop = Math.max(0, scrollerScrollTop - bodyTopInScroller);
    const viewportBottom = Math.max(
        viewportTop,
        scrollerScrollTop + scrollerClientHeight - bodyTopInScroller,
    );

    return {
        top: viewportTop,
        bottom: viewportBottom,
    };
}
