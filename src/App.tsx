import { useEffect, useMemo, type ReactNode } from "react";
import { Compass, FolderOpen, Search, Orbit } from "lucide-react";
import {
  CustomTitlebar,
  DockviewLayout,
  KnowledgeGraphTab,
  OutlinePanel,
  SettingsTab,
  VaultPanel,
  type PanelDefinition,
  type TabComponentDefinition,
  type TabInstanceDefinition,
} from "./layout";
import { CodeMirrorEditorTab } from "./layout/editor/CodeMirrorEditorTab";
import { ImageViewerTab } from "./layout/ImageViewerTab";
import {
  isSelfTriggeredVaultFsEvent,
  readVaultMarkdownFile,
} from "./api/vaultApi";
import {
  subscribeVaultFsBusEvent,
  useBackendEventBridge,
} from "./events/appEventBus";
import {
  reportArticleContentByPath,
  useFocusedArticle,
} from "./store/editorContextStore";
import { useVaultTreeSync } from "./store/vaultStore";
import { useConfigState, useConfigSync } from "./store/configStore";
import { useThemeSync } from "./store/themeStore";
import { useVaultState } from "./store/vaultStore";
import { useWindowDragGestureSupport } from "./utils/windowDragGesture";
import "./App.css";

function HomeTab(): ReactNode {
  return (
    <div className="editor-tab-view">
      <h2>ofive 工作区</h2>
      <p>主区域由 dockview 官方 React 适配驱动，支持可插拔的 tab 组件。</p>
    </div>
  );
}

function App() {
  useBackendEventBridge();
  useVaultTreeSync();
  useThemeSync();
  useWindowDragGestureSupport();

  const vaultState = useVaultState();
  const focusedArticle = useFocusedArticle();
  const configState = useConfigState();
  useConfigSync(vaultState.currentVaultPath, !vaultState.isLoadingTree && !vaultState.error);

  useEffect(() => {
    const unlisten = subscribeVaultFsBusEvent(async (payload) => {
      if (isSelfTriggeredVaultFsEvent(payload)) {
        console.info("[app] skip self-triggered fs event", {
          eventId: payload.eventId,
          sourceTraceId: payload.sourceTraceId,
          eventType: payload.eventType,
          path: payload.relativePath,
        });
        return;
      }

      const currentFocusedPath = focusedArticle?.path;
      if (!currentFocusedPath) {
        return;
      }

      const isMarkdownFocused =
        currentFocusedPath.endsWith(".md") || currentFocusedPath.endsWith(".markdown");
      if (!isMarkdownFocused) {
        return;
      }

      if (!["modified", "created", "moved"].includes(payload.eventType)) {
        return;
      }

      const changedPath = payload.relativePath;
      if (!changedPath || changedPath !== currentFocusedPath) {
        return;
      }

      try {
        const latest = await readVaultMarkdownFile(changedPath);
        reportArticleContentByPath(changedPath, latest.content);
        console.info("[app] synced focused article by fs event", {
          eventId: payload.eventId,
          eventType: payload.eventType,
          path: changedPath,
        });
      } catch (error) {
        console.warn("[app] sync focused article by fs event failed", {
          eventId: payload.eventId,
          path: changedPath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return () => {
      unlisten();
    };
  }, [focusedArticle?.path]);

  const filesIcon = useMemo(() => <FolderOpen size={18} strokeWidth={1.8} />, []);
  const searchIcon = useMemo(() => <Search size={18} strokeWidth={1.8} />, []);
  const outlineIcon = useMemo(() => <Compass size={18} strokeWidth={1.8} />, []);
  const graphIcon = useMemo(() => <Orbit size={18} strokeWidth={1.8} />, []);

  const panels = useMemo<PanelDefinition[]>(
    () => {
      const nextPanels: PanelDefinition[] = [
        {
          id: "files",
          title: "资源管理器",
          icon: filesIcon,
          position: "left",
          order: 1,
          activityId: "files",
          activityTitle: "资源管理器",
          activityIcon: filesIcon,
          activitySection: "top",
          render: ({ openTab, closeTab, requestMoveFileToDirectory }) => (
            <VaultPanel
              openTab={openTab}
              closeTab={closeTab}
              requestMoveFileToDirectory={requestMoveFileToDirectory}
            />
          ),
        },
        {
          id: "graph-activity",
          title: "知识图谱",
          icon: graphIcon,
          position: "left",
          order: 3,
          activityId: "knowledge-graph",
          activityTitle: "知识图谱",
          activityIcon: graphIcon,
          activitySection: "top",
          onActivityClick: ({ openTab }) => {
            openTab({
              id: "knowledge-graph",
              title: "知识图谱",
              component: "knowledgegraph",
            });
          },
          render: () => (
            <div className="panel-placeholder">
              <h3>知识图谱</h3>
              <p>点击活动栏图谱图标打开知识图谱 Tab。</p>
            </div>
          ),
        },
      ];

      if (configState.featureSettings.searchEnabled) {
        nextPanels.push({
          id: "search",
          title: "搜索",
          icon: searchIcon,
          position: "left",
          order: 2,
          activityId: "search",
          activityTitle: "搜索",
          activityIcon: searchIcon,
          activitySection: "top",
          render: () => (
            <div className="panel-placeholder">
              <h3>搜索面板</h3>
              <p>在这里接入全文检索能力。</p>
            </div>
          ),
        });
      }

      nextPanels.push({
        id: "outline",
        title: "大纲",
        icon: outlineIcon,
        position: "right",
        order: 1,
        render: () => <OutlinePanel />,
      });

      return nextPanels;
    },
    [configState.featureSettings.searchEnabled, filesIcon, graphIcon, outlineIcon, searchIcon],
  );

  const tabComponents = useMemo<TabComponentDefinition[]>(
    () => [
      { key: "home", component: HomeTab },
      { key: "codemirror", component: CodeMirrorEditorTab },
      { key: "imageviewer", component: ImageViewerTab },
      { key: "knowledgegraph", component: KnowledgeGraphTab },
      { key: "settings", component: SettingsTab },
    ],
    [],
  );

  const initialTabs = useMemo<TabInstanceDefinition[]>(
    () => [
      {
        id: "home",
        title: "首页",
        component: "home",
      },
    ],
    [],
  );

  return (
    <div className="app-shell">
      <CustomTitlebar />
      <div className="app-content">
        <DockviewLayout
          panels={panels}
          tabComponents={tabComponents}
          initialTabs={initialTabs}
          initialActivePanelId="files"
        />
      </div>
    </div>
  );
}

export default App;
