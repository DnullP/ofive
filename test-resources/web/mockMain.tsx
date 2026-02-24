import React from "react";
import ReactDOM from "react-dom/client";
import App from "../../src/App";
import { setupFrontendLogBridge } from "../../src/utils/frontendLogBridge";

setupFrontendLogBridge();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
