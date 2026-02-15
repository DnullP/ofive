/**
 * Dockview 布局组件
 *
 * @module components/layout/DockviewLayout
 * @description 基于 dockview-core 的 VS Code 风格布局系统
 *
 * 布局结构:
 * - 活动栏: 最左侧图标栏
 * - 左侧边栏: 可折叠的面板容器 (使用 PaneviewComponent)
 * - 中间区域: dockview 标签页区域 (使用 DockviewComponent)
 * - 右侧边栏: 可折叠的面板容器 (使用 PaneviewComponent)
 */

import { Component, onMount, onCleanup, Show, For, createSignal, createEffect, untrack } from 'solid-js';
import {
    DockviewComponent,
    PaneviewComponent,
    type IContentRenderer,
    type GroupPanelPartInitParameters,
    type IWatermarkRenderer,
    type WatermarkRendererInitParameters,
    type IPanePart,
    type PanePanelComponentInitParameter,
    type PaneviewDropEvent,
    type PaneviewDndOverlayEvent,
} from 'dockview-core';
import { open } from '@tauri-apps/plugin-dialog';
import { objectStore, vaultStore, uiStore, editorStore, commandStore } from '@/stores';
import { logger } from '@/utils';
import { showNativeContextMenu, menuAction, menuSeparator, shortcutService } from '@/services';
import { MilkdownEditor } from '@/components/editor';
import { ImageRenderer, BinaryRenderer, TaskRenderer } from '@/components/renderers';
import { SettingsModal } from '@/components/settings';
import { FileTree } from './FileTree';
import './DockviewLayout.css';

// 图标导入
import folderIcon from '@/assets/icons/folder_black.svg';
import searchIcon from '@/assets/icons/search_black.svg';
import graphIcon from '@/assets/icons/graph_black.svg';

// ============================================================================
// 类型定义
// ============================================================================

type SidebarView = 'files' | 'search' | 'graph' | 'tags';

// 面板配置类型
interface PanelConfig {
    id: string;
    component: string;
    title: string;
}

// Activity Bar 项目配置
interface ActivityBarItem {
    id: SidebarView;
    /** 图标：可以是 SVG URL 或 emoji 字符串 */
    icon: string;
    /** 是否为 SVG 图标（true 时渲染为 img 元素） */
    isSvgIcon?: boolean;
    title: string;
    /** 该活动对应的面板组配置 */
    panels: { id: string; component: string; title: string; expanded?: boolean }[];
    /** 可选的点击动作（用于扩展功能，如打开设置、创建面板等） */
    action?: () => void;
}

// Activity Bar 面板组配置
const ACTIVITY_PANEL_GROUPS: ActivityBarItem[] = [
    {
        id: 'files',
        icon: folderIcon,
        isSvgIcon: true,
        title: '资源管理器',
        panels: [
            { id: 'files-panel', component: 'files', title: '文件', expanded: true },
            { id: 'outline-panel', component: 'outline', title: '大纲', expanded: false },
        ],
    },
    {
        id: 'search',
        icon: searchIcon,
        isSvgIcon: true,
        title: '搜索',
        panels: [
            { id: 'search-panel', component: 'search', title: '搜索', expanded: true },
        ],
    },
    {
        id: 'graph',
        icon: graphIcon,
        isSvgIcon: true,
        title: '图谱',
        panels: [
            { id: 'graph-panel', component: 'graph', title: '知识图谱', expanded: true },
        ],
    },
    {
        id: 'tags',
        icon: '🏷️',
        title: '标签',
        panels: [
            { id: 'tags-panel', component: 'tags', title: '标签列表', expanded: true },
        ],
    },
];

// ============================================================================
// 全局状态
// ============================================================================

// Dockview API 引用
let dockviewApi: DockviewComponent | null = null;
// Paneview 实例引用（用于跨 sidebar 拖拽）
let leftPaneview: PaneviewComponent | null = null;
let rightPaneview: PaneviewComponent | null = null;

// 面板配置映射（用于跨 sidebar 重建面板）
const panelConfigs: Map<string, PanelConfig> = new Map();

// ============================================================================
// 面板内容渲染器
// ============================================================================

/**
 * 创建 SolidJS 面板渲染器
 */
function createSolidRenderer(
    renderContent: (container: HTMLElement, params: Record<string, unknown>) => (() => void) | void
): IContentRenderer {
    let _container: HTMLElement | null = null;
    let _cleanup: (() => void) | void = undefined;

    return {
        element: document.createElement('div'),
        init(params: GroupPanelPartInitParameters): void {
            _container = this.element;
            _container.className = 'dockview-panel-content';
            _cleanup = renderContent(_container, params.params as Record<string, unknown>);
        },
        update(): void {
            // SolidJS 响应式系统会自动处理更新
        },
        dispose(): void {
            if (_cleanup) _cleanup();
            if (_container) _container.innerHTML = '';
        },
    };
}

/**
 * 判断是否为 Markdown 类型对象
 */
function isMarkdownType(objectType: string): boolean {
    const markdownTypes = ['note', 'daily', 'task', 'person', 'book', 'project'];
    return markdownTypes.includes(objectType);
}

/**
 * 查看器面板渲染器工厂
 * 根据对象类型选择不同的渲染器：
 * - Markdown 类型 → MilkdownEditor
 * - 图片类型 → ImageRenderer
 * - 其他类型 → BinaryRenderer
 * 
 * @description
 *   重要：编辑器组件使用 untrack 避免响应式依赖 objectStore，
 *   这样 objectStore 的缓存更新（如保存后调用 updateContentInCache）
 *   不会触发编辑器重新渲染，避免用户输入被打断、光标位置丢失。
 */
function createViewerRenderer(): IContentRenderer {
    return createSolidRenderer((container, params) => {
        const objectId = params.objectId as string;
        if (!objectId) {
            container.innerHTML = '<div class="empty-state">无效的对象ID</div>';
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'viewer-panel-wrapper';
        container.appendChild(wrapper);

        let dispose: (() => void) | undefined;

        import('solid-js/web').then(({ render }) => {
            // 原生菜单不需要 ContextMenuProvider
            dispose = render(() => <ViewerPanelContent objectId={objectId} />, wrapper);
        }).catch(console.error);

        return () => {
            if (dispose) dispose();
        };
    });
}

/**
 * ViewerPanel 内容组件
 *
 * @description 独立组件以支持 ContextMenuProvider 包裹
 */
const ViewerPanelContent: Component<{ objectId: string }> = (props) => {
    // 使用 untrack 获取初始对象数据，避免建立响应式依赖
    // 这样 objectStore.objects() 变化时不会触发编辑器重新渲染
    const initialObj = untrack(() => objectStore.objects().find((o) => o.id === props.objectId));

    // 用信号追踪加载状态，只在初始加载时显示 loading
    const [objData, setObjData] = createSignal(initialObj);
    const [isLoading, setIsLoading] = createSignal(!initialObj);

    // 如果初始没有数据，等待对象加载
    if (!initialObj) {
        createEffect(() => {
            const obj = objectStore.objects().find((o) => o.id === props.objectId);
            if (obj && isLoading()) {
                // 只在首次加载时更新，之后不再响应
                setObjData(obj);
                setIsLoading(false);
                logger.debug('DockviewLayout', `Object loaded for viewer: ${props.objectId}`);
            }
        });
    }

    return (
        <Show when={!isLoading()} fallback={<div class="loading">加载中...</div>}>
            <Show when={objData()} fallback={<div class="empty-state">对象不存在</div>}>
                {(object) => {
                    // 使用 untrack 确保这里不建立响应式依赖
                    const data = untrack(() => object());

                    // Task 类型 → TaskRenderer（专用渲染器）
                    if (data.object_type === 'task') {
                        return <TaskRenderer object={data} />;
                    }

                    // 其他 Markdown 类型 → Milkdown 编辑器
                    if (isMarkdownType(data.object_type)) {
                        // 注册编辑器到 editorStore
                        editorStore.registerEditor(data.id, data.content ?? '');

                        // 编辑器卸载时注销
                        onCleanup(() => {
                            // 注销时会自动保存未保存的更改
                            void editorStore.unregisterEditor(data.id, true);
                        });

                        return (
                            <MilkdownEditor
                                objectId={data.id}
                                initialContent={data.content ?? ''}
                                onChange={(content) => {
                                    logger.debug('DockviewLayout', `Content changed for ${data.id}: ${content.length} chars`);
                                    // 通知 editorStore 内容变更，触发自动保存
                                    editorStore.updateContent(data.id, content);
                                }}
                            />
                        );
                    }

                    // 图片类型 → ImageRenderer
                    if (data.object_type === 'image') {
                        return <ImageRenderer object={data} />;
                    }

                    // 其他类型 → BinaryRenderer
                    return <BinaryRenderer object={data} />;
                }}
            </Show>
        </Show>
    );
};

/**
 * 水印组件 (无面板时显示)
 */
function createWatermarkRenderer(): IWatermarkRenderer {
    const element = document.createElement('div');
    element.className = 'dockview-watermark';

    return {
        element,
        init(_params: WatermarkRendererInitParameters): void {
            element.innerHTML = `
        <div class="watermark-content">
          <h2>欢迎使用 Sharpen</h2>
          <p>从左侧文件树选择文件开始</p>
        </div>
      `;
        },
        dispose(): void {
            element.innerHTML = '';
        },
    };
}

// ============================================================================
// Paneview 面板渲染器
// ============================================================================

/**
 * 创建 Pane 面板体渲染器
 */
function createPaneBodyRenderer(
    renderContent: (container: HTMLElement) => (() => void) | void
): IPanePart {
    let _container: HTMLElement | null = null;
    let _cleanup: (() => void) | void = undefined;

    return {
        element: document.createElement('div'),
        init(_params: PanePanelComponentInitParameter): void {
            _container = this.element;
            _container.className = 'pane-body-content';
            _cleanup = renderContent(_container);
        },
        update(): void { },
        dispose(): void {
            if (_cleanup) _cleanup();
            if (_container) _container.innerHTML = '';
        },
    };
}

/**
 * 创建 Pane 面板头渲染器
 */
function createPaneHeaderRenderer(title: string): IPanePart {
    const element = document.createElement('div');
    element.className = 'pane-header-content';
    element.innerHTML = `<span class="pane-title">${title}</span>`;

    return {
        element,
        init(_params: PanePanelComponentInitParameter): void { },
        update(): void { },
        dispose(): void { },
    };
}

// ============================================================================
// 跨 Sidebar 拖拽处理
// ============================================================================

/**
 * 处理来自其他 sidebar 的拖拽悬停事件
 * 返回 true 表示接受该拖拽
 */
function handleUnhandledDragOver(event: PaneviewDndOverlayEvent, targetPaneview: PaneviewComponent): boolean {
    const data = event.getData();
    logger.debug('DockviewLayout', `[DragOver] Received unhandled drag event, data: ${JSON.stringify(data)}, targetPaneviewId: ${targetPaneview.id}`);

    if (!data) {
        logger.debug('DockviewLayout', '[DragOver] No data in event');
        return false;
    }

    // 检查是否来自另一个 paneview
    if (data.viewId === targetPaneview.id) {
        logger.debug('DockviewLayout', '[DragOver] Same paneview, not accepting');
        return false; // 同一个 paneview 内的拖拽由默认逻辑处理
    }

    // 检查是否是有效的面板
    const config = panelConfigs.get(data.paneId);
    logger.debug('DockviewLayout', `[DragOver] Panel config for ${data.paneId}: ${JSON.stringify(config)}`);

    if (config) {
        logger.info('DockviewLayout', `[DragOver] Accepting drag from paneview ${data.viewId} for panel ${data.paneId}`);
        event.accept();
        return true;
    }
    logger.debug('DockviewLayout', '[DragOver] Config not found, not accepting');
    return false;
}

/**
 * 处理跨 sidebar 的面板放置
 */
function handleCrossSidebarDrop(
    event: PaneviewDropEvent,
    targetPaneview: PaneviewComponent,
    sourcePaneview: PaneviewComponent | null
): void {
    const data = event.getData();
    logger.info('DockviewLayout', `[Drop] Received drop event, data: ${JSON.stringify(data)}, position: ${event.position}`);

    if (!data) {
        logger.warn('DockviewLayout', '[Drop] No data in drop event');
        return;
    }

    // 只处理跨 sidebar 的拖拽
    if (data.viewId === targetPaneview.id) {
        logger.debug('DockviewLayout', '[Drop] Same paneview, ignoring (handled by dockview)');
        return;
    }

    const panelId = data.paneId;
    const config = panelConfigs.get(panelId);
    if (!config) {
        logger.warn('DockviewLayout', `[Drop] Panel config not found for ${panelId}`);
        return;
    }

    logger.info('DockviewLayout', `[Drop] Moving panel ${panelId} from paneview ${data.viewId} to ${targetPaneview.id}`);

    // 从源 paneview 移除面板
    if (sourcePaneview) {
        const sourcePanel = sourcePaneview.getPanel(panelId);
        if (sourcePanel) {
            logger.debug('DockviewLayout', `[Drop] Removing panel ${panelId} from source paneview`);
            sourcePaneview.removePanel(sourcePanel);
        } else {
            logger.warn('DockviewLayout', `[Drop] Panel ${panelId} not found in source paneview`);
        }
    } else {
        logger.warn('DockviewLayout', '[Drop] Source paneview is null');
    }

    // 计算目标位置
    const targetPanel = event.panel;
    const allPanels = targetPaneview.panels;
    let targetIndex = allPanels.findIndex(p => p.id === targetPanel.id);

    if (event.position === 'bottom') {
        targetIndex += 1;
    }
    targetIndex = Math.max(0, Math.min(allPanels.length, targetIndex));

    logger.info('DockviewLayout', `[Drop] Adding panel ${panelId} at index ${targetIndex}`);

    // 在目标 paneview 添加面板
    targetPaneview.addPanel({
        id: config.id,
        component: config.component,
        title: config.title,
        isExpanded: true,
        index: targetIndex,
    });

    logger.info('DockviewLayout', `[Drop] Panel ${panelId} moved successfully`);
}

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 打开查看器标签
 */
function openViewerTab(objectId: string, title: string): void {
    if (!dockviewApi) {
        logger.warn('DockviewLayout', 'Dockview API not initialized');
        return;
    }

    // 检查是否已存在该面板
    const existingPanel = dockviewApi.api.getPanel(objectId);
    if (existingPanel) {
        existingPanel.api.setActive();
        return;
    }

    // 添加新面板
    dockviewApi.api.addPanel({
        id: objectId,
        component: 'viewer',
        title: title,
        params: { objectId },
    });
}

// ============================================================================
// 活动栏组件
// ============================================================================

const ActivityBar: Component<{
    activeView: SidebarView;
    leftSidebarVisible: boolean;
    rightSidebarVisible: boolean;
    onViewSelect: (view: SidebarView) => void;
    onToggleLeft: () => void;
    onToggleRight: () => void;
}> = (props) => {
    // 使用全局面板组配置
    const items = ACTIVITY_PANEL_GROUPS;

    const handleItemClick = (item: ActivityBarItem) => {
        // 首先执行自定义动作（如果有）
        if (item.action) {
            item.action();
        }

        // 然后处理面板组切换逻辑
        if (props.activeView === item.id && props.leftSidebarVisible) {
            // 点击已激活的项目：折叠侧边栏
            props.onToggleLeft();
        } else {
            // 点击不同项目：切换到该面板组
            props.onViewSelect(item.id);
            if (!props.leftSidebarVisible) {
                props.onToggleLeft();
            }
        }
    };

    return (
        <div class="activity-bar">
            <div class="activity-bar-top">
                <For each={items}>
                    {(item) => (
                        <button
                            class="activity-bar-item"
                            classList={{ active: props.activeView === item.id && props.leftSidebarVisible }}
                            onClick={() => handleItemClick(item)}
                            title={item.title}
                        >
                            {item.isSvgIcon ? (
                                <img src={item.icon} alt={item.title} class="activity-bar-icon" />
                            ) : (
                                item.icon
                            )}
                        </button>
                    )}
                </For>
            </div>
            <div class="activity-bar-bottom">
                {/* 设置按钮 */}
                <button
                    class="activity-bar-item"
                    classList={{ active: uiStore.settingsOpen() }}
                    onClick={() => uiStore.openSettings()}
                    title="设置"
                >
                    ⚙️
                </button>
                <button
                    class="activity-bar-item"
                    classList={{ active: props.rightSidebarVisible }}
                    onClick={props.onToggleRight}
                    title="切换右侧边栏"
                >
                    📊
                </button>
            </div>
        </div>
    );
};

// ============================================================================
// 侧边栏面板内容
// ============================================================================

/**
 * 文件浏览器面板
 */
const FileExplorerPanel: Component = () => {
    return (
        <div class="sidebar-panel file-explorer">
            <FileTree />
        </div>
    );
};

/**
 * 搜索面板
 */
const SearchPanel: Component = () => {
    return (
        <div class="sidebar-panel search-panel">
            <div class="placeholder">搜索 (待实现)</div>
        </div>
    );
};

/**
 * 图谱面板
 */
const GraphPanel: Component = () => {
    return (
        <div class="sidebar-panel graph-panel">
            <div class="placeholder">图谱视图 (待实现)</div>
        </div>
    );
};

/**
 * 标签面板
 */
const TagsPanel: Component = () => {
    return (
        <div class="sidebar-panel tags-panel">
            <div class="placeholder">标签列表 (待实现)</div>
        </div>
    );
};

/**
 * 大纲面板
 */
const OutlinePanel: Component = () => {
    return (
        <div class="sidebar-panel outline-panel">
            <div class="placeholder">大纲 (待实现)</div>
        </div>
    );
};

// ============================================================================
// 欢迎视图
// ============================================================================

const WelcomeView: Component = () => {
    async function handleOpenVault(): Promise<void> {
        logger.info('DockviewLayout', '🔓 handleOpenVault called');
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: '选择 Vault 目录',
            });

            if (selected && typeof selected === 'string') {
                logger.info('DockviewLayout', `🚀 Opening vault at: ${selected}`);
                await vaultStore.openVault(selected);
                if (vaultStore.isOpen()) {
                    logger.info('DockviewLayout', '✅ Vault opened, loading objects...');
                    await objectStore.loadObjects();
                }
            }
        } catch (e) {
            logger.error('DockviewLayout', 'Error opening vault', e);
        }
    }

    return (
        <div class="welcome-view">
            <div class="welcome-content">
                <h1 class="welcome-title">欢迎使用 Sharpen</h1>
                <p class="welcome-description">
                    一个受 Obsidian 和 Capacities 启发的知识管理应用。
                    <br />
                    核心理念：万物皆对象。
                </p>
                <div class="welcome-actions">
                    <button class="btn btn-primary" onClick={() => void handleOpenVault()}>
                        打开 Vault
                    </button>
                    <button class="btn btn-secondary">创建新 Vault</button>
                </div>
                <Show when={vaultStore.error()}>
                    <div class="error-message" role="alert">
                        {vaultStore.error()}
                    </div>
                </Show>
            </div>
        </div>
    );
};

// ============================================================================
// 左侧边栏
// ============================================================================

const LeftSidebar: Component<{
    visible: boolean;
    width: number;
    activeView: SidebarView;
    onWidthChange: (width: number) => void;
}> = (props) => {
    let containerRef: HTMLDivElement | undefined;
    let paneview: PaneviewComponent | null = null;
    let resizing = false;
    let startX = 0;
    let startWidth = 0;

    // 创建组件的工厂函数
    const createComponent = (options: { name: string }): IPanePart => {
        switch (options.name) {
            case 'files':
                return createPaneBodyRenderer((container) => {
                    let dispose: (() => void) | undefined;
                    import('solid-js/web').then(({ render }) => {
                        // 原生菜单不需要 ContextMenuProvider
                        dispose = render(() => <FileExplorerPanel />, container);
                    }).catch(console.error);
                    return () => { if (dispose) dispose(); };
                });
            case 'search':
                return createPaneBodyRenderer((container) => {
                    let dispose: (() => void) | undefined;
                    import('solid-js/web').then(({ render }) => {
                        dispose = render(() => <SearchPanel />, container);
                    }).catch(console.error);
                    return () => { if (dispose) dispose(); };
                });
            case 'graph':
                return createPaneBodyRenderer((container) => {
                    let dispose: (() => void) | undefined;
                    import('solid-js/web').then(({ render }) => {
                        dispose = render(() => <GraphPanel />, container);
                    }).catch(console.error);
                    return () => { if (dispose) dispose(); };
                });
            case 'tags':
                return createPaneBodyRenderer((container) => {
                    let dispose: (() => void) | undefined;
                    import('solid-js/web').then(({ render }) => {
                        dispose = render(() => <TagsPanel />, container);
                    }).catch(console.error);
                    return () => { if (dispose) dispose(); };
                });
            case 'outline':
                return createPaneBodyRenderer((container) => {
                    let dispose: (() => void) | undefined;
                    import('solid-js/web').then(({ render }) => {
                        dispose = render(() => <OutlinePanel />, container);
                    }).catch(console.error);
                    return () => { if (dispose) dispose(); };
                });
            default:
                return createPaneBodyRenderer((container) => {
                    container.innerHTML = `<div class="placeholder">未知面板: ${options.name}</div>`;
                });
        }
    };

    const createHeaderComponent = (options: { name: string }): IPanePart => {
        const titles: Record<string, string> = {
            files: '文件', search: '搜索', graph: '图谱', tags: '标签', outline: '大纲'
        };
        return createPaneHeaderRenderer(titles[options.name] ?? options.name);
    };

    // 根据 activeView 获取当前面板组配置
    const getCurrentPanelGroup = (): ActivityBarItem => {
        return ACTIVITY_PANEL_GROUPS.find((g) => g.id === props.activeView) ?? ACTIVITY_PANEL_GROUPS[0]!;
    };

    // 切换面板组
    const switchPanelGroup = (pv: PaneviewComponent) => {
        const group = getCurrentPanelGroup();

        // 移除现有所有面板
        const currentPanels = [...pv.panels];
        for (const panel of currentPanels) {
            pv.removePanel(panel);
        }

        // 添加新面板组的面板
        for (const panelConfig of group.panels) {
            panelConfigs.set(panelConfig.id, {
                id: panelConfig.id,
                component: panelConfig.component,
                title: panelConfig.title,
            });

            pv.addPanel({
                id: panelConfig.id,
                component: panelConfig.component,
                title: panelConfig.title,
                isExpanded: panelConfig.expanded ?? true,
            });
        }

        logger.info('DockviewLayout', `[LeftSidebar] Switched to panel group: ${group.id}`);
    };

    onMount(() => {
        if (!containerRef) return;

        // 创建 Paneview 实例
        paneview = new PaneviewComponent(containerRef, {
            createComponent,
            createHeaderComponent,
            disableDnd: false,
            className: 'sidebar-paneview-container',
        });

        leftPaneview = paneview;

        // 初始化：加载当前面板组
        switchPanelGroup(paneview);

        // 监听来自其他 sidebar 的拖拽
        paneview.onUnhandledDragOverEvent((event) => {
            logger.info('DockviewLayout', `[LeftSidebar] onUnhandledDragOverEvent triggered`);
            handleUnhandledDragOver(event, paneview!);
        });

        // 处理跨 sidebar 放置
        paneview.onDidDrop((event) => {
            logger.info('DockviewLayout', `[LeftSidebar] onDidDrop triggered`);
            handleCrossSidebarDrop(event, paneview!, rightPaneview);
        });

        logger.info('DockviewLayout', `[LeftSidebar] Paneview created with id: ${paneview.id}`);

        // 初始布局 - 如果可见
        if (props.visible) {
            paneview.layout(props.width, containerRef.clientHeight);
        }
    });

    onCleanup(() => {
        paneview?.dispose();
        leftPaneview = null;
    });

    // 响应宽度和可见性变化
    createEffect(() => {
        const width = props.width;
        const visible = props.visible;
        if (paneview && containerRef && visible) {
            paneview.layout(width, containerRef.clientHeight);
        }
    });

    // 响应 activeView 变化：切换面板组
    let lastActiveView: SidebarView | null = null;
    createEffect(() => {
        const view = props.activeView;
        // 只有在视图真正变化时才切换
        if (paneview && view !== lastActiveView) {
            lastActiveView = view;
            switchPanelGroup(paneview);
        }
    });

    // 处理拖拽调整大小
    const handleMouseDown = (e: MouseEvent) => {
        resizing = true;
        startX = e.clientX;
        startWidth = props.width;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!resizing) return;
        const diff = e.clientX - startX;
        const newWidth = Math.max(200, Math.min(600, startWidth + diff));
        props.onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
        resizing = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    return (
        <div
            class="left-sidebar"
            style={{
                width: props.visible ? `${props.width}px` : '0px',
                display: props.visible ? 'flex' : 'none'
            }}
        >
            <div class="sidebar-header">
                <span class="sidebar-title">
                    {getCurrentPanelGroup().title}
                </span>
            </div>
            <div ref={containerRef} class="sidebar-paneview" />
            <div class="sidebar-resize-handle" onMouseDown={handleMouseDown} />
        </div>
    );
};

// ============================================================================
// 右侧边栏
// ============================================================================

const RightSidebar: Component<{
    visible: boolean;
    width: number;
    onWidthChange: (width: number) => void;
}> = (props) => {
    let containerRef: HTMLDivElement | undefined;
    let paneview: PaneviewComponent | null = null;
    let resizing = false;
    let startX = 0;
    let startWidth = 0;

    // 创建组件的工厂函数
    const createComponent = (options: { name: string }): IPanePart => {
        switch (options.name) {
            case 'graph':
                return createPaneBodyRenderer((container) => {
                    let dispose: (() => void) | undefined;
                    import('solid-js/web').then(({ render }) => {
                        dispose = render(() => <GraphPanel />, container);
                    }).catch(console.error);
                    return () => { if (dispose) dispose(); };
                });
            case 'tags':
                return createPaneBodyRenderer((container) => {
                    let dispose: (() => void) | undefined;
                    import('solid-js/web').then(({ render }) => {
                        dispose = render(() => <TagsPanel />, container);
                    }).catch(console.error);
                    return () => { if (dispose) dispose(); };
                });
            // 支持来自左侧 sidebar 的面板
            case 'files':
                return createPaneBodyRenderer((container) => {
                    let dispose: (() => void) | undefined;
                    import('solid-js/web').then(({ render }) => {
                        // 原生菜单不需要 ContextMenuProvider
                        dispose = render(() => <FileExplorerPanel />, container);
                    }).catch(console.error);
                    return () => { if (dispose) dispose(); };
                });
            case 'search':
                return createPaneBodyRenderer((container) => {
                    let dispose: (() => void) | undefined;
                    import('solid-js/web').then(({ render }) => {
                        dispose = render(() => <SearchPanel />, container);
                    }).catch(console.error);
                    return () => { if (dispose) dispose(); };
                });
            default:
                return createPaneBodyRenderer((container) => {
                    container.innerHTML = `<div class="placeholder">未知面板: ${options.name}</div>`;
                });
        }
    };

    const createHeaderComponent = (options: { name: string }): IPanePart => {
        const titles: Record<string, string> = {
            files: '文件', search: '搜索', graph: '图谱', tags: '标签'
        };
        return createPaneHeaderRenderer(titles[options.name] ?? options.name);
    };

    onMount(() => {
        if (!containerRef) return;

        paneview = new PaneviewComponent(containerRef, {
            createComponent,
            createHeaderComponent,
            disableDnd: false,
            className: 'sidebar-paneview-container',
        });

        rightPaneview = paneview;

        // 注册面板配置
        panelConfigs.set('graph-panel', { id: 'graph-panel', component: 'graph', title: '图谱' });
        panelConfigs.set('tags-panel', { id: 'tags-panel', component: 'tags', title: '标签' });

        paneview.addPanel({
            id: 'graph-panel',
            component: 'graph',
            title: '图谱',
            isExpanded: true,
        });

        paneview.addPanel({
            id: 'tags-panel',
            component: 'tags',
            title: '标签',
            isExpanded: false,
        });

        // 调试：检查面板的拖拽状态
        setTimeout(() => {
            const panels = paneview?.panels ?? [];
            panels.forEach((panel: unknown) => {
                const p = panel as { id: string; element: HTMLElement };
                const header = p.element?.querySelector('.dv-pane-header') as HTMLElement | null;
                logger.info('DockviewLayout', `[Debug Right] Panel ${p.id}: header exists=${!!header}, draggable=${header?.draggable}, header.className=${header?.className}`);
            });
        }, 100);

        // 监听来自其他 sidebar 的拖拽
        paneview.onUnhandledDragOverEvent((event) => {
            logger.info('DockviewLayout', `[RightSidebar] onUnhandledDragOverEvent triggered`);
            handleUnhandledDragOver(event, paneview!);
        });

        // 处理跨 sidebar 放置
        paneview.onDidDrop((event) => {
            logger.info('DockviewLayout', `[RightSidebar] onDidDrop triggered`);
            handleCrossSidebarDrop(event, paneview!, leftPaneview);
        });

        logger.info('DockviewLayout', `[RightSidebar] Paneview created with id: ${paneview.id}`);

        // 初始布局 - 如果可见
        if (props.visible) {
            paneview.layout(props.width, containerRef.clientHeight);
        }
    });

    onCleanup(() => {
        paneview?.dispose();
        rightPaneview = null;
    });

    // 响应宽度和可见性变化
    createEffect(() => {
        const width = props.width;
        const visible = props.visible;
        if (paneview && containerRef && visible) {
            paneview.layout(width, containerRef.clientHeight);
        }
    });

    const handleMouseDown = (e: MouseEvent) => {
        resizing = true;
        startX = e.clientX;
        startWidth = props.width;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!resizing) return;
        const diff = startX - e.clientX;
        const newWidth = Math.max(200, Math.min(600, startWidth + diff));
        props.onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
        resizing = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    return (
        <div
            class="right-sidebar"
            style={{
                width: props.visible ? `${props.width}px` : '0px',
                display: props.visible ? 'flex' : 'none'
            }}
        >
            <div class="sidebar-resize-handle left" onMouseDown={handleMouseDown} />
            <div class="sidebar-header">
                <span class="sidebar-title">面板</span>
            </div>
            <div ref={containerRef} class="sidebar-paneview" />
        </div>
    );
};

// ============================================================================
// 主内容区域（Dockview）
// ============================================================================

const MainDockview: Component = () => {
    let containerRef: HTMLDivElement | undefined;

    /**
     * 处理 tab 右键菜单
     *
     * @description 监听 dockview 容器的 contextmenu 事件
     *   - 通过 DOM 结构找到被点击的 tab
     *   - 显示原生右键菜单
     */
    const handleTabContextMenu = (e: MouseEvent) => {
        // 检查是否点击在 tab 上
        const target = e.target as HTMLElement;
        const tabElement = target.closest('.dv-default-tab');
        if (!tabElement) return;

        e.preventDefault();
        e.stopPropagation();

        // 通过 tab 元素找到对应的面板 ID
        // dockview 的 tab 结构：.dv-default-tab > [data-testid="dockview-..."] 或通过 panel ID
        const tabContainer = tabElement.closest('.dv-tab');
        if (!tabContainer || !dockviewApi) return;

        // 获取 tab 在 group 中的索引来找到面板
        const tabsContainer = tabContainer.parentElement;
        if (!tabsContainer) return;

        const tabs = Array.from(tabsContainer.querySelectorAll('.dv-tab'));
        const tabIndex = tabs.indexOf(tabContainer);
        if (tabIndex === -1) return;

        // 找到包含这个 tab 的 group
        const groupElement = tabContainer.closest('.dv-groupview');
        if (!groupElement) return;

        // 遍历所有 groups 找到对应的面板
        let targetPanelId: string | null = null;
        for (const group of dockviewApi.api.groups) {
            // 检查这个 group 的容器是否是我们的 groupElement
            if (group.element === groupElement || group.element.contains(groupElement)) {
                const panel = group.panels[tabIndex];
                if (panel) {
                    targetPanelId = panel.id;
                }
                break;
            }
        }

        if (!targetPanelId) {
            logger.warn('DockviewLayout', 'Could not find panel for tab');
            return;
        }

        logger.debug('DockviewLayout', `Tab context menu for panel: ${targetPanelId}`);

        // 获取所有面板数量（用于判断是否显示某些菜单项）
        const allPanels = dockviewApi.api.panels;
        const panelCount = allPanels.length;

        // 构建菜单项
        const menuItems = [
            menuAction('close', '关闭', () => {
                const panel = dockviewApi?.api.getPanel(targetPanelId!);
                if (panel) {
                    panel.api.close();
                }
            }),
            menuAction('close-others', '关闭其他', () => {
                for (const panel of [...allPanels]) {
                    if (panel.id !== targetPanelId) {
                        panel.api.close();
                    }
                }
            }, panelCount <= 1),
            menuAction('close-all', '关闭全部', () => {
                for (const panel of [...allPanels]) {
                    panel.api.close();
                }
            }),
            menuSeparator(),
            menuAction('close-saved', '关闭已保存', () => {
                // TODO: 实现关闭已保存的逻辑（需要追踪编辑状态）
                logger.info('DockviewLayout', 'Close saved tabs (TODO)');
            }),
        ];

        void showNativeContextMenu(e.clientX, e.clientY, menuItems);
    };

    onMount(() => {
        if (!containerRef) return;

        const dockview = new DockviewComponent(containerRef, {
            createComponent: (options) => {
                switch (options.name) {
                    case 'viewer':
                        return createViewerRenderer();
                    default:
                        return createSolidRenderer((container) => {
                            container.innerHTML = `<div class="empty-state">未知组件: ${options.name}</div>`;
                        });
                }
            },
            createWatermarkComponent: createWatermarkRenderer,
            disableFloatingGroups: false,
            floatingGroupBounds: 'boundedWithinViewport',
        });

        dockviewApi = dockview;

        // 添加 tab 右键菜单事件监听
        containerRef.addEventListener('contextmenu', handleTabContextMenu);

        // 监听活跃面板变化，同步到 uiStore
        // 这使得侧边栏面板（如 FileTree）能响应 tab 切换
        const activePanelDisposable = dockview.api.onDidActivePanelChange((panel) => {
            if (panel) {
                // 面板 ID 就是 objectId
                const objectId = panel.id;
                logger.debug('DockviewLayout', `Active panel changed: ${objectId}`);
                uiStore.setActiveTab(objectId);
            } else {
                uiStore.setActiveTab(null);
            }
        });

        // 处理窗口大小变化
        const resizeObserver = new ResizeObserver(() => {
            if (containerRef) {
                dockview.api.layout(containerRef.clientWidth, containerRef.clientHeight);
            }
        });
        resizeObserver.observe(containerRef);

        onCleanup(() => {
            containerRef?.removeEventListener('contextmenu', handleTabContextMenu);
            activePanelDisposable.dispose();
            resizeObserver.disconnect();
            dockview.dispose();
            dockviewApi = null;
        });
    });

    return <div ref={containerRef} class="main-dockview" />;
};

// ============================================================================
// 主布局组件
// ============================================================================

export const DockviewLayout: Component = () => {
    // 侧边栏状态
    const [leftSidebarVisible, setLeftSidebarVisible] = createSignal(true);
    const [leftSidebarWidth, setLeftSidebarWidth] = createSignal(280);
    const [rightSidebarVisible, setRightSidebarVisible] = createSignal(false);
    const [rightSidebarWidth, setRightSidebarWidth] = createSignal(280);
    const [activeView, setActiveView] = createSignal<SidebarView>('files');

    // ========================================================================
    // 快捷键操作
    // ========================================================================

    /**
     * 关闭当前活动的 Tab
     * 
     * @description 关闭当前获得焦点的编辑器标签。
     *   关闭前会先清除 objectStore.current()，避免 createEffect 重新打开 tab。
     */
    const closeCurrentTab = (): void => {
        if (!dockviewApi) {
            logger.warn('DockviewLayout', 'Cannot close tab: dockviewApi not initialized');
            return;
        }

        const activePanel = dockviewApi.api.activePanel;
        if (activePanel) {
            const panelId = activePanel.id;
            logger.debug('DockviewLayout', `Closing active tab: ${panelId}`);

            // 如果关闭的是当前选中的对象，先清除 current
            // 这样 createEffect 不会在 tab 关闭后尝试重新打开它
            if (objectStore.current()?.id === panelId) {
                objectStore.setCurrent(null);
            }

            activePanel.api.close();
        } else {
            logger.debug('DockviewLayout', 'No active tab to close');
        }
    };

    /**
     * 切换左侧边栏
     */
    const toggleLeftSidebar = (): void => {
        setLeftSidebarVisible((v) => !v);
        logger.debug('DockviewLayout', `Left sidebar toggled`);
    };

    /**
     * 切换右侧边栏
     */
    const toggleRightSidebar = (): void => {
        setRightSidebarVisible((v) => !v);
        logger.debug('DockviewLayout', `Right sidebar toggled`);
    };

    // 初始化快捷键服务
    onMount(() => {
        shortcutService.init({
            'close-current-tab': closeCurrentTab,
            'toggle-left-sidebar': toggleLeftSidebar,
            'toggle-right-sidebar': toggleRightSidebar,
            'toggle-command-palette': () => commandStore.togglePalette(),
            'convert-selection-to-wikilink': () => {
                const currentObjectId = objectStore.current()?.id;
                if (currentObjectId) {
                    editorStore.convertSelectionToWikiLink(currentObjectId);
                }
            },
        });
        logger.info('DockviewLayout', 'Shortcut service initialized');

        // 注册命令到 commandStore
        commandStore.registerAll([
            {
                id: 'close-current-tab',
                name: '关闭当前标签',
                description: '关闭当前获得焦点的编辑器标签',
                category: 'editor',
                execute: closeCurrentTab,
            },
            {
                id: 'toggle-left-sidebar',
                name: '切换左侧边栏',
                description: '显示或隐藏左侧边栏',
                category: 'view',
                execute: toggleLeftSidebar,
            },
            {
                id: 'toggle-right-sidebar',
                name: '切换右侧边栏',
                description: '显示或隐藏右侧边栏',
                category: 'view',
                execute: toggleRightSidebar,
            },
            {
                id: 'convert-selection-to-wikilink',
                name: '转换为 Wiki Link',
                description: '将选中的文本转换为 [[Wiki Link]]',
                category: 'editor',
                execute: () => {
                    const currentObjectId = objectStore.current()?.id;
                    if (currentObjectId) {
                        editorStore.convertSelectionToWikiLink(currentObjectId);
                    }
                },
            },
        ]);
        logger.info('DockviewLayout', 'Commands registered to commandStore');
    });

    onCleanup(() => {
        shortcutService.dispose();
        logger.info('DockviewLayout', 'Shortcut service disposed');
    });

    // 监听对象选择，自动打开查看器
    createEffect(() => {
        const current = objectStore.current();
        if (current && vaultStore.isOpen() && dockviewApi) {
            openViewerTab(current.id, current.common.title ?? '未命名');
        }
    });

    return (
        <div class="dockview-layout">
            {/* 活动栏 */}
            <ActivityBar
                activeView={activeView()}
                leftSidebarVisible={leftSidebarVisible()}
                rightSidebarVisible={rightSidebarVisible()}
                onViewSelect={setActiveView}
                onToggleLeft={toggleLeftSidebar}
                onToggleRight={toggleRightSidebar}
            />

            {/* 左侧边栏 */}
            <LeftSidebar
                visible={leftSidebarVisible()}
                width={leftSidebarWidth()}
                activeView={activeView()}
                onWidthChange={setLeftSidebarWidth}
            />

            {/* 主内容区域 */}
            <div class="main-content-area">
                <Show when={vaultStore.isOpen()} fallback={<WelcomeView />}>
                    <MainDockview />
                </Show>
            </div>

            {/* 右侧边栏 */}
            <RightSidebar
                visible={rightSidebarVisible()}
                width={rightSidebarWidth()}
                onWidthChange={setRightSidebarWidth}
            />

            {/* 设置模态框 */}
            <SettingsModal
                isOpen={uiStore.settingsOpen()}
                onClose={() => uiStore.closeSettings()}
            />
        </div>
    );
};

export default DockviewLayout;
