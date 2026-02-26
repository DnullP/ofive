import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setupFrontendLogBridge } from "./utils/frontendLogBridge";
/* 初始化 i18n —— 必须在 App 渲染之前引入 */
import "./i18n";

setupFrontendLogBridge();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
