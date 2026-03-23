/**
 * @module e2e/glass-visual.e2e
 * @description 桌面毛玻璃样式 E2E 验收：验证主工作区保持透明，侧栏与边栏插件具备可见玻璃表面。
 * @dependencies
 *  - @playwright/test
 */

import { expect, test } from "@playwright/test";

function parseAlpha(color: string): number {
    const match = color.match(/rgba?\(([^)]+)\)/i);
    if (!match) {
        return color === "transparent" ? 0 : 1;
    }

    const parts = match[1].split(",").map((part) => part.trim());
    if (parts.length < 4) {
        return 1;
    }

    return Number(parts[3]);
}

test.describe("glass visual reference", () => {
    test("main area stays transparent while sidebar plugins keep frosted surfaces", async ({ page }) => {
        await page.goto("/web-mock/mock-tauri-test.html");

        await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
        await page.getByTitle("AI 对话").click();
        /* 等待 AI 对话面板渲染完毕，避免 evaluate 时元素尚未出现 */
        await page.locator(".ai-chat-panel").waitFor({ state: "visible" });

        const styleSnapshot = await page.evaluate(() => {
            const html = document.documentElement;
            const mainArea = document.querySelector<HTMLElement>(".main-content-area");
            const leftSidebar = document.querySelector<HTMLElement>(".sidebar-left");
            const fileTree = document.querySelector<HTMLElement>(".file-tree");
            const aiChatPanel = document.querySelector<HTMLElement>(".ai-chat-panel");
            const aiChatHeader = document.querySelector<HTMLElement>(".ai-chat-header");
            const aiChatCard = document.querySelector<HTMLElement>(".ai-chat-welcome-card");

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

        expect(styleSnapshot.htmlClasses).toContain("app-effect--glass");
        expect(styleSnapshot.htmlClasses).toContain("app-runtime--tauri");
        expect(parseAlpha(styleSnapshot.mainAreaBackground)).toBe(0);
        expect(parseAlpha(styleSnapshot.sidebarBackground)).toBeGreaterThan(0.05);
        expect(parseAlpha(styleSnapshot.sidebarBackground)).toBeLessThan(0.35);
        expect(parseAlpha(styleSnapshot.fileTreeBackground)).toBe(0);
        expect(parseAlpha(styleSnapshot.aiChatPanelBackground)).toBeLessThan(0.2);
        expect(parseAlpha(styleSnapshot.aiChatHeaderBackground)).toBeGreaterThan(0.05);
        expect(parseAlpha(styleSnapshot.aiChatHeaderBackground)).toBeLessThan(0.35);
        expect(parseAlpha(styleSnapshot.aiChatCardBackground)).toBeGreaterThan(0.05);
        expect(parseAlpha(styleSnapshot.aiChatCardBackground)).toBeLessThan(0.35);
    });
});