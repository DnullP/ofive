import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { registerAppRuntimeHandle } from "./host/lifecycle/appLifecycle";
import { startDiscoveredPlugins } from "./host/pluginRuntime";
import { setupFrontendLogBridge } from "./utils/frontendLogBridge";
import { setupFrontendPerfMonitoring } from "./utils/perfMetrics";
/* 初始化 i18n —— 必须在 App 渲染之前引入 */
import "./i18n";

setupFrontendLogBridge();
setupFrontendPerfMonitoring();

const strictModeEnabled = import.meta.env.VITE_DISABLE_STRICT_MODE !== "true";

/**
 * 插件自动发现与运行时启动：在渲染 App 前先激活全部插件入口，
 * 并由插件运行时接管 HMR 的卸载 / 重载流程。
 */
const pluginRuntime = await startDiscoveredPlugins();

if (import.meta.hot) {
  import.meta.hot.accept("./host/pluginRuntime", async (nextModule) => {
    if (!nextModule) {
      return;
    }

    await nextModule.startDiscoveredPlugins();
  });
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
registerAppRuntimeHandle({ root, pluginRuntime });

root.render(
  strictModeEnabled ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ) : (
    <App />
  ),
);
