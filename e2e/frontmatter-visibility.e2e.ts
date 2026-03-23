/**
 * @module e2e/frontmatter-visibility
 * @description Frontmatter 可视化编辑器回归测试。
 *
 * 覆盖场景：
 * 1. 打开 web mock 页面。
 * 2. 在 mock 资源树中打开带 frontmatter 的 Markdown 文件。
 * 3. 验证 frontmatter widget 可见。
 * 4. 验证正文首行仍在 frontmatter 之后单独显示，未被误吞入 widget 区域。
 *
 * @dependencies
 *   - @playwright/test
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * @function waitForMockLayoutReady
 * @description 等待 mock 页面布局与资源树进入可交互状态。
 * @param page Playwright 页面对象。
 * @returns Promise<void>
 */
async function waitForMockLayoutReady(page: Page): Promise<void> {
    await page.goto("/web-mock/mock-tauri-test.html");
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "资源管理器" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "▸ test-resources" }).waitFor({ state: "visible" });
}

/**
 * @function expectVisibleWithPositiveRect
 * @description 断言目标元素不仅存在，而且拥有正的可见盒模型尺寸。
 * @param locator 目标元素定位器。
 * @returns Promise<void>
 */
async function expectVisibleWithPositiveRect(locator: Locator): Promise<void> {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
}

test.describe("frontmatter 可见性", () => {
    test("frontmatter widget 应保持可见且正文不应并入 frontmatter 行", async ({ page }) => {
        await waitForMockLayoutReady(page);

        await page.getByRole("button", { name: "▸ test-resources" }).click();
        await page.getByRole("button", { name: "▸ notes" }).click();
        await page.getByRole("button", { name: "network-segment.md" }).click();

        const frontmatterWidget = page.locator(".cm-frontmatter-widget");
        await expectVisibleWithPositiveRect(frontmatterWidget);

        await expect(frontmatterWidget.locator("input[value='Network Segment']")).toBeVisible();

        const bodyLine = page.locator(".cm-content").getByText("Description", { exact: true }).first();
        await expectVisibleWithPositiveRect(bodyLine);

        const relation = await page.evaluate(() => {
            const widget = document.querySelector(".cm-frontmatter-widget");
            const bodyLine = Array.from(document.querySelectorAll(".cm-content *")).find((node) =>
                (node.textContent || "").trim() === "Description",
            );

            if (!(widget instanceof HTMLElement) || !(bodyLine instanceof HTMLElement)) {
                return null;
            }

            const widgetRect = widget.getBoundingClientRect();
            const bodyRect = bodyLine.getBoundingClientRect();
            return {
                widgetBottom: widgetRect.bottom,
                bodyTop: bodyRect.top,
            };
        });

        expect(relation).not.toBeNull();
        expect(relation!.bodyTop).toBeGreaterThanOrEqual(relation!.widgetBottom);
    });
});