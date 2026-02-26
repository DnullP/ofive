import React from "react";
import ReactDOM from "react-dom/client";
import { MockApp } from "./mock/MockApp";
import { setupFrontendLogBridge } from "../../src/utils/frontendLogBridge";

setupFrontendLogBridge();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <MockApp />
    </React.StrictMode>,
);
