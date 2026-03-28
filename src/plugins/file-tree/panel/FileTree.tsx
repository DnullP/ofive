import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { FileText, Folder, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./FileTree.css";
import { showNativeContextMenu } from "../../../host/layout/nativeContextMenu";

export interface FileTreeItem {
  id: string;
  path: string;
  isDir: boolean;
}

interface TreeNode {
  id: string;
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
}

interface FileTreeProps {
  items: FileTreeItem[];
  activePath?: string | null;
  onOpenFile?: (item: FileTreeItem) => void;
  onRenameSubmit?: (item: FileTreeItem, draftName: string) => Promise<boolean> | boolean;
  onDeleteItem?: (item: FileTreeItem) => void;
  onDeleteItems?: (items: FileTreeItem[]) => void;
  onMoveToItem?: (item: FileTreeItem) => void;
  onMoveItemsToDirectory?: (items: FileTreeItem[]) => void;
  onMoveFileByDrop?: (
    sourceRelativePath: string,
    targetDirectoryRelativePath: string,
    sourceIsDir: boolean,
  ) => void;
  onMoveItemsByDrop?: (
    items: FileTreeItem[],
    targetDirectoryRelativePath: string,
  ) => void;
  onCreateFileInDirectory?: (targetDirectoryRelativePath: string, draftName: string) => void;
  onCreateFolderInDirectory?: (targetDirectoryRelativePath: string, draftName: string) => void;
}

function resolveParentDirectory(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const splitIndex = normalized.lastIndexOf("/");
  if (splitIndex < 0) {
    return "";
  }
  return normalized.slice(0, splitIndex);
}

function collectAncestorDirectoryPaths(path: string): string[] {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return [];
  }

  const segments = normalized.split("/");
  if (segments.length <= 1) {
    return [];
  }

  const ancestors: string[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const nextPath = segments.slice(0, index + 1).join("/");
    ancestors.push(nextPath);
  }

  return ancestors;
}

function resolveDropDirectoryPath(node: TreeNode): string | null {
  if (node.isFolder) {
    return node.path;
  }

  const parentDirectory = resolveParentDirectory(node.path);
  if (parentDirectory === "") {
    return null;
  }

  return parentDirectory;
}

function isDescendantPath(path: string, ancestorPath: string): boolean {
  if (!ancestorPath) {
    return false;
  }

  return path.startsWith(`${ancestorPath}/`);
}

function buildTree(items: FileTreeItem[]): TreeNode[] {
  const rootNodes: TreeNode[] = [];

  const getOrCreateNode = (
    siblings: TreeNode[],
    path: string,
    name: string,
    isFolder: boolean,
    id: string,
  ): TreeNode => {
    const existing = siblings.find((node) => node.path === path);
    if (existing) {
      return existing;
    }
    const node: TreeNode = {
      id,
      name,
      path,
      isFolder,
      children: [],
    };
    siblings.push(node);
    return node;
  };

  const sortedItems = [...items].sort((a, b) => a.path.localeCompare(b.path));

  for (const item of sortedItems) {
    const parts = item.path.split("/").filter(Boolean);
    let siblings = rootNodes;
    let currentPath = "";

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      const isLast = index === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      const node = getOrCreateNode(
        siblings,
        currentPath,
        part,
        isLast ? item.isDir : true,
        isLast ? item.id : `folder:${currentPath}`,
      );

      siblings = node.children;
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((node) => ({ ...node, children: sortNodes(node.children) }))
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) {
          return a.isFolder ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

  return sortNodes(rootNodes);
}

function flattenVisibleNodes(nodes: TreeNode[], expandedFolders: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];

  const visit = (nodeList: TreeNode[]): void => {
    nodeList.forEach((node) => {
      result.push(node);
      if (node.isFolder && expandedFolders.has(node.path)) {
        visit(node.children);
      }
    });
  };

  visit(nodes);
  return result;
}

function normalizeSelectionItems(items: FileTreeItem[]): FileTreeItem[] {
  const deduped = Array.from(
    new Map(items.map((item) => [item.path, item])).values(),
  ).sort((left, right) => {
    const depthDiff = left.path.split("/").length - right.path.split("/").length;
    if (depthDiff !== 0) {
      return depthDiff;
    }
    if (left.isDir !== right.isDir) {
      return left.isDir ? -1 : 1;
    }
    return left.path.localeCompare(right.path);
  });

  const result: FileTreeItem[] = [];
  deduped.forEach((item) => {
    const hasSelectedAncestorDirectory = result.some((candidate) => candidate.isDir && isDescendantPath(item.path, candidate.path));
    if (!hasSelectedAncestorDirectory) {
      result.push(item);
    }
  });
  return result;
}

function sanitizeRangeSelectionPaths(
  selectedPaths: string[],
  items: FileTreeItem[],
): string[] {
  const selectedPathSet = new Set(selectedPaths);

  return selectedPaths.filter((path) => {
    const item = items.find((candidate) => candidate.path === path);
    if (!item?.isDir) {
      return true;
    }

    const hasUnselectedDescendant = items.some((candidate) =>
      isDescendantPath(candidate.path, path) && !selectedPathSet.has(candidate.path),
    );

    return !hasUnselectedDescendant;
  });
}

function canMoveItemToDirectory(item: FileTreeItem, targetDirectoryPath: string): boolean {
  const normalizedTarget = targetDirectoryPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (item.isDir && (normalizedTarget === item.path || isDescendantPath(normalizedTarget, item.path))) {
    return false;
  }

  const sourceName = item.path.split("/").pop() ?? item.path;
  const nextPath = normalizedTarget ? `${normalizedTarget}/${sourceName}` : sourceName;
  return nextPath !== item.path;
}

function createDragPreviewElement(label: string): HTMLDivElement {
  const element = document.createElement("div");
  element.textContent = label;
  element.style.position = "fixed";
  element.style.top = "-9999px";
  element.style.left = "-9999px";
  element.style.padding = "8px 10px";
  element.style.borderRadius = "8px";
  element.style.background = "rgba(31, 41, 55, 0.92)";
  element.style.color = "#ffffff";
  element.style.fontSize = "12px";
  element.style.fontWeight = "600";
  element.style.boxShadow = "0 8px 20px rgba(0, 0, 0, 0.18)";
  element.style.pointerEvents = "none";
  element.style.zIndex = "9999";
  return element;
}

/**
 * @function buildTreeHeaderSummary
 * @description 根据当前选择状态构建文件树头部摘要。
 * @param selectionCount 当前选中数量。
 * @param t 国际化函数。
 * @returns 摘要文本。
 */
function buildTreeHeaderSummary(
  selectionCount: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (selectionCount > 0) {
    return t("fileTree.selectionSummary", { count: selectionCount });
  }

  return "";
}

function TreeItem({
  node,
  level,
  expanded,
  activePath,
  selectedPaths,
  draggingPaths,
  dropTargetDirectoryPath,
  editingItemPath,
  renameDraft,
  creatingType,
  creatingParentPath,
  creatingDraft,
  renamingPath,
  onItemClick,
  onToggle,
  onOpen,
  onBeginDrag,
  onDragEnd,
  onDropOnNode,
  onDragOverNode,
  onOpenContextMenu,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onCreateDraftChange,
  onCommitCreate,
  onCancelCreate,
}: {
  node: TreeNode;
  level: number;
  expanded: Set<string>;
  activePath?: string | null;
  selectedPaths: Set<string>;
  draggingPaths: Set<string>;
  dropTargetDirectoryPath: string | null;
  editingItemPath: string | null;
  renameDraft: string;
  creatingType: "file" | "folder" | null;
  creatingParentPath: string | null;
  creatingDraft: string;
  renamingPath: string | null;
  onItemClick: (event: ReactMouseEvent<HTMLButtonElement>, node: TreeNode) => void;
  onToggle: (path: string) => void;
  onOpen: (node: TreeNode) => void;
  onBeginDrag: (event: ReactDragEvent<HTMLButtonElement>, node: TreeNode) => void;
  onDragEnd: () => void;
  onDropOnNode: (event: ReactDragEvent<HTMLButtonElement>, node: TreeNode) => void;
  onDragOverNode: (event: ReactDragEvent<HTMLButtonElement>, node: TreeNode) => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, node: TreeNode) => void;
  onRenameDraftChange: (nextValue: string) => void;
  onCommitRename: (node: TreeNode) => void;
  onCancelRename: () => void;
  onCreateDraftChange: (nextValue: string) => void;
  onCommitCreate: () => void;
  onCancelCreate: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPaths.has(node.path);
  const isDropTarget = dropTargetDirectoryPath !== null && node.path === dropTargetDirectoryPath;
  const isDropDescendant =
    dropTargetDirectoryPath !== null &&
    node.path.startsWith(`${dropTargetDirectoryPath}/`) &&
    node.path !== dropTargetDirectoryPath;
  const isDraggingSource = draggingPaths.has(node.path);
  const isEditingName = editingItemPath === node.path;
  const isSubmittingRename = renamingPath === node.path;
  const shouldRenderCreateInputInsideFolder =
    node.isFolder && creatingParentPath === node.path && Boolean(creatingType);

  if (isEditingName) {
    return (
      <li>
        <div
          className={`tree-item tree-item-editing ${node.path === activePath ? "active" : ""}`}
          style={{ paddingLeft: `${String(level * 14 + 8)}px` }}
        >
          <span className="tree-prefix" />
          <input
            className="tree-rename-input"
            value={renameDraft}
            onChange={(event) => {
              onRenameDraftChange(event.target.value);
            }}
            onBlur={() => {
              onCommitRename(node);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onCommitRename(node);
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                onCancelRename();
              }
            }}
            autoFocus
            disabled={isSubmittingRename}
          />
        </div>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className={`tree-item ${node.path === activePath ? "active" : ""} ${isSelected ? "selected" : ""} ${isDraggingSource ? "dragging-source" : ""} ${isDropTarget ? "drop-target" : ""} ${isDropDescendant ? "drop-descendant" : ""}`}
        data-tree-path={node.path}
        data-tree-is-dir={String(node.isFolder)}
        style={{ paddingLeft: `${String(level * 14 + 8)}px` }}
        onMouseDown={(event) => {
          const isRightButton = event.button === 2;
          const isMacCtrlLeftClick = event.button === 0 && event.ctrlKey;
          if (isRightButton || isMacCtrlLeftClick) {
            event.preventDefault();
          }
        }}
        onClick={(event) => {
          const buttonEl = event.currentTarget;
          const shouldRestoreFocus = !node.isFolder && !event.shiftKey && !event.metaKey && !event.ctrlKey;
          onItemClick(event, node);
          if (shouldRestoreFocus) {
            requestAnimationFrame(() => {
              buttonEl.focus();
            });
          }
        }}
        onDoubleClick={() => {
          if (!node.isFolder) {
            onOpen(node);
          }
        }}
        onContextMenu={(event) => {
          onOpenContextMenu(event, node);
        }}
        draggable
        onDragStart={(event) => {
          onBeginDrag(event, node);
        }}
        onDragEnd={() => {
          onDragEnd();
        }}
        onDragOver={(event) => {
          onDragOverNode(event, node);
        }}
        onDrop={(event) => {
          onDropOnNode(event, node);
        }}
      >
        <span className="tree-prefix">{node.isFolder ? (isExpanded ? "▾" : "▸") : ""}</span>
        <span className="tree-icon" aria-hidden="true">
          {node.isFolder
            ? (isExpanded ? <FolderOpen size={14} strokeWidth={1.9} /> : <Folder size={14} strokeWidth={1.9} />)
            : <FileText size={14} strokeWidth={1.9} />}
        </span>
        <span className="tree-name">{node.name}</span>
      </button>
      {node.isFolder && isExpanded && node.children.length > 0 && (
        <ul className="tree-children">
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              level={level + 1}
              expanded={expanded}
              activePath={activePath}
              selectedPaths={selectedPaths}
              draggingPaths={draggingPaths}
              dropTargetDirectoryPath={dropTargetDirectoryPath}
              editingItemPath={editingItemPath}
              renameDraft={renameDraft}
              creatingType={creatingType}
              creatingParentPath={creatingParentPath}
              creatingDraft={creatingDraft}
              renamingPath={renamingPath}
              onItemClick={onItemClick}
              onToggle={onToggle}
              onOpen={onOpen}
              onBeginDrag={onBeginDrag}
              onDragEnd={onDragEnd}
              onDropOnNode={onDropOnNode}
              onDragOverNode={onDragOverNode}
              onOpenContextMenu={onOpenContextMenu}
              onRenameDraftChange={onRenameDraftChange}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onCreateDraftChange={onCreateDraftChange}
              onCommitCreate={onCommitCreate}
              onCancelCreate={onCancelCreate}
            />
          ))}
          {shouldRenderCreateInputInsideFolder && (
            <li>
              <div className="tree-item tree-item-editing" style={{ paddingLeft: `${String((level + 1) * 14 + 8)}px` }}>
                <span className="tree-prefix" />
                <input
                  className="tree-rename-input"
                  value={creatingDraft}
                  onChange={(event) => {
                    onCreateDraftChange(event.target.value);
                  }}
                  onBlur={() => {
                    onCommitCreate();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onCommitCreate();
                      return;
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelCreate();
                    }
                  }}
                  autoFocus
                  placeholder={creatingType === "folder" ? t("fileTree.newFolderPlaceholder") : t("fileTree.newFilePlaceholder")}
                />
              </div>
            </li>
          )}
        </ul>
      )}
      {node.isFolder && isExpanded && node.children.length === 0 && shouldRenderCreateInputInsideFolder && (
        <ul className="tree-children">
          <li>
            <div className="tree-item tree-item-editing" style={{ paddingLeft: `${String((level + 1) * 14 + 8)}px` }}>
              <span className="tree-prefix" />
              <input
                className="tree-rename-input"
                value={creatingDraft}
                onChange={(event) => {
                  onCreateDraftChange(event.target.value);
                }}
                onBlur={() => {
                  onCommitCreate();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onCommitCreate();
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    onCancelCreate();
                  }
                }}
                autoFocus
                placeholder={creatingType === "folder" ? t("fileTree.newFolderPlaceholder") : t("fileTree.newFilePlaceholder")}
              />
            </div>
          </li>
        </ul>
      )}
    </li>
  );
}

export function FileTree({
  items,
  activePath,
  onOpenFile,
  onRenameSubmit,
  onDeleteItem,
  onDeleteItems,
  onMoveToItem,
  onMoveItemsToDirectory,
  onMoveFileByDrop,
  onMoveItemsByDrop,
  onCreateFileInDirectory,
  onCreateFolderInDirectory,
}: FileTreeProps): ReactNode {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tree = useMemo(() => buildTree(items), [items]);
  const itemByPath = useMemo(
    () => new Map(items.map((item) => [item.path.replace(/\\/g, "/"), item])),
    [items],
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
  const [draggingItems, setDraggingItems] = useState<FileTreeItem[]>([]);
  const [draggingPaths, setDraggingPaths] = useState<Set<string>>(new Set());
  const [dropTargetDirectoryPath, setDropTargetDirectoryPath] = useState<string | null>(null);
  const [editingItemPath, setEditingItemPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<"file" | "folder" | null>(null);
  const [creatingParentPath, setCreatingParentPath] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState<string>("");

  const visibleNodes = useMemo(
    () => flattenVisibleNodes(tree, expandedFolders),
    [tree, expandedFolders],
  );
  const headerSummary = buildTreeHeaderSummary(selectedPaths.size, t);

  useEffect(() => {
    if (!activePath) {
      return;
    }

    const normalizedActivePath = activePath.replace(/\\/g, "/");
    const ancestors = collectAncestorDirectoryPaths(normalizedActivePath);
    if (ancestors.length === 0) {
      return;
    }

    setExpandedFolders((previousValue) => {
      const nextValue = new Set(previousValue);
      let changed = false;

      ancestors.forEach((ancestorPath) => {
        if (!nextValue.has(ancestorPath)) {
          nextValue.add(ancestorPath);
          changed = true;
        }
      });

      return changed ? nextValue : previousValue;
    });
  }, [activePath]);

  useEffect(() => {
    if (!activePath) {
      return;
    }

    const normalizedActivePath = activePath.replace(/\\/g, "/");
    const rafId = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const candidates = Array.from(container.querySelectorAll<HTMLButtonElement>(".tree-item"));
      const target = candidates.find((element) => element.dataset.treePath === normalizedActivePath);
      if (!target) {
        return;
      }

      target.scrollIntoView({
        block: "nearest",
      });
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [activePath, tree]);

  useEffect(() => {
    setSelectedPaths((previousValue) => {
      const nextValue = new Set(
        Array.from(previousValue).filter((path) => itemByPath.has(path)),
      );
      return nextValue.size === previousValue.size ? previousValue : nextValue;
    });

    if (selectionAnchorPath && !itemByPath.has(selectionAnchorPath)) {
      setSelectionAnchorPath(null);
    }
  }, [itemByPath, selectionAnchorPath]);

  const buildSelectionItems = (paths: Set<string>): FileTreeItem[] =>
    Array.from(paths)
      .map((path) => itemByPath.get(path))
      .filter((item): item is FileTreeItem => item !== undefined);

  const selectExclusive = (path: string): void => {
    setSelectedPaths(new Set([path]));
    setSelectionAnchorPath(path);
  };

  const toggleSelection = (path: string): void => {
    setSelectedPaths((previousValue) => {
      const nextValue = new Set(previousValue);
      if (nextValue.has(path)) {
        nextValue.delete(path);
      } else {
        nextValue.add(path);
      }
      return nextValue;
    });
    setSelectionAnchorPath(path);
  };

  const selectRange = (path: string): void => {
    const visiblePaths = visibleNodes.map((node) => node.path);
    const anchorPath = selectionAnchorPath ?? path;
    const anchorIndex = visiblePaths.indexOf(anchorPath);
    const targetIndex = visiblePaths.indexOf(path);
    if (anchorIndex < 0 || targetIndex < 0) {
      selectExclusive(path);
      return;
    }

    const [startIndex, endIndex] = anchorIndex <= targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
    const rangePaths = visiblePaths.slice(startIndex, endIndex + 1);
    const sanitizedRangePaths = sanitizeRangeSelectionPaths(rangePaths, items);
    setSelectedPaths(new Set(sanitizedRangePaths));
  };

  const toggleFolder = (path: string): void => {
    setExpandedFolders((previousValue) => {
      const nextValue = new Set(previousValue);
      if (nextValue.has(path)) {
        nextValue.delete(path);
      } else {
        nextValue.add(path);
      }
      return nextValue;
    });
  };

  const openItem = (node: TreeNode): void => {
    if (node.isFolder || !onOpenFile) {
      return;
    }
    onOpenFile({ id: node.id, path: node.path, isDir: false });
  };

  const startCreateInDirectory = (type: "file" | "folder", targetDirectoryRelativePath: string): void => {
    setEditingItemPath(null);
    setRenameDraft("");
    setCreatingType(type);
    setCreatingParentPath(targetDirectoryRelativePath);
    setCreatingDraft("");

    if (targetDirectoryRelativePath) {
      setExpandedFolders((previousValue) => {
        const nextValue = new Set(previousValue);
        nextValue.add(targetDirectoryRelativePath);
        return nextValue;
      });
    }
  };

  const commitCreate = (): void => {
    const draftName = creatingDraft.trim();
    if (!creatingType || creatingParentPath === null) {
      return;
    }

    if (!draftName) {
      setCreatingType(null);
      setCreatingParentPath(null);
      setCreatingDraft("");
      return;
    }

    if (creatingType === "file") {
      onCreateFileInDirectory?.(creatingParentPath, draftName);
    } else {
      onCreateFolderInDirectory?.(creatingParentPath, draftName);
    }

    setCreatingType(null);
    setCreatingParentPath(null);
    setCreatingDraft("");
  };

  const cancelCreate = (): void => {
    setCreatingType(null);
    setCreatingParentPath(null);
    setCreatingDraft("");
  };

  const openCreateContextMenu = async (targetDirectoryRelativePath: string): Promise<void> => {
    const selectedAction = await showNativeContextMenu([
      {
        id: "create-file",
        text: t("common.newFile"),
      },
      {
        id: "create-folder",
        text: t("common.newFolder"),
      },
    ]);

    if (selectedAction === "create-file") {
      if (!onCreateFileInDirectory) {
        return;
      }
      startCreateInDirectory("file", targetDirectoryRelativePath);
      return;
    }

    if (selectedAction === "create-folder") {
      if (!onCreateFolderInDirectory) {
        return;
      }
      startCreateInDirectory("folder", targetDirectoryRelativePath);
    }
  };

  const handleItemClick = (event: ReactMouseEvent<HTMLButtonElement>, node: TreeNode): void => {
    const isToggleSelection = event.metaKey || event.ctrlKey;
    const isRangeSelection = event.shiftKey;

    if (isRangeSelection) {
      selectRange(node.path);
      return;
    }

    if (isToggleSelection) {
      toggleSelection(node.path);
      return;
    }

    selectExclusive(node.path);
    if (node.isFolder) {
      toggleFolder(node.path);
      return;
    }
    openItem(node);
  };

  const handleContextMenu = async (
    event: ReactMouseEvent<HTMLButtonElement>,
    node: TreeNode,
  ): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();

    const nextSelectionPaths = selectedPaths.has(node.path)
      ? selectedPaths
      : new Set([node.path]);
    if (!selectedPaths.has(node.path)) {
      setSelectedPaths(nextSelectionPaths);
      setSelectionAnchorPath(node.path);
    }

    const selectedItems = normalizeSelectionItems(buildSelectionItems(nextSelectionPaths));
    const targetDirectory = node.isFolder ? node.path : resolveParentDirectory(node.path);
    const isBatchSelection = selectedItems.length > 1;

    const selectedAction = await showNativeContextMenu(
      isBatchSelection
        ? [
          {
            id: "selection-summary",
            text: t("moveFileModal.selectionSummary", { count: selectedItems.length }),
            enabled: false,
          },
          {
            id: "move-to",
            text: t("common.moveTo"),
            enabled: true,
          },
          {
            id: "delete",
            text: t("common.delete"),
            enabled: true,
          },
        ]
        : [
          {
            id: "create-file",
            text: t("common.newFile"),
          },
          {
            id: "create-folder",
            text: t("common.newFolder"),
          },
          {
            id: "rename",
            text: t("common.rename"),
            enabled: true,
          },
          {
            id: "delete",
            text: t("common.delete"),
            enabled: true,
          },
          {
            id: "move-to",
            text: t("common.moveTo"),
            enabled: true,
          },
        ],
    );

    if (selectedAction === "create-file") {
      if (!onCreateFileInDirectory) {
        return;
      }
      startCreateInDirectory("file", targetDirectory);
      return;
    }

    if (selectedAction === "create-folder") {
      if (!onCreateFolderInDirectory) {
        return;
      }
      startCreateInDirectory("folder", targetDirectory);
      return;
    }

    if (!selectedAction) {
      return;
    }

    const selectedItem = selectedItems[0];
    if (!selectedItem) {
      return;
    }

    if (selectedAction === "rename") {
      const currentFileName = selectedItem.path.split("/").pop() ?? selectedItem.path;
      setEditingItemPath(selectedItem.path);
      setRenameDraft(currentFileName);
      return;
    }

    if (selectedAction === "delete") {
      if (selectedItems.length > 1) {
        onDeleteItems?.(selectedItems);
      } else {
        onDeleteItem?.(selectedItem);
      }
      return;
    }

    if (selectedAction === "move-to") {
      if (selectedItems.length > 1) {
        onMoveItemsToDirectory?.(selectedItems);
      } else if (onMoveItemsToDirectory) {
        onMoveItemsToDirectory([selectedItem]);
      } else {
        onMoveToItem?.(selectedItem);
      }
    }
  };

  const handleRootContextMenu = (event: ReactMouseEvent<HTMLElement>): void => {
    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest(".tree-item")) {
      return;
    }

    event.preventDefault();
    void openCreateContextMenu("");
  };

  const clearDragState = (): void => {
    setDraggingItems([]);
    setDraggingPaths(new Set());
    setDropTargetDirectoryPath(null);
  };

  const handleBeginDrag = (event: ReactDragEvent<HTMLButtonElement>, node: TreeNode): void => {
    const nextSelectionPaths = selectedPaths.has(node.path)
      ? selectedPaths
      : new Set([node.path]);
    if (!selectedPaths.has(node.path)) {
      setSelectedPaths(nextSelectionPaths);
      setSelectionAnchorPath(node.path);
    }

    const nextDraggingItems = normalizeSelectionItems(buildSelectionItems(nextSelectionPaths));
    const nextDraggingPaths = new Set(nextDraggingItems.map((item) => item.path));
    setDraggingItems(nextDraggingItems);
    setDraggingPaths(nextDraggingPaths);
    setDropTargetDirectoryPath(null);

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify(nextDraggingItems.map((item) => ({
        path: item.path,
        isDir: item.isDir,
      }))),
    );

    const previewLabel = nextDraggingItems.length > 1
      ? t("fileTree.dragSelectionLabel", { count: nextDraggingItems.length })
      : (nextDraggingItems[0]?.path.split("/").pop() ?? node.name);
    const preview = createDragPreviewElement(previewLabel);
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, 18, 18);
    window.setTimeout(() => {
      preview.remove();
    }, 0);
  };

  const resolveMovableDraggingItems = (targetDirectoryPath: string): FileTreeItem[] =>
    draggingItems.filter((item) => canMoveItemToDirectory(item, targetDirectoryPath));

  const handleDragOverNode = (event: ReactDragEvent<HTMLButtonElement>, node: TreeNode): void => {
    if (draggingItems.length === 0) {
      return;
    }

    const targetDirectoryPath = resolveDropDirectoryPath(node);
    if (targetDirectoryPath === null) {
      setDropTargetDirectoryPath(null);
      return;
    }

    const movableItems = resolveMovableDraggingItems(targetDirectoryPath);
    if (movableItems.length === 0) {
      setDropTargetDirectoryPath(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTargetDirectoryPath(targetDirectoryPath);
  };

  const handleDropOnNode = (event: ReactDragEvent<HTMLButtonElement>, node: TreeNode): void => {
    if (draggingItems.length === 0) {
      return;
    }

    const targetDirectoryPath = resolveDropDirectoryPath(node);
    if (targetDirectoryPath === null) {
      setDropTargetDirectoryPath(null);
      return;
    }

    const movableItems = resolveMovableDraggingItems(targetDirectoryPath);
    if (movableItems.length === 0) {
      setDropTargetDirectoryPath(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (movableItems.length > 1) {
      onMoveItemsByDrop?.(movableItems, targetDirectoryPath);
    } else {
      const singleItem = movableItems[0];
      if (singleItem) {
        onMoveFileByDrop?.(singleItem.path, targetDirectoryPath, singleItem.isDir);
      }
    }

    clearDragState();
  };

  const handleDragOverRoot = (event: ReactDragEvent<HTMLUListElement>): void => {
    if (draggingItems.length === 0) {
      return;
    }

    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest(".tree-item")) {
      return;
    }

    const movableItems = resolveMovableDraggingItems("");
    if (movableItems.length === 0) {
      setDropTargetDirectoryPath(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetDirectoryPath("");
  };

  const handleDropOnRoot = (event: ReactDragEvent<HTMLUListElement>): void => {
    if (draggingItems.length === 0) {
      return;
    }

    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest(".tree-item")) {
      return;
    }

    const movableItems = resolveMovableDraggingItems("");
    if (movableItems.length === 0) {
      setDropTargetDirectoryPath(null);
      return;
    }

    event.preventDefault();

    if (movableItems.length > 1) {
      onMoveItemsByDrop?.(movableItems, "");
    } else {
      const singleItem = movableItems[0];
      if (singleItem) {
        onMoveFileByDrop?.(singleItem.path, "", singleItem.isDir);
      }
    }

    clearDragState();
  };

  const commitRename = async (node: TreeNode): Promise<void> => {
    if (editingItemPath !== node.path) {
      return;
    }

    if (renamingPath === node.path) {
      return;
    }

    const trimmedDraft = renameDraft.trim();
    if (!trimmedDraft) {
      setEditingItemPath(null);
      setRenameDraft("");
      return;
    }

    const selectedItem: FileTreeItem = {
      id: node.id,
      path: node.path,
      isDir: node.isFolder,
    };

    if (!onRenameSubmit) {
      setEditingItemPath(null);
      setRenameDraft("");
      return;
    }

    setRenamingPath(node.path);
    try {
      const success = await onRenameSubmit(selectedItem, trimmedDraft);
      if (success) {
        setEditingItemPath(null);
        setRenameDraft("");
      }
    } finally {
      setRenamingPath(null);
    }
  };

  return (
    <div
      className="file-tree"
      ref={containerRef}
      tabIndex={-1}
    >
      <div className="file-tree-header">
        <div className="file-tree-header-main">
          <span className="file-tree-header-title">{t("fileTree.files")}</span>
          <span className="file-tree-header-count">{t("fileTree.itemCount", { count: items.length })}</span>
        </div>
        {headerSummary ? <div className="file-tree-header-subtitle">{headerSummary}</div> : null}
      </div>
      <ul
        className={`tree-root ${dropTargetDirectoryPath === "" ? "drop-target-root" : ""}`}
        onContextMenu={handleRootContextMenu}
        onMouseDown={(event) => {
          const targetElement = event.target as HTMLElement | null;
          if (!targetElement?.closest(".tree-item")) {
            setSelectedPaths(new Set());
          }
        }}
        onDragOver={handleDragOverRoot}
        onDrop={handleDropOnRoot}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
            return;
          }

          if (dropTargetDirectoryPath === "") {
            setDropTargetDirectoryPath(null);
          }
        }}
      >
        {creatingParentPath === "" && creatingType ? (
          <li>
            <div className="tree-item tree-item-editing" style={{ paddingLeft: "8px" }}>
              <span className="tree-prefix" />
              <input
                className="tree-rename-input"
                value={creatingDraft}
                onChange={(event) => {
                  setCreatingDraft(event.target.value);
                }}
                onBlur={() => {
                  commitCreate();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitCreate();
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelCreate();
                  }
                }}
                autoFocus
                placeholder={creatingType === "folder" ? t("fileTree.newFolderPlaceholder") : t("fileTree.newFilePlaceholder")}
              />
            </div>
          </li>
        ) : null}
        {tree.length > 0 ? (
          tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              level={0}
              expanded={expandedFolders}
              activePath={activePath}
              selectedPaths={selectedPaths}
              draggingPaths={draggingPaths}
              dropTargetDirectoryPath={dropTargetDirectoryPath}
              editingItemPath={editingItemPath}
              renameDraft={renameDraft}
              creatingType={creatingType}
              creatingParentPath={creatingParentPath}
              creatingDraft={creatingDraft}
              renamingPath={renamingPath}
              onItemClick={handleItemClick}
              onToggle={toggleFolder}
              onOpen={openItem}
              onBeginDrag={handleBeginDrag}
              onDragEnd={clearDragState}
              onDropOnNode={handleDropOnNode}
              onDragOverNode={handleDragOverNode}
              onOpenContextMenu={(event, nodeItem) => {
                void handleContextMenu(event, nodeItem);
              }}
              onRenameDraftChange={(nextValue) => {
                setRenameDraft(nextValue);
              }}
              onCommitRename={(nodeItem) => {
                void commitRename(nodeItem);
              }}
              onCancelRename={() => {
                setEditingItemPath(null);
                setRenameDraft("");
              }}
              onCreateDraftChange={(nextValue) => {
                setCreatingDraft(nextValue);
              }}
              onCommitCreate={() => {
                commitCreate();
              }}
              onCancelCreate={() => {
                cancelCreate();
              }}
            />
          ))
        ) : (
          <li className="tree-empty-hint">{t("fileTree.emptyHint")}</li>
        )}
      </ul>
    </div>
  );
}
