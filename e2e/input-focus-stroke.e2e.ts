/**
 * @module e2e/input-focus-stroke
 * @description 输入框聚焦边框样式回归：验证文件树内联输入与创建弹窗都使用细且更深的 stroke。
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_RENAME_PATH = "test-resources/notes/guide.md";

function parseCssColor(color: string): { red: number; green: number; blue: number; alpha: number } {
    const normalizedColor = color.trim().toLowerCase();
    if (normalizedColor === "transparent") {
        return { red: 0, green: 0, blue: 0, alpha: 0 };
    }

    const parseChannel = (channel: string): number => {
        const trimmedChannel = channel.trim();
        if (trimmedChannel.endsWith("%")) {
            return Number(trimmedChannel.slice(0, -1)) * 2.55;
        }

        return Number(trimmedChannel);
    };
    const parseAlpha = (alpha: string | undefined): number => {
        if (!alpha) {
            return 1;
        }

        const trimmedAlpha = alpha.trim();
        if (trimmedAlpha.endsWith("%")) {
            return Number(trimmedAlpha.slice(0, -1)) / 100;
        }

        return Number(trimmedAlpha);
    };

    const legacyMatch = color.match(/rgba?\(([^)]+)\)/i);
    if (legacyMatch) {
        const [channelPart, slashAlpha] = legacyMatch[1].split(/\s*\/\s*/);
        const rawParts = channelPart.includes(",")
            ? channelPart.split(",")
            : channelPart.trim().split(/\s+/);
        return {
            red: parseChannel(rawParts[0] ?? "0"),
            green: parseChannel(rawParts[1] ?? "0"),
            blue: parseChannel(rawParts[2] ?? "0"),
            alpha: parseAlpha(slashAlpha ?? rawParts[3]),
        };
    }

    const colorMatch = color.match(/color\(srgb\s+([^)]+)\)/i);
    if (colorMatch) {
        const [channelPart, slashAlpha] = colorMatch[1].split(/\s*\/\s*/);
        const channels = channelPart.trim().split(/\s+/);
        const srgbChannelToByte = (channel: string): number => {
            const trimmedChannel = channel.trim();
            if (trimmedChannel.endsWith("%")) {
                return Number(trimmedChannel.slice(0, -1)) * 2.55;
            }

            return Number(trimmedChannel) * 255;
        };

        return {
            red: srgbChannelToByte(channels[0] ?? "0"),
            green: srgbChannelToByte(channels[1] ?? "0"),
            blue: srgbChannelToByte(channels[2] ?? "0"),
            alpha: parseAlpha(slashAlpha),
        };
    }

    throw new Error(`Unsupported CSS color format: ${color}`);
}

async function expectFocusedInputStroke(input: Locator): Promise<void> {
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("border-top-width", "1px");
    await expect(input).toHaveCSS("border-top-style", "solid");
    await expect(input).toHaveCSS("outline-style", "none");

    const borderColor = await input.evaluate((element) => window.getComputedStyle(element).borderTopColor);
    const { red, green, blue, alpha } = parseCssColor(borderColor);
    expect(Number.isFinite(red)).toBe(true);
    expect(Number.isFinite(green)).toBe(true);
    expect(Number.isFinite(blue)).toBe(true);
    expect(Number.isFinite(alpha)).toBe(true);
    expect(alpha).toBeGreaterThan(0);
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
