import { useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
import { useAutoSaveLifecycle } from "./store/autoSaveService";
import { useVaultState } from "./store/vaultStore";
import { useWindowDragGestureSupport } from "./utils/windowDragGesture";
import "./App.css";

function HomeTab(): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="editor-tab-view">
      <h2>{t("app.homeTitle")}</h2>
      <p>{t("app.homeDescription")}</p>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  useBackendEventBridge();
  useVaultTreeSync();
  useThemeSync();
  useWindowDragGestureSupport();
  useAutoSaveLifecycle();

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
          title: t("app.explorer"),
          icon: filesIcon,
          position: "left",
          order: 1,
          activityId: "files",
          activityTitle: t("app.explorer"),
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
          title: t("app.knowledgeGraph"),
          icon: graphIcon,
          position: "left",
          order: 3,
          activityId: "knowledge-graph",
          activityTitle: t("app.knowledgeGraph"),
          activityIcon: graphIcon,
          activitySection: "top",
          tabOnly: true,
          onActivityClick: ({ openTab }) => {
            openTab({
              id: "knowledge-graph",
              title: t("app.knowledgeGraph"),
              component: "knowledgegraph",
            });
          },
          render: () => (
            <div className="panel-placeholder">
              <h3>{t("app.knowledgeGraph")}</h3>
              <p>{t("app.graphPanelHint")}</p>
            </div>
          ),
        },
      ];

      if (configState.featureSettings.searchEnabled) {
        nextPanels.push({
          id: "search",
          title: t("app.searchPanel"),
          icon: searchIcon,
          position: "left",
          order: 2,
          activityId: "search",
          activityTitle: t("app.searchPanel"),
          activityIcon: searchIcon,
          activitySection: "top",
          render: () => (
            <div className="panel-placeholder">
              <h3>{t("app.searchPanelTitle")}</h3>
              <p>{t("app.searchPanelHint")}</p>
            </div>
          ),
        });
      }

      nextPanels.push({
        id: "outline",
        title: t("app.outline"),
        icon: outlineIcon,
        position: "right",
        order: 1,
        activityId: "outline",
        activityTitle: t("app.outline"),
        activityIcon: outlineIcon,
        activitySection: "top",
        render: () => <OutlinePanel />,
      });

      return nextPanels;
    },
    [configState.featureSettings.searchEnabled, filesIcon, graphIcon, outlineIcon, searchIcon, t],
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
        title: t("app.homeTabTitle"),
        component: "home",
      },
    ],
    [t],
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
