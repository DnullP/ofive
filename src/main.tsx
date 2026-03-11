import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setupFrontendLogBridge } from "./utils/frontendLogBridge";
/* 初始化 i18n —— 必须在 App 渲染之前引入 */
import "./i18n";

setupFrontendLogBridge();

/**
 * 插件自动发现：仅导入 src/plugins/ 下的插件入口文件（*Plugin.ts / *Plugin.tsx）。
 *
 * 这样可以避免把 helper、测试文件或插件内部实现模块误当成插件入口执行，
 * 否则浏览器环境会意外加载诸如 bun:test 之类仅测试期可用的模块，导致启动失败。
 *
 * 新增插件时应将入口命名为 *Plugin，并把非入口代码放在其他文件中。
 */
import.meta.glob("./plugins/**/*Plugin.{ts,tsx}", { eager: true });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
