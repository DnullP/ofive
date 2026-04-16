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
    await page.getByTestId("activity-bar-item-files").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "▸ test-resources" }).waitFor({ state: "visible" });
}

/**
 * @function enableVimMode
 * @description 在 web mock 中开启 Vim 模式，复用前端配置 store 的正式入口。
 * @param page Playwright 页面对象。
 * @returns Promise<void>
 */
async function enableVimMode(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const module = await import("/src/host/store/configStore.ts");
        await module.updateVimModeEnabled(true);
    });
}

/**
 * @function openMockFrontmatterNote
 * @description 打开带 frontmatter 的 mock 笔记并等待 frontmatter widget 渲染完成。
 * @param page Playwright 页面对象。
 * @returns Promise<void>
 */
async function openMockFrontmatterNote(page: Page): Promise<void> {
    await page.getByRole("button", { name: "▸ test-resources" }).click();
    await page.getByRole("button", { name: "▸ notes" }).click();
    await page.getByRole("button", { name: "network-segment.md" }).click();
    await expect(page.locator(".cm-frontmatter-widget")).toBeVisible();
}

/**
 * @function openMockFrontmatterNoteViaQuickSwitcher
 * @description 通过 Quick Switcher 最终复用的 openFileInDockview 路径打开带 frontmatter 的 mock 笔记。
 *   web mock 未挂载真实 quick switch overlay，因此这里直接复用其选中候选项后的文件切换链路。
 * @param page Playwright 页面对象。
 * @param relativePath 目标 Markdown 相对路径。
 * @returns Promise<void>
 */
async function openMockFrontmatterNoteViaQuickSwitcher(page: Page, relativePath: string): Promise<void> {
    await page.evaluate(async (nextRelativePath) => {
        const editorTab = document.querySelector(".cm-tab");
        if (!(editorTab instanceof HTMLElement)) {
            throw new Error("Active CodeMirror tab not found");
        }

        const reactFiberKey = Object.keys(editorTab).find((key) => key.startsWith("__reactFiber$"));
        if (!reactFiberKey) {
            throw new Error("React fiber key for CodeMirror tab not found");
        }

        let currentFiber = (editorTab as Record<string, unknown>)[reactFiberKey] as {
            return?: unknown;
            memoizedProps?: { containerApi?: unknown };
        } | null;
        let containerApi: unknown = null;

        while (currentFiber) {
            if (currentFiber.memoizedProps?.containerApi) {
                containerApi = currentFiber.memoizedProps.containerApi;
                break;
            }

            currentFiber = (currentFiber.return as typeof currentFiber) ?? null;
        }

        if (!containerApi) {
            throw new Error("CodeMirror containerApi not found from React fiber chain");
        }

        const module = await import("/src/host/layout/openFileService.ts");
        await module.openFileInDockview({
            containerApi: containerApi as never,
            relativePath: nextRelativePath,
        });
    }, relativePath);

    await expect(page.locator(".cm-frontmatter-widget")).toBeVisible();
}

/**
 * @function focusFrontmatterNavigationRow
 * @description 将焦点直接放到指定 frontmatter 导航行，用于稳定验证 Vim 导航层行为。
 * @param page Playwright 页面对象。
 * @param fieldKey frontmatter 字段名。
 * @returns Promise<void>
 */
async function focusFrontmatterNavigationRow(page: Page, fieldKey: string): Promise<void> {
    await page.evaluate((nextFieldKey) => {
        const row = document.querySelector<HTMLElement>(`[data-frontmatter-field-key="${nextFieldKey}"]`);
        row?.focus();
    }, fieldKey);
}

/**
 * @function focusFrontmatterKeyInput
 * @description 将焦点放到指定字段名输入框，并把光标移动到文本末尾。
 * @param page Playwright 页面对象。
 * @param fieldKey frontmatter 字段名。
 * @returns Promise<void>
 */
async function focusFrontmatterKeyInput(page: Page, fieldKey: string): Promise<void> {
    await page.evaluate((nextFieldKey) => {
        const keyField = document.querySelector<HTMLTextAreaElement>(
            `[data-frontmatter-field-key="${nextFieldKey}"] [data-frontmatter-focus-role="key"].fmv-inline-text-control`,
        );
        if (!keyField) {
            throw new Error(`Frontmatter key field not found: ${nextFieldKey}`);
        }

        keyField.focus();
        const caretOffset = keyField.value.length;
        keyField.setSelectionRange(caretOffset, caretOffset);
    }, fieldKey);
}

/**
 * @function dispatchImeConfirmEnterOnFrontmatterKey
 * @description 在指定字段名输入框上模拟一次输入法候选确认 Enter，覆盖组合结束后的 Enter 冒泡路径。
 * @param page Playwright 页面对象。
 * @param fieldKey frontmatter 字段名。
 * @returns Promise<void>
 */
async function dispatchImeConfirmEnterOnFrontmatterKey(page: Page, fieldKey: string): Promise<void> {
    await page.evaluate((nextFieldKey) => {
        const keyField = document.querySelector<HTMLTextAreaElement>(
            `[data-frontmatter-field-key="${nextFieldKey}"] [data-frontmatter-focus-role="key"].fmv-inline-text-control`,
        );

        if (!keyField) {
            throw new Error(`Frontmatter key field not found: ${nextFieldKey}`);
        }

        keyField.focus();
        keyField.dispatchEvent(new CompositionEvent("compositionstart", {
            bubbles: true,
            data: "ti",
        }));
        keyField.dispatchEvent(new CompositionEvent("compositionend", {
            bubbles: true,
            data: "题",
        }));
        keyField.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
        }));
    }, fieldKey);
}

/**
 * @function focusEditorBodyFirstLine
 * @description 通过 CodeMirror EditorView 直接将光标放到正文首行，避免依赖不稳定的文本点击。
 * @param page Playwright 页面对象。
 * @returns Promise<void>
 */
async function focusEditorBodyFirstLine(page: Page): Promise<void> {
    await page.evaluate(() => {
        const content = document.querySelector(".cm-content") as (HTMLElement & {
            cmTile?: { view?: { focus: () => void; state: { doc: { toString(): string } }; dispatch: (spec: unknown) => void } };
        }) | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found on .cm-content");
        }

        const docText = view.state.doc.toString();
        const firstBodyOffset = docText.indexOf("Description");
        if (firstBodyOffset < 0) {
            throw new Error("Could not find first body line");
        }

        view.focus();
        view.dispatch({
            selection: { anchor: firstBodyOffset },
            scrollIntoView: true,
        });
    });
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

        await openMockFrontmatterNote(page);

        const frontmatterWidget = page.locator(".cm-frontmatter-widget");
        await expectVisibleWithPositiveRect(frontmatterWidget);

        await expect(frontmatterWidget.locator("textarea.fmv-input").first()).toHaveValue("Network Segment");

        const bodyLine = page.locator(".cm-line").filter({ hasText: "Description" }).first();
        await expectVisibleWithPositiveRect(bodyLine);

        const [widgetBox, bodyBox] = await Promise.all([
            frontmatterWidget.boundingBox(),
            bodyLine.boundingBox(),
        ]);

        expect(widgetBox).not.toBeNull();
        expect(bodyBox).not.toBeNull();
        expect(bodyBox!.y).toBeGreaterThanOrEqual(widgetBox!.y + widgetBox!.height);
    });

    test("frontmatter 文本字段提交再按 j 不应展开源码或写入正文", async ({ page }) => {
        await waitForMockLayoutReady(page);
        await enableVimMode(page);
        await openMockFrontmatterNote(page);

        await focusFrontmatterNavigationRow(page, "title");
        await page.keyboard.press("Enter");
        await page.keyboard.type(" Updated");
        await page.keyboard.press("Enter");
        await page.keyboard.press("j");

        const navigationState = await page.evaluate(() => {
            const activeElement = document.activeElement as HTMLElement | null;
            const titleInput = document.querySelector<HTMLInputElement>(
                '[data-frontmatter-field-key="title"] [data-frontmatter-focus-role="value"]',
            );
            const widget = document.querySelector(".cm-frontmatter-widget");
            const editorText = document.querySelector(".cm-content")?.textContent ?? "";

            return {
                activeFieldKey: activeElement?.getAttribute("data-frontmatter-field-key") ?? null,
                activeParentFieldKey: activeElement?.closest?.("[data-frontmatter-field-key]")?.getAttribute("data-frontmatter-field-key") ?? null,
                activeClassName: activeElement?.className ?? null,
                titleValue: titleInput?.value ?? null,
                widgetVisible: widget instanceof HTMLElement,
                editorText,
            };
        });

        expect(navigationState.widgetVisible).toBe(true);
        expect(navigationState.titleValue).toContain("Updated");
        expect(navigationState.activeParentFieldKey ?? navigationState.activeFieldKey).toBe("category");
        expect(navigationState.editorText.startsWith("j---")).toBe(false);
    });

    test("frontmatter 字段名提交再按 j 不应展开源码或写入正文", async ({ page }) => {
        await waitForMockLayoutReady(page);
        await enableVimMode(page);
        await openMockFrontmatterNote(page);

        await focusFrontmatterKeyInput(page, "title");
        await page.keyboard.type("Updated");
        await page.keyboard.press("Enter");
        await page.keyboard.press("j");

        const navigationState = await page.evaluate(() => {
            const activeElement = document.activeElement as HTMLElement | null;
            const renamedKeyInput = document.querySelector<HTMLTextAreaElement>(
                '[data-frontmatter-field-key="titleUpdated"] [data-frontmatter-focus-role="key"].fmv-inline-text-control',
            );
            const widget = document.querySelector(".cm-frontmatter-widget");
            const editorText = document.querySelector(".cm-content")?.textContent ?? "";

            return {
                activeFieldKey: activeElement?.getAttribute("data-frontmatter-field-key") ?? null,
                activeParentFieldKey: activeElement?.closest?.("[data-frontmatter-field-key]")?.getAttribute("data-frontmatter-field-key") ?? null,
                renamedKeyValue: renamedKeyInput?.value ?? null,
                widgetVisible: widget instanceof HTMLElement,
                editorText,
            };
        });

        expect(navigationState.widgetVisible).toBe(true);
        expect(navigationState.renamedKeyValue).toBe("titleUpdated");
        expect(navigationState.activeParentFieldKey ?? navigationState.activeFieldKey).toBe("category");
        expect(navigationState.editorText.startsWith("j---")).toBe(false);
    });

    test("空文本字段通过 vim 回车后应进入编辑态，输入首字符时不应立即保存退出", async ({ page }) => {
        await waitForMockLayoutReady(page);
        await enableVimMode(page);
        await openMockFrontmatterNote(page);

        await page.evaluate(() => {
            const addButton = document.querySelector<HTMLButtonElement>(".fmv-add-button");
            addButton?.click();
        });

        await focusFrontmatterNavigationRow(page, "newField");
        await page.keyboard.press("Enter");

        const enteredEditState = await page.evaluate(() => {
            const activeElement = document.activeElement as HTMLElement | null;
            return {
                activeTag: activeElement?.tagName ?? null,
                activeClassName: activeElement?.className ?? null,
                activeParentFieldKey: activeElement?.closest?.("[data-frontmatter-field-key]")?.getAttribute("data-frontmatter-field-key") ?? null,
                activeFocusRole: activeElement?.getAttribute?.("data-frontmatter-focus-role") ?? null,
            };
        });

        expect(enteredEditState.activeTag).toBe("TEXTAREA");
        expect(enteredEditState.activeParentFieldKey).toBe("newField");
        expect(enteredEditState.activeFocusRole).toBe("value");

        await page.keyboard.press("A");

        const typedState = await page.evaluate(() => {
            const activeElement = document.activeElement as HTMLElement | null;
            const valueControl = document.querySelector<HTMLTextAreaElement>(
                '[data-frontmatter-field-key="newField"] [data-frontmatter-focus-role="value"].fmv-inline-text-control',
            );
            return {
                activeTag: activeElement?.tagName ?? null,
                activeClassName: activeElement?.className ?? null,
                activeParentFieldKey: activeElement?.closest?.("[data-frontmatter-field-key]")?.getAttribute("data-frontmatter-field-key") ?? null,
                activeFocusRole: activeElement?.getAttribute?.("data-frontmatter-focus-role") ?? null,
                fieldValue: valueControl?.value ?? null,
            };
        });

        expect(typedState.activeTag).toBe("TEXTAREA");
        expect(typedState.activeParentFieldKey).toBe("newField");
        expect(typedState.activeFocusRole).toBe("value");
        expect(typedState.fieldValue).toBe("A");
    });

    test("frontmatter 字段名的 IME 确认回车不应被行级 vim 导航吞掉", async ({ page }) => {
        await waitForMockLayoutReady(page);
        await enableVimMode(page);
        await openMockFrontmatterNote(page);

        await dispatchImeConfirmEnterOnFrontmatterKey(page, "title");

        const imeState = await page.evaluate(() => {
            const activeElement = document.activeElement as HTMLElement | null;
            return {
                activeTag: activeElement?.tagName ?? null,
                activeFocusRole: activeElement?.getAttribute?.("data-frontmatter-focus-role") ?? null,
                activeParentFieldKey: activeElement?.closest?.("[data-frontmatter-field-key]")?.getAttribute("data-frontmatter-field-key") ?? null,
            };
        });

        expect(imeState.activeTag).toBe("TEXTAREA");
        expect(imeState.activeFocusRole).toBe("key");
        expect(imeState.activeParentFieldKey).toBe("title");
    });

    test("quick switch 同路径切换到 frontmatter 笔记后按 j 不应展开源码或写入首行", async ({ page }) => {
        await waitForMockLayoutReady(page);
        await enableVimMode(page);
        await openMockFrontmatterNote(page);
        await openMockFrontmatterNoteViaQuickSwitcher(page, "test-resources/notes/note1.md");
        await openMockFrontmatterNoteViaQuickSwitcher(page, "test-resources/notes/network-segment.md");

        await page.keyboard.press("j");

        const navigationState = await page.evaluate(() => {
            const content = document.querySelector(".cm-content") as (HTMLElement & {
                cmTile?: { view?: { state: { doc: { toString(): string } } } };
            }) | null;
            const activeElement = document.activeElement as HTMLElement | null;
            const widget = document.querySelector(".cm-frontmatter-widget");

            return {
                activeTag: activeElement?.tagName ?? null,
                activeParentFieldKey: activeElement?.closest?.("[data-frontmatter-field-key]")?.getAttribute("data-frontmatter-field-key") ?? null,
                docText: content?.cmTile?.view?.state.doc.toString() ?? "",
                widgetVisible: widget instanceof HTMLElement,
            };
        });

        expect(navigationState.widgetVisible).toBe(true);
        expect(navigationState.docText.startsWith("j---")).toBe(false);
        expect(navigationState.activeTag).not.toBe("TEXTAREA");
        expect(navigationState.activeParentFieldKey).toBeNull();
    });
});