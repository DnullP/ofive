import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setupFrontendLogBridge } from "./utils/frontendLogBridge";

setupFrontendLogBridge();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
