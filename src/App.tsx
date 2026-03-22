import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import {
  CustomTitlebar,
  DockviewLayout,
  SettingsTab,
  type TabInstanceDefinition,
} from "./host/layout";
import {
  isSelfTriggeredVaultFsEvent,
  readVaultMarkdownFile,
} from "./api/vaultApi";
import { updateMainWindowAcrylicEffect } from "./api/windowApi";
import {
  subscribeVaultFsBusEvent,
  useBackendEventBridge,
  emitPersistedContentUpdatedEvent,
} from "./host/events/appEventBus";
import {
  reportArticleContentByPath,
  useFocusedArticle,
} from "./host/store/editorContextStore";
import { useVaultTreeSync } from "./host/store/vaultStore";
import { useConfigState, useConfigSync } from "./host/store/configStore";
import { useThemeSync } from "./host/store/themeStore";
import { useAutoSaveLifecycle } from "./host/store/autoSaveService";
import { useVaultState } from "./host/store/vaultStore";
import { useWindowDragGestureSupport } from "./utils/windowDragGesture";
import { ensureBuiltinComponentsRegistered } from "./host/registry/registerBuiltinComponents";
import { unregisterActivity } from "./host/registry/activityRegistry";
import { registerActivity } from "./host/registry/activityRegistry";
import { unregisterPanel, registerPanel } from "./host/registry/panelRegistry";
import { buildGlassRuntimeStyle } from "./host/layout/glassRuntimeStyle";
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
  const runtimeInfo = useMemo(() => {
    const runtimeWindow = window as Window & {
      __TAURI_INTERNALS__?: unknown;
      __TAURI__?: unknown;
    };
    const isTauriRuntime = Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
    const platformFingerprint = typeof navigator === "undefined"
      ? ""
      : `${navigator.userAgent} ${navigator.platform}`.toLowerCase();

    return {
      isTauriRuntime,
      isWindows: platformFingerprint.includes("win"),
      isMacOS: platformFingerprint.includes("mac"),
    };
  }, []);
  useBackendEventBridge();
  useVaultTreeSync();
  useThemeSync();
  useWindowDragGestureSupport();
  useAutoSaveLifecycle();

  const vaultState = useVaultState();
  const focusedArticle = useFocusedArticle();
  const configState = useConfigState();
  const isGlassEffectEnabled = runtimeInfo.isTauriRuntime && configState.featureSettings.glassEffectEnabled;
  const [isWindowFocused, setIsWindowFocused] = useState<boolean>(() => {
    if (typeof document === "undefined") {
      return true;
    }

    return document.hasFocus();
  });
  useConfigSync(vaultState.currentVaultPath, !vaultState.isLoadingTree && !vaultState.error);

  /* ── 注册内置组件（幂等，只执行一次） ── */
  const builtinRefs = useMemo(() => ({
    HomeTab: HomeTab,
    SettingsTab,
    icons: {
      search: <Search size={18} strokeWidth={1.8} />,
    },
  }), []);
  ensureBuiltinComponentsRegistered(builtinRefs);

  useEffect(() => {
    const handleFocus = (): void => {
      setIsWindowFocused(true);
    };

    const handleBlur = (): void => {
      setIsWindowFocused(false);
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    const runtimeGlassStyle = buildGlassRuntimeStyle({
      glassTintOpacity: configState.featureSettings.glassTintOpacity,
      glassSurfaceOpacity: configState.featureSettings.glassSurfaceOpacity,
      glassInactiveSurfaceOpacity: configState.featureSettings.glassInactiveSurfaceOpacity,
      glassBlurRadius: configState.featureSettings.glassBlurRadius,
    });

    document.documentElement.classList.toggle("app-runtime--tauri", runtimeInfo.isTauriRuntime);
    document.documentElement.classList.toggle("app-platform--windows", runtimeInfo.isWindows);
    document.documentElement.classList.toggle("app-platform--macos", runtimeInfo.isMacOS);
    document.documentElement.classList.toggle("app-effect--glass", isGlassEffectEnabled);
    document.documentElement.classList.toggle("app-window--inactive", !isWindowFocused);

    Object.entries(runtimeGlassStyle.cssVariables).forEach(([name, value]) => {
      document.documentElement.style.setProperty(name, value);
    });

    console.info("[window] runtime effect classes updated", {
      ...runtimeInfo,
      glassEffectEnabled: isGlassEffectEnabled,
      isWindowFocused,
      glassTintOpacity: configState.featureSettings.glassTintOpacity,
      glassSurfaceOpacity: configState.featureSettings.glassSurfaceOpacity,
      glassInactiveSurfaceOpacity: configState.featureSettings.glassInactiveSurfaceOpacity,
      effectiveInactiveSurfaceOpacity: runtimeGlassStyle.effectiveInactiveSurfaceOpacity,
      glassBlurRadius: configState.featureSettings.glassBlurRadius,
    });

    return () => {
      document.documentElement.classList.remove("app-runtime--tauri");
      document.documentElement.classList.remove("app-platform--windows");
      document.documentElement.classList.remove("app-platform--macos");
      document.documentElement.classList.remove("app-effect--glass");
      document.documentElement.classList.remove("app-window--inactive");
    };
  }, [configState.featureSettings.glassBlurRadius, configState.featureSettings.glassInactiveSurfaceOpacity, configState.featureSettings.glassSurfaceOpacity, configState.featureSettings.glassTintOpacity, isGlassEffectEnabled, isWindowFocused, runtimeInfo]);

  useEffect(() => {
    if (!runtimeInfo.isTauriRuntime || (!runtimeInfo.isWindows && !runtimeInfo.isMacOS)) {
      return;
    }

    void updateMainWindowAcrylicEffect({
      enabled: isGlassEffectEnabled,
      disableSystemBackdrop: configState.featureSettings.windowsAcrylicDisableSystemBackdrop,
      focusedColor: {
        red: configState.featureSettings.windowsAcrylicFocusedRed,
        green: configState.featureSettings.windowsAcrylicFocusedGreen,
        blue: configState.featureSettings.windowsAcrylicFocusedBlue,
        alpha: configState.featureSettings.windowsAcrylicFocusedAlpha,
      },
      focusedAccentFlags: configState.featureSettings.windowsAcrylicFocusedAccentFlags,
      focusedAnimationId: configState.featureSettings.windowsAcrylicFocusedAnimationId,
      inactiveColor: {
        red: configState.featureSettings.windowsAcrylicInactiveRed,
        green: configState.featureSettings.windowsAcrylicInactiveGreen,
        blue: configState.featureSettings.windowsAcrylicInactiveBlue,
        alpha: configState.featureSettings.windowsAcrylicInactiveAlpha,
      },
      inactiveAccentFlags: configState.featureSettings.windowsAcrylicInactiveAccentFlags,
      inactiveAnimationId: configState.featureSettings.windowsAcrylicInactiveAnimationId,
    }).then(() => {
      console.info("[window] windows acrylic config applied", {
        enabled: isGlassEffectEnabled,
        disableSystemBackdrop: configState.featureSettings.windowsAcrylicDisableSystemBackdrop,
        focusedColor: {
          red: configState.featureSettings.windowsAcrylicFocusedRed,
          green: configState.featureSettings.windowsAcrylicFocusedGreen,
          blue: configState.featureSettings.windowsAcrylicFocusedBlue,
          alpha: configState.featureSettings.windowsAcrylicFocusedAlpha,
        },
        focusedAccentFlags: configState.featureSettings.windowsAcrylicFocusedAccentFlags,
        focusedAnimationId: configState.featureSettings.windowsAcrylicFocusedAnimationId,
        inactiveColor: {
          red: configState.featureSettings.windowsAcrylicInactiveRed,
          green: configState.featureSettings.windowsAcrylicInactiveGreen,
          blue: configState.featureSettings.windowsAcrylicInactiveBlue,
          alpha: configState.featureSettings.windowsAcrylicInactiveAlpha,
        },
        inactiveAccentFlags: configState.featureSettings.windowsAcrylicInactiveAccentFlags,
        inactiveAnimationId: configState.featureSettings.windowsAcrylicInactiveAnimationId,
      });
    }).catch((error) => {
      console.warn("[window] failed to apply windows acrylic config", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [
    configState.featureSettings.windowsAcrylicFocusedAlpha,
    configState.featureSettings.windowsAcrylicFocusedAnimationId,
    configState.featureSettings.windowsAcrylicFocusedAccentFlags,
    configState.featureSettings.windowsAcrylicFocusedBlue,
    configState.featureSettings.windowsAcrylicFocusedGreen,
    configState.featureSettings.windowsAcrylicFocusedRed,
    configState.featureSettings.windowsAcrylicInactiveAnimationId,
    configState.featureSettings.windowsAcrylicInactiveAccentFlags,
    configState.featureSettings.windowsAcrylicInactiveAlpha,
    configState.featureSettings.windowsAcrylicInactiveBlue,
    configState.featureSettings.windowsAcrylicInactiveGreen,
    configState.featureSettings.windowsAcrylicInactiveRed,
    configState.featureSettings.windowsAcrylicDisableSystemBackdrop,
    isGlassEffectEnabled,
    runtimeInfo.isTauriRuntime,
    runtimeInfo.isMacOS,
    runtimeInfo.isWindows,
  ]);

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
