/**
 * @description 使用 Playwright 浏览器 API 检查 mock Tauri 玻璃页面的关键样式，
 * 作为桌面视觉调试的 Web 参考验收脚本。
 */

import { chromium } from "playwright";

function parseAlpha(color) {
    const match = String(color).match(/rgba?\(([^)]+)\)/i);
    if (!match) {
        return color === "transparent" ? 0 : 1;
    }

    const parts = match[1].split(",").map((part) => part.trim());
    return parts.length >= 4 ? Number(parts[3]) : 1;
}

function assertBetween(value, min, max, label) {
    if (!(value >= min && value <= max)) {
        throw new Error(`${label} out of range: ${value} (expected ${min}..${max})`);
    }
}

const targetUrl = process.env.OFIVE_GLASS_TEST_URL || "http://127.0.0.1:1420/web-mock/mock-tauri-test.html";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await page.getByTitle("AI 对话").click();

    const styleSnapshot = await page.evaluate(() => {
        const html = document.documentElement;
        const mainArea = document.querySelector(".main-content-area");
        const leftSidebar = document.querySelector(".sidebar-left");
        const fileTree = document.querySelector(".file-tree");
        const aiChatPanel = document.querySelector(".ai-chat-panel");
        const aiChatHeader = document.querySelector(".ai-chat-header");
        const aiChatCard = document.querySelector(".ai-chat-welcome-card");

        if (!mainArea || !leftSidebar || !fileTree || !aiChatPanel || !aiChatHeader || !aiChatCard) {
            throw new Error("glass visual selectors missing");
        }

        return {
            htmlClasses: Array.from(html.classList),
            mainAreaBackground: window.getComputedStyle(mainArea).backgroundColor,
            sidebarBackground: window.getComputedStyle(leftSidebar).backgroundColor,
            fileTreeBackground: window.getComputedStyle(fileTree).backgroundColor,
            aiChatPanelBackground: window.getComputedStyle(aiChatPanel).backgroundColor,
            aiChatHeaderBackground: window.getComputedStyle(aiChatHeader).backgroundColor,
            aiChatCardBackground: window.getComputedStyle(aiChatCard).backgroundColor,
        };
    });

    if (!styleSnapshot.htmlClasses.includes("app-effect--glass") || !styleSnapshot.htmlClasses.includes("app-runtime--tauri")) {
        throw new Error(`glass runtime classes missing: ${styleSnapshot.htmlClasses.join(", ")}`);
    }

    const mainAreaAlpha = parseAlpha(styleSnapshot.mainAreaBackground);
    const sidebarAlpha = parseAlpha(styleSnapshot.sidebarBackground);
    const fileTreeAlpha = parseAlpha(styleSnapshot.fileTreeBackground);
    const aiChatPanelAlpha = parseAlpha(styleSnapshot.aiChatPanelBackground);
    const aiChatHeaderAlpha = parseAlpha(styleSnapshot.aiChatHeaderBackground);
    const aiChatCardAlpha = parseAlpha(styleSnapshot.aiChatCardBackground);

    if (mainAreaAlpha !== 0) {
        throw new Error(`main content area should stay transparent, got alpha=${mainAreaAlpha}`);
    }
    if (fileTreeAlpha !== 0) {
        throw new Error(`file tree root should stay transparent, got alpha=${fileTreeAlpha}`);
    }

    assertBetween(sidebarAlpha, 0.05, 0.35, "sidebar alpha");
    assertBetween(aiChatPanelAlpha, 0, 0.2, "ai chat panel alpha");
    assertBetween(aiChatHeaderAlpha, 0.05, 0.35, "ai chat header alpha");
    assertBetween(aiChatCardAlpha, 0.05, 0.35, "ai chat card alpha");

    console.log("[glass-check] passed", {
        targetUrl,
        mainAreaBackground: styleSnapshot.mainAreaBackground,
        sidebarBackground: styleSnapshot.sidebarBackground,
        fileTreeBackground: styleSnapshot.fileTreeBackground,
        aiChatPanelBackground: styleSnapshot.aiChatPanelBackground,
        aiChatHeaderBackground: styleSnapshot.aiChatHeaderBackground,
        aiChatCardBackground: styleSnapshot.aiChatCardBackground,
    });
} finally {
    await page.close();
    await browser.close();
}