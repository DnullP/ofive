/**
 * @module e2e/input-focus-stroke
 * @description 输入框聚焦边框样式回归：验证文件树内联输入与创建弹窗都使用细且更深的 stroke。
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_RENAME_PATH = "test-resources/notes/guide.md";

function parseRgbColor(color: string): { red: number; green: number; blue: number } {
    const legacyMatch = color.match(/rgba?\(([^)]+)\)/i);
    if (legacyMatch) {
        const channels = legacyMatch[1]
            .split(",")
            .slice(0, 3)
            .map((part) => Number(part.trim()));
        return {
            red: channels[0] ?? 0,
            green: channels[1] ?? 0,
            blue: channels[2] ?? 0,
        };
    }

    const colorMatch = color.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i);
    if (colorMatch) {
        return {
            red: Math.round(Number(colorMatch[1]) * 255),
            green: Math.round(Number(colorMatch[2]) * 255),
            blue: Math.round(Number(colorMatch[3]) * 255),
        };
    }

    throw new Error(`Unsupported CSS color format: ${color}`);
}

async function expectFocusedInputStroke(input: Locator): Promise<void> {
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("border-top-width", "1px");
    await expect(input).toHaveCSS("outline-style", "none");

    const borderColor = await input.evaluate((element) => window.getComputedStyle(element).borderTopColor);
    const { red, green, blue } = parseRgbColor(borderColor);
    expect(blue).toBeGreaterThan(red);
    expect(blue).toBeGreaterThan(green);
}

async function openCommandPalette(page: Page): Promise<void> {
    await page.keyboard.press("Meta+J");

    const commandPalette = page.locator(".command-palette-panel");
    try {
        await expect(commandPalette).toBeVisible({ timeout: 2000 });
    } catch {
        await page.keyboard.press("Meta+J");
        await expect(commandPalette).toBeVisible();
    }
}

test.describe("input focus stroke", () => {
    test("file tree inline rename input uses a thin darker focused stroke", async ({ page }) => {
        await gotoMockVaultPage(
            page,
            "input-focus-stroke-file-tree",
            `/web-mock/mock-tauri-test.html?showControls=0&mockFileTreeRenamePath=${encodeURIComponent(MOCK_RENAME_PATH)}`,
        );

        const renameInput = page.locator(".tree-rename-input");
        await expect(renameInput).toBeVisible();
        await expectFocusedInputStroke(renameInput);
    });

    test("create-entry modal input keeps the same focused stroke weight", async ({ page }) => {
        await gotoMockVaultPage(
            page,
            "input-focus-stroke-create-entry",
            "/web-mock/mock-tauri-test.html?showControls=0",
        );

        await openCommandPalette(page);
        const commandPalette = page.locator(".command-palette-panel");
        await commandPalette.locator(".command-palette-input").fill("note.createNew");
        await commandPalette
            .locator(".command-palette-item")
            .filter({ hasText: "note.createNew" })
            .first()
            .click();

        const createInput = page.locator(".create-entry-input");
        await expect(createInput).toBeVisible();
        await expectFocusedInputStroke(createInput);
    });
});
