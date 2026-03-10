import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setupFrontendLogBridge } from "./utils/frontendLogBridge";
/* 初始化 i18n —— 必须在 App 渲染之前引入 */
import "./i18n";

setupFrontendLogBridge();

/**
 * 插件自动发现：Vite 在构建时自动导入 src/plugins/ 下所有 .ts/.tsx 模块。
 * 每个模块在被导入时执行自注册副作用（调用 registerPanel / registerActivity 等），
 * 无需在其他文件中手动添加 import。
 *
 * 新增插件只需在 src/plugins/ 下创建文件，遵循自注册模式即可生效。
 */
import.meta.glob("./plugins/**/*.{ts,tsx}", { eager: true });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
