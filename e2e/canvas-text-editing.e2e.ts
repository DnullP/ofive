/**
 * @module e2e/canvas-text-editing
 * @description Canvas 文本节点编辑回归测试。
 *
 * 覆盖场景：
 * 1. 双击文本节点进入编辑后，输入内容并按回车退出，内容不应被清空。
 * 2. 文本节点使用 Shift+Enter 输入多行后，再按回车提交，内容应完整保留。
 * 3. 编辑过程中不应出现 React Flow 关于 nodeTypes/edgeTypes 重建的 warning。
 *
 * @dependencies
 *   - @playwright/test
 *
 * @example
 *   bunx playwright test --config playwright.config.ts e2e/canvas-text-editing.e2e.ts --reporter=line
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const REACT_FLOW_NODE_TYPES_WARNING = "created a new nodeTypes or edgeTypes object";
const CANVAS_TEXT_NODE_SNIPPET = "切换 light / dark / kraft";

/**
 * @function ensureMockNotesTreeExpanded
 * @description 确保 mock 文件树中的 notes 目录已展开。
 * @param page Playwright 页面对象。
 * @returns Promise<void>
 */
async function ensureMockNotesTreeExpanded(page: Page): Promise<void> {
    const rootItem = page.locator(".tree-item[data-tree-path='test-resources']");
    const notesItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    const canvasItem = page.locator(".tree-item[data-tree-path='test-resources/notes/glass-validation.canvas']");

    await rootItem.waitFor({ state: "visible" });

    if (!await notesItem.isVisible().catch(() => false)) {
        await rootItem.click();
        await notesItem.waitFor({ state: "visible" });
    }

    if (!await canvasItem.isVisible().catch(() => false)) {
        await notesItem.click();
    }

    await canvasItem.waitFor({ state: "visible" });
}

/**
 * @function openCanvasSample
 * @description 打开 mock 中的 glass-validation.canvas 示例。
 * @param page Playwright 页面对象。
 * @returns Promise<void>
 */
async function openCanvasSample(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await ensureMockNotesTreeExpanded(page);
    await page.locator(".tree-item[data-tree-path='test-resources/notes/glass-validation.canvas']").dblclick();
    await expect(page.locator(".canvas-tab")).toBeVisible();
    await page.locator(".canvas-tab__surface").waitFor({ state: "visible" });
}

/**
 * @function openPrimaryTextNodeEditor
 * @description 打开示例 Canvas 中的主文本节点编辑器。
 * @param page Playwright 页面对象。
 * @returns 文本编辑器定位器。
 */
async function openPrimaryTextNodeEditor(page: Page): Promise<Locator> {
    const textNode = page.locator(".canvas-tab__node", { hasText: CANVAS_TEXT_NODE_SNIPPET }).first();
    await expect(textNode).toBeVisible();
    await textNode.dblclick();

    const editor = page.locator("textarea.canvas-tab__node-text-editor");
    await expect(editor).toBeVisible();
    return editor;
}

/**
 * @function collectConsoleWarnings
 * @description 记录页面运行期 warning/error 文本，供测试断言回归。
 * @param page Playwright 页面对象。
 * @returns 控制台消息数组。
 */
function collectConsoleWarnings(page: Page): string[] {
    const messages: string[] = [];

    page.on("console", (message) => {
        if (message.type() === "warning" || message.type() === "error") {
            messages.push(message.text());
        }
    });

    return messages;
}

test.describe("canvas text editing", () => {
    test("pressing Enter should persist the edited text and avoid React Flow nodeTypes warnings", async ({ page }) => {
        const consoleWarnings = collectConsoleWarnings(page);
        await openCanvasSample(page);

        const editor = await openPrimaryTextNodeEditor(page);
        await editor.fill("abc");
        await editor.press("Enter");

        await expect(editor).toBeHidden();
        await expect(page.locator(".canvas-tab__node", { hasText: "abc" }).first()).toBeVisible();
        await expect(page.locator(".canvas-tab__node", { hasText: "空文本节点" }).first()).toHaveCount(0);
        expect(consoleWarnings.some((message) => message.includes(REACT_FLOW_NODE_TYPES_WARNING))).toBe(false);
    });

    test("Shift+Enter should keep multiline content and Enter should commit without clearing it", async ({ page }) => {
        await openCanvasSample(page);

        const editor = await openPrimaryTextNodeEditor(page);
        await editor.fill("first line");
        await editor.press("Shift+Enter");
        await editor.type("second line");
        await editor.press("Enter");

        await expect(editor).toBeHidden();

        const textNode = page.locator(".canvas-tab__node", { hasText: "first line" }).first();
        await expect(textNode).toBeVisible();
        await expect(textNode).toContainText("second line");
    });
});