import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import "./FileTree.css";
import { showNativeContextMenu } from "./nativeContextMenu";

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
  onMoveToItem?: (item: FileTreeItem) => void;
  onMoveFileByDrop?: (
    sourceRelativePath: string,
    targetDirectoryRelativePath: string,
    sourceIsDir: boolean,
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

function buildTree(items: FileTreeItem[]): TreeNode[] {
  const rootNodes: TreeNode[] = [];

  const getOrCreateNode = (siblings: TreeNode[], path: string, name: string, isFolder: boolean, id: string): TreeNode => {
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

function TreeItem({
  node,
  level,
  expanded,
  activePath,
  draggingSourcePath,
  dropTargetDirectoryPath,
  editingItemPath,
  renameDraft,
  creatingType,
  creatingParentPath,
  creatingDraft,
  renamingPath,
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
  draggingSourcePath: string | null;
  dropTargetDirectoryPath: string | null;
  editingItemPath: string | null;
  renameDraft: string;
  creatingType: "file" | "folder" | null;
  creatingParentPath: string | null;
  creatingDraft: string;
  renamingPath: string | null;
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
  const isExpanded = expanded.has(node.path);
  const isDropTarget = dropTargetDirectoryPath !== null && node.path === dropTargetDirectoryPath;
  const isDropDescendant =
    dropTargetDirectoryPath !== null &&
    node.path.startsWith(`${dropTargetDirectoryPath}/`) &&
    node.path !== dropTargetDirectoryPath;
  const isDraggingSource = draggingSourcePath === node.path;
  const isEditingName = editingItemPath === node.path;
  const isSubmittingRename = renamingPath === node.path;
  const shouldRenderCreateInputInsideFolder =
    node.isFolder && creatingParentPath === node.path && Boolean(creatingType);

  const handleClick = (): void => {
    if (node.isFolder) {
      onToggle(node.path);
      return;
    }
    onOpen(node);
  };

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
        className={`tree-item ${node.path === activePath ? "active" : ""} ${isDraggingSource ? "dragging-source" : ""} ${isDropTarget ? "drop-target" : ""} ${isDropDescendant ? "drop-descendant" : ""}`}
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
          // 保留按钮焦点：文件打开后编辑器可能抢占焦点，
          // 异步恢复焦点以支持后续键盘操作（如 Cmd+C 复制文件）
          const buttonEl = event.currentTarget;
          handleClick();
          if (!node.isFolder) {
            requestAnimationFrame(() => {
              buttonEl.focus();
            });
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
              draggingSourcePath={draggingSourcePath}
              dropTargetDirectoryPath={dropTargetDirectoryPath}
              editingItemPath={editingItemPath}
              renameDraft={renameDraft}
              creatingType={creatingType}
              creatingParentPath={creatingParentPath}
              creatingDraft={creatingDraft}
              renamingPath={renamingPath}
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
                  placeholder={creatingType === "folder" ? "新建文件夹" : "新建文件"}
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
                placeholder={creatingType === "folder" ? "新建文件夹" : "新建文件"}
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
  onMoveToItem,
  onMoveFileByDrop,
  onCreateFileInDirectory,
  onCreateFolderInDirectory,
}: FileTreeProps): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tree = useMemo(() => buildTree(items), [items]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [draggingSourcePath, setDraggingSourcePath] = useState<string | null>(null);
  const [draggingSourceIsDir, setDraggingSourceIsDir] = useState<boolean>(false);
  const [dropTargetDirectoryPath, setDropTargetDirectoryPath] = useState<string | null>(null);
  const [editingItemPath, setEditingItemPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<"file" | "folder" | null>(null);
  const [creatingParentPath, setCreatingParentPath] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState<string>("");

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

  const toggleFolder = (path: string): void => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
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
        text: "新建文件",
      },
      {
        id: "create-folder",
        text: "新建文件夹",
      },
    ]);

    console.info("[file-tree] root context action", {
      selectedAction,
      targetDirectoryRelativePath,
    });

    if (selectedAction === "create-file") {
      if (!onCreateFileInDirectory) {
        console.warn("[file-tree] create-file skipped: handler missing", {
          targetDirectoryRelativePath,
        });
        return;
      }
      startCreateInDirectory("file", targetDirectoryRelativePath);
      return;
    }

    if (selectedAction === "create-folder") {
      if (!onCreateFolderInDirectory) {
        console.warn("[file-tree] create-folder skipped: handler missing", {
          targetDirectoryRelativePath,
        });
        return;
      }
      startCreateInDirectory("folder", targetDirectoryRelativePath);
    }
  };

  const handleContextMenu = async (
    event: ReactMouseEvent<HTMLButtonElement>,
    node: TreeNode,
  ): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();

    const targetDirectory = node.isFolder ? node.path : resolveParentDirectory(node.path);

    const selectedAction = await showNativeContextMenu([
      {
        id: "create-file",
        text: "新建文件",
      },
      {
        id: "create-folder",
        text: "新建文件夹",
      },
      {
        id: "rename",
        text: "rename",
        enabled: true,
      },
      {
        id: "delete",
        text: "删除",
        enabled: true,
      },
      {
        id: "move-to",
        text: "move to",
        enabled: true,
      },
    ]);

    console.info("[file-tree] node context action", {
      selectedAction,
      nodePath: node.path,
      targetDirectory,
    });

    if (selectedAction === "create-file") {
      if (!onCreateFileInDirectory) {
        console.warn("[file-tree] create-file skipped: handler missing", {
          nodePath: node.path,
          targetDirectory,
        });
        return;
      }
      startCreateInDirectory("file", targetDirectory);
      return;
    }

    if (selectedAction === "create-folder") {
      if (!onCreateFolderInDirectory) {
        console.warn("[file-tree] create-folder skipped: handler missing", {
          nodePath: node.path,
          targetDirectory,
        });
        return;
      }
      startCreateInDirectory("folder", targetDirectory);
      return;
    }

    if (!selectedAction) {
      return;
    }

    const selectedItem: FileTreeItem = {
      id: node.id,
      path: node.path,
      isDir: node.isFolder,
    };

    if (selectedAction === "rename") {
      const currentFileName = selectedItem.path.split("/").pop() ?? selectedItem.path;
      setEditingItemPath(selectedItem.path);
      setRenameDraft(currentFileName);
      return;
    }

    if (selectedAction === "delete") {
      onDeleteItem?.(selectedItem);
      return;
    }

    if (selectedAction === "move-to") {
      onMoveToItem?.(selectedItem);
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

  const handleBeginDrag = (event: ReactDragEvent<HTMLButtonElement>, node: TreeNode): void => {
    setDraggingSourcePath(node.path);
    setDraggingSourceIsDir(node.isFolder);
    setDropTargetDirectoryPath(null);

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify({
        path: node.path,
        isDir: node.isFolder,
      }),
    );
  };

  const handleDragOverNode = (event: ReactDragEvent<HTMLButtonElement>, node: TreeNode): void => {
    if (!draggingSourcePath) {
      return;
    }

    const targetDirectoryPath = resolveDropDirectoryPath(node);
    if (!targetDirectoryPath) {
      setDropTargetDirectoryPath(null);
      return;
    }

    const sourceName = draggingSourcePath.split("/").pop() ?? "";
    const targetPath = `${targetDirectoryPath}/${sourceName}`;
    if (targetPath === draggingSourcePath) {
      setDropTargetDirectoryPath(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTargetDirectoryPath(targetDirectoryPath);
  };

  const handleDropOnNode = (event: ReactDragEvent<HTMLButtonElement>, node: TreeNode): void => {
    if (!draggingSourcePath) {
      return;
    }

    const targetDirectoryPath = resolveDropDirectoryPath(node);
    if (!targetDirectoryPath) {
      setDropTargetDirectoryPath(null);
      return;
    }

    const sourceName = draggingSourcePath.split("/").pop() ?? "";
    const targetPath = `${targetDirectoryPath}/${sourceName}`;
    if (targetPath === draggingSourcePath) {
      setDropTargetDirectoryPath(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onMoveFileByDrop?.(draggingSourcePath, targetDirectoryPath, draggingSourceIsDir);
    setDraggingSourcePath(null);
    setDraggingSourceIsDir(false);
    setDropTargetDirectoryPath(null);
  };

  const handleDragOverRoot = (event: ReactDragEvent<HTMLUListElement>): void => {
    if (!draggingSourcePath) {
      return;
    }

    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest(".tree-item")) {
      return;
    }

    const sourceName = draggingSourcePath.split("/").pop() ?? "";
    if (!sourceName) {
      return;
    }

    if (sourceName === draggingSourcePath) {
      setDropTargetDirectoryPath(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetDirectoryPath("");
  };

  const handleDropOnRoot = (event: ReactDragEvent<HTMLUListElement>): void => {
    if (!draggingSourcePath) {
      return;
    }

    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest(".tree-item")) {
      return;
    }

    const sourceName = draggingSourcePath.split("/").pop() ?? "";
    if (!sourceName || sourceName === draggingSourcePath) {
      setDropTargetDirectoryPath(null);
      return;
    }

    event.preventDefault();
    onMoveFileByDrop?.(draggingSourcePath, "", draggingSourceIsDir);
    setDraggingSourcePath(null);
    setDraggingSourceIsDir(false);
    setDropTargetDirectoryPath(null);
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
      /* tabIndex={-1} 使容器可被点击聚焦（不参与 Tab 序列），
         点击空白区域时焦点落在 .file-tree 内，满足 fileTreeFocused 条件 */
      tabIndex={-1}
    >
      <div className="file-tree-header">文件</div>
      <ul
        className={`tree-root ${dropTargetDirectoryPath === "" ? "drop-target-root" : ""}`}
        onContextMenu={handleRootContextMenu}
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
                placeholder={creatingType === "folder" ? "新建文件夹" : "新建文件"}
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
              draggingSourcePath={draggingSourcePath}
              dropTargetDirectoryPath={dropTargetDirectoryPath}
              editingItemPath={editingItemPath}
              renameDraft={renameDraft}
              creatingType={creatingType}
              creatingParentPath={creatingParentPath}
              creatingDraft={creatingDraft}
              renamingPath={renamingPath}
              onToggle={toggleFolder}
              onOpen={openItem}
              onBeginDrag={handleBeginDrag}
              onDragEnd={() => {
                setDraggingSourcePath(null);
                setDraggingSourceIsDir(false);
                setDropTargetDirectoryPath(null);
              }}
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
          <li className="tree-empty-hint">右键空白区域可新建文件或文件夹</li>
        )}
      </ul>
    </div>
  );
}
