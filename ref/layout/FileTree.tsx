/**
 * 文件树组件
 *
 * @module components/layout/FileTree
 * @description 以树状结构显示 Vault 中的所有对象，支持文件夹折叠/展开
 * @dependencies
 *   - solid-js - 响应式渲染
 *   - stores - 状态管理
 *
 * @exports
 *   - FileTree - 主组件
 *   - TreeNode - 单个节点（文件夹或文件）
 */

import { Component, For, Show, createSignal, createMemo, createEffect } from 'solid-js';
import { objectStore, uiStore } from '@/stores';
import { showNativeContextMenu, menuAction, menuSeparator, type NativeMenuItem } from '@/services';
import type { SharpenObject } from '@/types';
import { logger } from '@/utils';
import './FileTree.css';

// 图标导入
import folderIcon from '@/assets/icons/folder_black.svg';
import noteIcon from '@/assets/icons/note_black.svg';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 树节点结构
 *
 * 表示文件树中的一个节点，可以是文件夹或文件。
 */
interface TreeNodeData {
  /** 节点名称（文件名或文件夹名） */
  name: string;
  /** 完整路径 */
  path: string;
  /** 是否为文件夹 */
  isFolder: boolean;
  /** 关联的对象（仅文件节点） */
  object: SharpenObject | undefined;
  /** 子节点（仅文件夹） */
  children: TreeNodeData[];
  /** 节点深度（用于缩进） */
  depth: number;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从扁平对象列表构建树结构
 *
 * @param objects - 对象列表
 * @returns 树节点列表（顶层节点）
 */
function buildTree(objects: SharpenObject[]): TreeNodeData[] {
  const root = new Map<string, TreeNodeData>();

  // 按路径排序，确保父文件夹先处理
  const sortedObjects = [...objects].sort((a, b) =>
    a.file_path.localeCompare(b.file_path)
  );

  for (const obj of sortedObjects) {
    const parts = obj.file_path.split('/');
    let currentPath = '';
    let currentChildren = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) continue;

      const isLast = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!currentChildren.has(currentPath)) {
        const node: TreeNodeData = {
          name: part,
          path: currentPath,
          isFolder: !isLast,
          object: isLast ? obj : undefined,
          children: [],
          depth: i,
        };

        // 如果是第一层，添加到 root
        if (i === 0) {
          root.set(currentPath, node);
        } else {
          // 否则添加到父节点
          const parentPath = parts.slice(0, i).join('/');
          const parent = findNode(root, parentPath);
          if (parent) {
            parent.children.push(node);
          }
        }
      }

      // 如果不是最后一个，需要进入子文件夹
      if (!isLast) {
        const node = findNode(root, currentPath);
        if (node) {
          // 转换为 Map 用于后续查找
          currentChildren = new Map(node.children.map((c) => [c.path, c]));
        }
      }
    }
  }

  // 对每个层级排序：文件夹在前，然后按名称排序
  const sortNodes = (nodes: TreeNodeData[]): TreeNodeData[] => {
    return nodes
      .map((node) => ({
        ...node,
        children: sortNodes(node.children),
      }))
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) {
          return a.isFolder ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
  };

  return sortNodes(Array.from(root.values()));
}

/**
 * 在树中查找节点
 */
function findNode(
  nodes: Map<string, TreeNodeData>,
  path: string
): TreeNodeData | undefined {
  const parts = path.split('/');
  let current: TreeNodeData | undefined;

  for (let i = 0; i < parts.length; i++) {
    const currentPath = parts.slice(0, i + 1).join('/');

    if (i === 0) {
      current = nodes.get(currentPath);
    } else if (current) {
      current = current.children.find((c) => c.path === currentPath);
    }

    if (!current) break;
  }

  return current;
}

/**
 * 获取对象类型图标
 * 返回 { src: string, isSvg: boolean } 或 emoji 字符串
 */
function getObjectIcon(type: string): { src: string; isSvg: true } | { emoji: string; isSvg: false } {
  // SVG 图标映射
  const svgIcons: Record<string, string> = {
    note: noteIcon,
  };

  if (svgIcons[type]) {
    return { src: svgIcons[type], isSvg: true };
  }

  // Emoji 图标回退
  const emojiIcons: Record<string, string> = {
    daily: '📅',
    image: '🖼️',
    pdf: '📄',
    canvas: '🎨',
    task: '✅',
    person: '👤',
    book: '📚',
    project: '📊',
    tag: '🏷️',
    folder: '📁',
    binary: '📦',
  };
  return { emoji: emojiIcons[type] ?? '📄', isSvg: false };
}

/**
 * 获取文件夹图标
 */
function getFolderIcon(_isExpanded: boolean): { src: string; isSvg: true } {
  return { src: folderIcon, isSvg: true };
}

// ============================================================================
// 组件
// ============================================================================

/**
 * 树节点组件
 */
const TreeNode: Component<{
  node: TreeNodeData;
  expandedFolders: Set<string>;
  onToggle: (path: string) => void;
  onContextMenu: (e: MouseEvent, node: TreeNodeData) => void;
}> = (props) => {
  const isExpanded = (): boolean => props.expandedFolders.has(props.node.path);

  const handleClick = (): void => {
    if (props.node.isFolder) {
      props.onToggle(props.node.path);
    } else if (props.node.object) {
      void objectStore.selectObject(props.node.object.id);
      uiStore.openTab(props.node.object.id);
    }
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
    // 支持箭头键展开/折叠
    if (props.node.isFolder) {
      if (e.key === 'ArrowRight' && !isExpanded()) {
        e.preventDefault();
        props.onToggle(props.node.path);
      } else if (e.key === 'ArrowLeft' && isExpanded()) {
        e.preventDefault();
        props.onToggle(props.node.path);
      }
    }
  };

  const handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    props.onContextMenu(e, props.node);
  };

  return (
    <li
      role="treeitem"
      aria-expanded={props.node.isFolder ? isExpanded() : undefined}
      aria-selected={props.node.object?.id === uiStore.activeTab()}
    >
      <button
        class="tree-item"
        classList={{
          active: props.node.object?.id === uiStore.activeTab(),
          folder: props.node.isFolder,
        }}
        style={{ 'padding-left': `${String(props.node.depth * 16 + 8)}px` }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        aria-label={
          props.node.isFolder
            ? `${props.node.name} 文件夹，${isExpanded() ? '已展开' : '已折叠'}`
            : props.node.name
        }
      >
        {/* 展开/折叠图标 */}
        <Show when={props.node.isFolder}>
          <span class="tree-chevron" aria-hidden="true">
            {isExpanded() ? '▼' : '▶'}
          </span>
        </Show>

        {/* 文件/文件夹图标 */}
        <span class="tree-icon" aria-hidden="true">
          {(() => {
            if (props.node.isFolder) {
              const icon = getFolderIcon(isExpanded());
              return <img src={icon.src} alt="" class="tree-svg-icon" />;
            }
            const icon = getObjectIcon(props.node.object?.object_type ?? 'note');
            if (icon.isSvg) {
              return <img src={icon.src} alt="" class="tree-svg-icon" />;
            }
            return icon.emoji;
          })()}
        </span>

        {/* 名称 */}
        <span class="tree-name">{props.node.name}</span>
      </button>

      {/* 子节点 */}
      <Show when={props.node.isFolder && isExpanded() && props.node.children.length > 0}>
        <ul class="tree-children" role="group">
          <For each={props.node.children}>
            {(child) => (
              <TreeNode
                node={child}
                expandedFolders={props.expandedFolders}
                onToggle={props.onToggle}
                onContextMenu={props.onContextMenu}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
};

/**
 * 文件树主组件
 */
export const FileTree: Component = () => {
  // 展开的文件夹路径集合
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set());

  // 构建树结构
  const tree = createMemo(() => buildTree(objectStore.objects()));

  // 统计信息
  const stats = createMemo(() => {
    const objects = objectStore.objects();
    const folders = new Set<string>();

    for (const obj of objects) {
      const parts = obj.file_path.split('/');
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join('/'));
      }
    }

    return {
      files: objects.length,
      folders: folders.size,
      total: objectStore.total(),
    };
  });

  // 响应 activeTab 变化：自动展开包含当前文件的文件夹
  createEffect(() => {
    const activeId = uiStore.activeTab();
    if (!activeId) return;

    // 找到对应的对象
    const objects = objectStore.objects();
    const activeObject = objects.find((obj) => obj.id === activeId);
    if (!activeObject) return;

    // 获取文件路径的所有父文件夹
    const parts = activeObject.file_path.split('/');
    const parentFolders: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      parentFolders.push(parts.slice(0, i).join('/'));
    }

    // 展开所有父文件夹
    if (parentFolders.length > 0) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const folder of parentFolders) {
          next.add(folder);
        }
        return next;
      });
    }

    // 滚动到当前文件（延迟执行以确保 DOM 已更新）
    requestAnimationFrame(() => {
      const activeElement = document.querySelector('.file-tree .tree-item.active');
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  // ==========================================================================
  // 右键菜单处理
  // ==========================================================================

  /**
   * 处理节点右键菜单（使用系统原生菜单）
   */
  const handleNodeContextMenu = (e: MouseEvent, node: TreeNodeData): void => {
    const menuItems: NativeMenuItem[] = [];

    if (node.isFolder) {
      // 文件夹右键菜单
      menuItems.push(
        menuAction('new-file', '新建文件', () => {
          logger.info('FileTree', `新建文件在: ${node.path}`);
          // TODO: 实现新建文件对话框
        }),
        menuAction('new-folder', '新建文件夹', () => {
          logger.info('FileTree', `新建文件夹在: ${node.path}`);
          // TODO: 实现新建文件夹对话框
        }),
        menuSeparator(),
        menuAction('expand-all', '展开全部', () => {
          // 展开该文件夹及其所有子文件夹
          const foldersToExpand = new Set<string>();
          const collectFolders = (n: TreeNodeData): void => {
            if (n.isFolder) {
              foldersToExpand.add(n.path);
              n.children.forEach(collectFolders);
            }
          };
          collectFolders(node);
          setExpandedFolders((prev) => {
            const next = new Set(prev);
            foldersToExpand.forEach((f) => next.add(f));
            return next;
          });
        }),
        menuAction('collapse-all', '折叠全部', () => {
          // 折叠该文件夹及其所有子文件夹
          const foldersToCollapse = new Set<string>();
          const collectFolders = (n: TreeNodeData): void => {
            if (n.isFolder) {
              foldersToCollapse.add(n.path);
              n.children.forEach(collectFolders);
            }
          };
          collectFolders(node);
          setExpandedFolders((prev) => {
            const next = new Set(prev);
            foldersToCollapse.forEach((f) => next.delete(f));
            return next;
          });
        })
      );
    } else if (node.object) {
      // 文件右键菜单
      const obj = node.object;

      menuItems.push(
        menuAction('open', '打开', () => {
          void objectStore.selectObject(obj.id);
          uiStore.openTab(obj.id);
        }),
        menuAction('open-split', '在右侧打开', () => {
          // 先打开，然后分裂（需要 dockview API）
          uiStore.openTab(obj.id);
          logger.info('FileTree', `在右侧打开: ${obj.id}`);
          // TODO: 实现分裂视图
        }),
        menuSeparator(),
        menuAction('copy-path', '复制路径', () => {
          void navigator.clipboard.writeText(obj.file_path);
          logger.info('FileTree', `复制路径: ${obj.file_path}`);
        }),
        menuAction('copy-name', '复制文件名', () => {
          const name = obj.file_path.split('/').pop() ?? obj.file_path;
          void navigator.clipboard.writeText(name);
          logger.info('FileTree', `复制文件名: ${name}`);
        }),
        menuSeparator(),
        menuAction('rename', '重命名', () => {
          logger.info('FileTree', `重命名: ${obj.id}`);
          // TODO: 实现重命名对话框
        }),
        menuSeparator(),
        menuAction('delete', '删除', async () => {
          const confirmed = confirm(`确定要删除 "${obj.common.title}" 吗？`);
          if (confirmed) {
            logger.info('FileTree', `删除: ${obj.id}`);
            const success = await objectStore.deleteObject(obj.id);
            if (success) {
              // 如果删除的是当前打开的 tab，关闭它
              if (uiStore.activeTab() === obj.id) {
                uiStore.closeTab(obj.id);
              }
            }
          }
        })
      );
    }

    if (menuItems.length > 0) {
      void showNativeContextMenu(e.clientX, e.clientY, menuItems);
    }
  };

  // 切换文件夹展开状态
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

  // 展开所有文件夹
  const expandAll = (): void => {
    const allFolders = new Set<string>();
    const collectFolders = (nodes: TreeNodeData[]): void => {
      for (const node of nodes) {
        if (node.isFolder) {
          allFolders.add(node.path);
          collectFolders(node.children);
        }
      }
    };
    collectFolders(tree());
    setExpandedFolders(allFolders);
  };

  // 折叠所有文件夹
  const collapseAll = (): void => {
    setExpandedFolders(new Set<string>());
  };

  return (
    <div class="file-tree">
      {/* 工具栏 */}
      <div class="file-tree-toolbar">
        <button
          class="tree-action"
          onClick={expandAll}
          title="展开全部"
          aria-label="展开所有文件夹"
        >
          <span aria-hidden="true">⊞</span>
        </button>
        <button
          class="tree-action"
          onClick={collapseAll}
          title="折叠全部"
          aria-label="折叠所有文件夹"
        >
          <span aria-hidden="true">⊟</span>
        </button>
        <button
          class="tree-action"
          onClick={() => void objectStore.loadObjects({ limit: 10000, offset: 0 })}
          title="刷新"
          aria-label="刷新文件列表"
        >
          🔄
        </button>
        <span class="tree-stats" aria-live="polite">
          {stats().files}/{stats().total} 文件
        </span>
      </div>

      {/* 加载提示 */}
      <Show when={stats().files < stats().total && !objectStore.isLoading()}>
        <div class="tree-loading-hint">
          <button
            class="load-all-btn"
            onClick={() => void objectStore.loadObjects({ limit: 10000, offset: 0 })}
          >
            加载全部 {stats().total} 个文件
          </button>
        </div>
      </Show>

      {/* 树结构 */}
      <Show
        when={!objectStore.isLoading()}
        fallback={<div class="loading">加载中...</div>}
      >
        <ul class="tree-root" role="tree" aria-label="文件浏览器">
          <For each={tree()}>
            {(node) => (
              <TreeNode
                node={node}
                expandedFolders={expandedFolders()}
                onToggle={toggleFolder}
                onContextMenu={handleNodeContextMenu}
              />
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};

export default FileTree;
