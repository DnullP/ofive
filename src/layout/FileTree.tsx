import { useMemo, useState, type ReactNode } from "react";
import "./FileTree.css";

export interface FileTreeItem {
  id: string;
  path: string;
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
        !isLast,
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
  onToggle,
  onOpen,
}: {
  node: TreeNode;
  level: number;
  expanded: Set<string>;
  activePath?: string | null;
  onToggle: (path: string) => void;
  onOpen: (node: TreeNode) => void;
}): ReactNode {
  const isExpanded = expanded.has(node.path);

  const handleClick = (): void => {
    if (node.isFolder) {
      onToggle(node.path);
      return;
    }
    onOpen(node);
  };

  return (
    <li>
      <button
        type="button"
        className={`tree-item ${node.path === activePath ? "active" : ""}`}
        style={{ paddingLeft: `${String(level * 14 + 8)}px` }}
        onClick={handleClick}
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
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FileTree({ items, activePath, onOpenFile }: FileTreeProps): ReactNode {
  const tree = useMemo(() => buildTree(items), [items]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

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
    onOpenFile({ id: node.id, path: node.path });
  };

  return (
    <div className="file-tree">
      <div className="file-tree-header">文件</div>
      <ul className="tree-root">
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            level={0}
            expanded={expandedFolders}
            activePath={activePath}
            onToggle={toggleFolder}
            onOpen={openItem}
          />
        ))}
      </ul>
    </div>
  );
}
