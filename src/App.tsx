import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CustomTitlebar,
  SettingsTab,
  WorkbenchLayoutHost,
  type TabInstanceDefinition,
} from "./host/layout";
import { useBackendEventBridge } from "./host/events/appEventBus";
import { useVaultTreeSync } from "./host/vault/vaultStore";
import { useConfigSync } from "./host/config/configStore";
import { useThemeSync } from "./host/theme/themeStore";
import { useAutoSaveLifecycle } from "./host/editor/autoSaveService";
import { useVaultState } from "./host/vault/vaultStore";
import { useWindowDragGestureSupport } from "./utils/windowDragGesture";
import { ensureBuiltinComponentsRegistered } from "./host/registry/registerBuiltinComponents";
import { useWindowEffectsSync } from "./host/window/useWindowEffectsSync";
import { useMainWindowFullscreenEscapeGuard } from "./host/window/useMainWindowFullscreenEscapeGuard";
import { useGlobalContextMenuBlocker } from "./host/layout/contextMenuCenter";
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
  useWindowEffectsSync();
  useMainWindowFullscreenEscapeGuard();
  useGlobalContextMenuBlocker();
  useWindowDragGestureSupport();
  useAutoSaveLifecycle();

  const vaultState = useVaultState();
  useConfigSync(vaultState.currentVaultPath, !vaultState.isLoadingTree && !vaultState.error);

  /* ── 注册内置组件（幂等，只执行一次） ── */
  const builtinRefs = useMemo(() => ({
    HomeTab: HomeTab,
    SettingsTab,
  }), []);
  ensureBuiltinComponentsRegistered(builtinRefs);

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
        <WorkbenchLayoutHost
          initialTabs={initialTabs}
          initialActivePanelId="files"
        />
      </div>
    </div>
  );
}

export default App;
