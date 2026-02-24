/**
 * @module cosmos-main
 * @description Cosmos 图谱调参页面独立入口，用于 web 环境快速验证图参数。
 * @dependencies
 *  - react
 *  - react-dom
 *  - ./playground/CosmosGraphPlayground
 *
 * @example
 *   通过 cosmos.html 访问该入口。
 *
 * @exports
 *  - 无（仅初始化页面渲染）
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { CosmosGraphPlayground } from "./playground/CosmosGraphPlayground";
import { setupFrontendLogBridge } from "./utils/frontendLogBridge";

setupFrontendLogBridge();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CosmosGraphPlayground />
  </React.StrictMode>,
);
