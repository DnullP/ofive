import { useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import {
  CustomTitlebar,
  DockviewLayout,
  SettingsTab,
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
  emitPersistedContentUpdatedEvent,
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
import { ensureBuiltinComponentsRegistered } from "./registry/registerBuiltinComponents";
import { unregisterActivity } from "./registry/activityRegistry";
import { registerActivity } from "./registry/activityRegistry";
import { unregisterPanel, registerPanel } from "./registry/panelRegistry";
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

  /* ── 注册内置组件（幂等，只执行一次） ── */
  const builtinRefs = useMemo(() => ({
    HomeTab: HomeTab,
    CodeMirrorEditorTab,
    ImageViewerTab,
    SettingsTab,
    icons: {
      search: <Search size={18} strokeWidth={1.8} />,
    },
  }), []);
  ensureBuiltinComponentsRegistered(builtinRefs);

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

      /* 将非自触发的文件修改/创建事件转化为持久态更新语义事件 */
      if (
        payload.relativePath &&
        ["modified", "created"].includes(payload.eventType)
      ) {
        emitPersistedContentUpdatedEvent({
          relativePath: payload.relativePath,
          source: "external",
        });
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

  const searchIcon = useMemo(() => <Search size={18} strokeWidth={1.8} />, []);

  // 搜索功能的可见性由 featureFlag 控制
  // 当 searchEnabled 改变时动态注册/注销搜索活动和面板
  useEffect(() => {
    if (!configState.featureSettings.searchEnabled) {
      unregisterActivity("search");
      unregisterPanel("search");
    } else {
      // 重新注册搜索组件（registerActivity/registerPanel 内部支持覆盖）
      registerActivity({
        type: "panel-container",
        id: "search",
        title: () => t("app.searchPanel"),
        icon: searchIcon,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 2,
      });
      registerPanel({
        id: "search",
        title: () => t("app.searchPanel"),
        activityId: "search",
        defaultPosition: "left",
        defaultOrder: 2,
        render: () => (
          <div className="panel-placeholder">
            <h3>{t("app.searchPanelTitle")}</h3>
            <p>{t("app.searchPanelHint")}</p>
          </div>
        ),
      });
    }
  }, [configState.featureSettings.searchEnabled, searchIcon, t]);

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
          initialTabs={initialTabs}
          initialActivePanelId="files"
        />
      </div>
    </div>
  );
}

export default App;
