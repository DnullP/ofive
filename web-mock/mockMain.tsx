import React from "react";
import ReactDOM from "react-dom/client";
import { MockApp } from "./mock/MockApp";
import { setupFrontendLogBridge } from "../src/utils/frontendLogBridge";

setupFrontendLogBridge();

document.documentElement.style.width = "100%";
document.documentElement.style.height = "100%";
document.body.style.width = "100%";
document.body.style.height = "100%";
document.body.style.margin = "0";
document.body.style.background = [
    "radial-gradient(circle at 18% 18%, rgba(88, 150, 255, 0.24), transparent 24%)",
    "radial-gradient(circle at 78% 22%, rgba(255, 196, 120, 0.18), transparent 22%)",
    "radial-gradient(circle at 72% 72%, rgba(116, 208, 170, 0.18), transparent 26%)",
    "linear-gradient(135deg, rgb(24, 30, 38), rgb(39, 46, 58) 42%, rgb(28, 34, 44))",
].join(", ");
document.body.style.backgroundAttachment = "fixed";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <MockApp />
    </React.StrictMode>,
);