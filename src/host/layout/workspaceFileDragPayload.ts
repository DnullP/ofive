/**
 * @module host/layout/workspaceFileDragPayload
 * @description 宿主层文件拖拽 payload 工具：统一工作区文件到 Dockview / Canvas 的拖拽数据格式。
 *
 * @example
 *   writeWorkspaceFileDragPayload(event.dataTransfer, [{ path: "notes/a.md", isDir: false }]);
 *   const items = readWorkspaceFileDragPayload(event.dataTransfer);
 */

/**
 * @constant WORKSPACE_FILE_DRAG_MIME_TYPE
 * @description 工作区文件拖拽使用的自定义 MIME 类型。
 */
export const WORKSPACE_FILE_DRAG_MIME_TYPE = "application/x-ofive-workspace-items";
export const WORKSPACE_FILE_DRAG_HAS_FILE_MIME_TYPE = "application/x-ofive-workspace-has-file";
export const WORKSPACE_FILE_DRAG_LOCAL_SCOPE_EVENT = "ofive:workspace-file-local-scope";

const LEGACY_FILE_TREE_DRAG_MIME_TYPE = "application/x-ofive-file-tree-items";

/**
 * @interface WorkspaceFileDragPayloadItem
 * @description 工作区文件拖拽项。
 */
export interface WorkspaceFileDragPayloadItem {
    /** 仓库内相对路径。 */
    path: string;
    /** 是否目录。 */
    isDir: boolean;
}

/**
 * @type WorkspaceFileDragLocalScopeAction
 * @description 本地拖拽消费区域与宿主层之间用于同步 preview 状态的动作。
 */
export type WorkspaceFileDragLocalScopeAction = "enter" | "over" | "drop";

/**
 * @interface WorkspaceFileDragLocalScopeEventDetail
 * @description 本地拖拽消费区域广播给宿主层的事件载荷。
 */
export interface WorkspaceFileDragLocalScopeEventDetail {
    /** 当前本地消费区域动作。 */
    action: WorkspaceFileDragLocalScopeAction;
}

/**
 * @function normalizeWorkspaceFileDragPayloadItems
 * @description 归一化拖拽项并过滤非法值。
 * @param items 原始拖拽项。
 * @returns 规范化后的拖拽项数组。
 */
function normalizeWorkspaceFileDragPayloadItems(items: unknown): WorkspaceFileDragPayloadItem[] {
    if (!Array.isArray(items)) {
        return [];
    }

    return items.flatMap<WorkspaceFileDragPayloadItem>((item) => {
        if (!item || typeof item !== "object") {
            return [];
        }

        const candidate = item as {
            path?: unknown;
            isDir?: unknown;
        };
        if (typeof candidate.path !== "string" || candidate.path.trim().length === 0) {
            return [];
        }

        return [{
            path: candidate.path.replace(/\\/g, "/"),
            isDir: Boolean(candidate.isDir),
        }];
    });
}

/**
 * @function writeWorkspaceFileDragPayload
 * @description 将工作区文件拖拽项写入 DataTransfer。
 * @param dataTransfer 浏览器 DataTransfer 对象。
 * @param items 待写入的拖拽项。
 */
export function writeWorkspaceFileDragPayload(
    dataTransfer: DataTransfer,
    items: WorkspaceFileDragPayloadItem[],
): void {
    const normalizedItems = normalizeWorkspaceFileDragPayloadItems(items);
    const serialized = JSON.stringify(normalizedItems);
    dataTransfer.setData(WORKSPACE_FILE_DRAG_MIME_TYPE, serialized);
    dataTransfer.setData(
        WORKSPACE_FILE_DRAG_HAS_FILE_MIME_TYPE,
        normalizedItems.some((item) => !item.isDir) ? "1" : "0",
    );
    dataTransfer.setData(LEGACY_FILE_TREE_DRAG_MIME_TYPE, serialized);
}

/**
 * @function hasWorkspaceFileDragPayload
 * @description 判断当前 DataTransfer 是否包含 ofive 工作区拖拽类型。
 * @param dataTransfer 浏览器 DataTransfer 对象。
 * @returns 命中 ofive 工作区拖拽类型时返回 true。
 */
export function hasWorkspaceFileDragPayload(dataTransfer: DataTransfer | null): boolean {
    if (!dataTransfer) {
        return false;
    }

    return Array.from(dataTransfer.types).some((type) =>
        type === WORKSPACE_FILE_DRAG_MIME_TYPE
            || type === WORKSPACE_FILE_DRAG_HAS_FILE_MIME_TYPE
            || type === LEGACY_FILE_TREE_DRAG_MIME_TYPE,
    );
}

/**
 * @function hasWorkspaceFileDragPayloadFiles
 * @description 判断工作区拖拽中是否至少包含一个文件项，用于 dragenter/dragover 阶段。
 * @param dataTransfer 浏览器 DataTransfer 对象。
 * @returns 至少包含一个非目录项时返回 true。
 */
export function hasWorkspaceFileDragPayloadFiles(dataTransfer: DataTransfer | null): boolean {
    if (!dataTransfer) {
        return false;
    }

    if (Array.from(dataTransfer.types).includes(WORKSPACE_FILE_DRAG_HAS_FILE_MIME_TYPE)) {
        return dataTransfer.getData(WORKSPACE_FILE_DRAG_HAS_FILE_MIME_TYPE) !== "0";
    }

    if (!hasWorkspaceFileDragPayload(dataTransfer)) {
        return false;
    }

    return readWorkspaceFileDragPayload(dataTransfer).some((item) => !item.isDir);
}

/**
 * @function readWorkspaceFileDragPayload
 * @description 从 DataTransfer 读取工作区文件拖拽项。
 * @param dataTransfer 浏览器 DataTransfer 对象。
 * @returns 解析出的拖拽项；未命中或解析失败时返回空数组。
 */
export function readWorkspaceFileDragPayload(dataTransfer: DataTransfer | null): WorkspaceFileDragPayloadItem[] {
    if (!dataTransfer) {
        return [];
    }

    const rawPayload = dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME_TYPE)
        || dataTransfer.getData(LEGACY_FILE_TREE_DRAG_MIME_TYPE);
    if (!rawPayload) {
        return [];
    }

    try {
        return normalizeWorkspaceFileDragPayloadItems(JSON.parse(rawPayload));
    } catch {
        return [];
    }
}

/**
 * @function notifyWorkspaceFileDragLocalScope
 * @description 通知宿主层当前拖拽已进入本地消费区域，应清理 split preview。
 * @param action 本地消费区域动作。
 */
export function notifyWorkspaceFileDragLocalScope(action: WorkspaceFileDragLocalScopeAction): void {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(new CustomEvent<WorkspaceFileDragLocalScopeEventDetail>(
        WORKSPACE_FILE_DRAG_LOCAL_SCOPE_EVENT,
        {
            detail: { action },
        },
    ));
}