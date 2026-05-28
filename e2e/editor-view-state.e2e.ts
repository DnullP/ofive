import { expect, test, type Page } from "@playwright/test";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0";
const SCROLL_NOTE_PATH = "test-resources/notes/scroll-regression.md";
const ALT_SCROLL_NOTE_PATH = "test-resources/notes/scroll-regression-alt.md";
const FRONTMATTER_NOTE_PATH = "test-resources/notes/network-segment.md";
const LARGE_TABLE_SCROLL_NOTE_PATH = "test-resources/notes/big-tables-drift.md";

interface CodeMirrorContentElement extends HTMLElement {
    cmTile?: {
        view?: {
            focus(): void;
            state: {
                doc: {
                    length: number;
                    toString(): string;
                };
                selection: {
                    main: {
                        anchor: number;
                        head: number;
                    };
                };
            };
            dispatch(spec: unknown): void;
        };
    };
}

interface EditorScrollStabilitySample {
    scrollTop: number;
    scrollHeight: number;
    tableWidgetCount: number;
    tableWidgetHeight: number;
    frontmatterWidgetCount: number;
    codeBlockWidgetCount: number;
    latexWidgetCount: number;
    firstVisibleText: string;
}

async function waitForMockWorkbench(page: Page): Promise<void> {
    await page.goto(MOCK_PAGE);
    await page.locator("[data-workbench-layout-mode='layout-v2']").waitFor({ state: "visible" });
    await page.locator("[data-testid='sidebar-right']").waitFor({ state: "visible" });
}

async function expandMockNotes(page: Page): Promise<void> {
    const notesTreeItem = page.locator(".tree-item[data-tree-path='test-resources/notes']");
    if (await notesTreeItem.count()) {
        return;
    }

    await page.locator(".tree-item[data-tree-path='test-resources']").click();
    await page.locator(".tree-item[data-tree-path='test-resources/notes']").click();
}

async function openMockNote(page: Page, relativePath: string): Promise<void> {
    await expandMockNotes(page);
    const fileName = relativePath.split("/").pop() ?? relativePath;
    await page.locator(`.tree-item[data-tree-path='${relativePath}']`).click();
    await page.getByRole("button", { name: fileName }).first().waitFor({ state: "visible" });
}

async function clickVisibleEditor(page: Page, offsetX: number, offsetY: number): Promise<void> {
    const editor = page.locator(".layout-v2-tab-section__card[aria-hidden='false'] .cm-editor").first();
    const box = await editor.boundingBox();
    if (!box) {
        throw new Error("clickVisibleEditor: editor bounds missing");
    }

    await page.mouse.click(box.x + offsetX, box.y + offsetY);
}

async function moveMouseToVisibleEditorCenter(page: Page): Promise<void> {
    const editor = page.locator(".layout-v2-tab-section__card[aria-hidden='false'] .cm-editor").first();
    const box = await editor.boundingBox();
    if (!box) {
        throw new Error("moveMouseToVisibleEditorCenter: editor bounds missing");
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function setVisibleEditorScrollTop(page: Page, scrollTop: number): Promise<void> {
    await page.evaluate((nextScrollTop) => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card[aria-hidden='false']");
        const editor = activeCard?.querySelector<HTMLElement>(".cm-editor") ?? null;
        const scroller = editor?.querySelector(".cm-scroller");
        if (scroller instanceof HTMLElement) {
            scroller.scrollTop = nextScrollTop;
        }
    }, scrollTop);
}

async function setVisibleEditorScrollNearBottom(page: Page, bottomOffset: number): Promise<void> {
    await page.evaluate((offset) => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card[aria-hidden='false']");
        const editor = activeCard?.querySelector<HTMLElement>(".cm-editor") ?? null;
        const scroller = editor?.querySelector(".cm-scroller");
        if (scroller instanceof HTMLElement) {
            scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - offset);
        }
    }, bottomOffset);
}

async function findVisibleEditorOffset(page: Page, text: string): Promise<number> {
    return page.evaluate((needle) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as CodeMirrorContentElement | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found on .cm-content");
        }

        const offset = view.state.doc.toString().indexOf(needle);
        if (offset < 0) {
            throw new Error(`Could not find editor text: ${needle}`);
        }

        return offset;
    }, text);
}

async function setVisibleEditorSelection(page: Page, offset: number): Promise<void> {
    await page.evaluate((targetOffset) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as CodeMirrorContentElement | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found on .cm-content");
        }

        const clampedOffset = Math.max(0, Math.min(targetOffset, view.state.doc.length));
        view.dispatch({
            selection: {
                anchor: clampedOffset,
            },
            scrollIntoView: true,
        });
        view.focus();
    }, offset);
}

async function readVisibleEditorSelection(page: Page): Promise<{ anchor: number; head: number }> {
    return page.evaluate(() => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as CodeMirrorContentElement | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found on .cm-content");
        }

        return {
            anchor: view.state.selection.main.anchor,
            head: view.state.selection.main.head,
        };
    });
}

async function readVisibleEditorState(page: Page): Promise<{
    title: string | null;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    selectionCollapsed: boolean;
    selectionText: string;
    editorHasFocus: boolean;
}> {
    return page.evaluate(() => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card[aria-hidden='false']");
        const editor = activeCard?.querySelector<HTMLElement>(".cm-editor") ?? null;
        if (!editor) {
            throw new Error("readVisibleEditorState: visible editor missing");
        }

        const scroller = editor.querySelector(".cm-scroller");
        const titleInput = activeCard?.querySelector(".cm-tab-title-input");
        const selection = document.getSelection();

        return {
            title: titleInput instanceof HTMLInputElement ? titleInput.value : null,
            scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : 0,
            scrollHeight: scroller instanceof HTMLElement ? scroller.scrollHeight : 0,
            clientHeight: scroller instanceof HTMLElement ? scroller.clientHeight : 0,
            selectionCollapsed: selection?.isCollapsed ?? true,
            selectionText: selection?.toString() ?? "",
            editorHasFocus: editor.contains(document.activeElement),
        };
    });
}

async function replaceActiveEditorDoc(page: Page, markdown: string, cursorNeedle: string): Promise<void> {
    await page.locator(".layout-v2-tab-section__card--active .cm-content").waitFor({ state: "visible" });
    await page.evaluate(({ nextMarkdown, needle }) => {
        const content = document.querySelector(".layout-v2-tab-section__card--active .cm-content") as CodeMirrorContentElement | null;
        const view = content?.cmTile?.view;
        if (!view) {
            throw new Error("EditorView not found on .cm-content");
        }

        const needleIndex = nextMarkdown.indexOf(needle);
        if (needleIndex < 0) {
            throw new Error(`Needle not found: ${needle}`);
        }

        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: nextMarkdown },
            selection: { anchor: needleIndex + needle.length },
            scrollIntoView: true,
        });
    }, { nextMarkdown: markdown, needle: cursorNeedle });
}

async function createLargeMarkdownTableScrollDocument(): Promise<string> {
    return [
        "# Runtime Large Table Scroll Regression",
        "",
        "Prelude before runtime generated tables.",
        "",
        ...Array.from({ length: 14 }, (_, tableIndex) => {
            const tableLabel = String(tableIndex + 1).padStart(2, "0");
            return [
                `## Runtime Large Table ${tableLabel}`,
                "",
                "| Metric | Owner | Status | Detail |",
                "| --- | --- | --- | --- |",
                ...Array.from({ length: 52 }, (_, rowIndex) => {
                    const rowLabel = String(rowIndex + 1).padStart(2, "0");
                    return `| R${tableLabel}-${rowLabel} | Team ${((rowIndex % 6) + 1).toString()} | Active | Runtime generated table ${tableLabel} row ${rowLabel} keeps the widget visually large during scrolling. |`;
                }),
                "",
            ];
        }).flat(),
        "## Runtime Tail",
        "",
        ...Array.from({ length: 96 }, (_, index) => {
            const lineNumber = String(index + 1).padStart(3, "0");
            return `${lineNumber}. Runtime tail checkpoint ${lineNumber}.`;
        }),
    ].join("\n");
}

function createComprehensiveMarkdownScrollDocument(): string {
    const frontmatter = [
        "---",
        "title: Comprehensive Scroll Stability Article",
        "aliases:",
        "  - Scroll Stability",
        "  - Continuous Editor Wheel Regression",
        "tags:",
        "  - ofive",
        "  - editor",
        "  - regression",
        "  - scroll",
        "created: 2026-05-29",
        "updated: 2026-05-29",
        "status: active",
        "owners:",
        "  - Editor Platform",
        "  - Interaction Quality",
        "reviewers:",
        "  - UX",
        "  - Runtime",
        "milestones:",
        "  - name: Baseline parity",
        "    state: running",
        "  - name: Scroll confidence",
        "    state: validating",
        "metrics:",
        "  expected_direction_reversals: 0",
        "  jitter_budget_px: 180",
        "  article_profile: mixed-content",
        "links:",
        "  source: [[scroll-regression]]",
        "  related: [[network-segment]]",
        "---",
        "",
    ];

    const buildTable = (sectionIndex: number): string[] => {
        return [
            "| Area | Signal | Current | Target | Notes |",
            "| --- | --- | --- | --- | --- |",
            ...Array.from({ length: 18 }, (_, rowIndex) => {
                const rowNumber = String(rowIndex + 1).padStart(2, "0");
                return `| Section ${sectionIndex} | Scroll sample ${rowNumber} | ${120 + rowIndex}px | stable | Mixed table row ${rowNumber} keeps visual table replacement active. |`;
            }),
            "",
        ];
    };

    const buildCodeBlock = (sectionIndex: number): string[] => [
        "```ts",
        `const section${sectionIndex}ScrollProbe = {`,
        `    section: ${sectionIndex},`,
        "    direction: \"bidirectional\",",
        "    expected: \"monotonic unless the boundary has been reached\",",
        "};",
        "",
        `console.info("scroll probe", section${sectionIndex}ScrollProbe);`,
        "```",
        "",
    ];

    const buildLatexBlock = (sectionIndex: number): string[] => [
        "$$",
        `S_${sectionIndex} = \\sum_{i=1}^{24} \\frac{i}{i + ${sectionIndex}}`,
        "$$",
        "",
    ];

    const sections = Array.from({ length: 24 }, (_, zeroIndex) => {
        const sectionIndex = zeroIndex + 1;
        const headingLevel = sectionIndex % 4 === 0 ? "###" : "##";
        const sectionLines = [
            `${headingLevel} Mixed Content Section ${String(sectionIndex).padStart(2, "0")}`,
            "",
            `Article Body Start ${sectionIndex}. This paragraph includes **bold text**, *emphasis*, ==highlight markers==, inline math $x_${sectionIndex}^2$, a [[wiki-link-${sectionIndex}]], and a plain URL https://example.com/ofive/${sectionIndex}.`,
            `The second paragraph is intentionally longer so the viewport sees ordinary text between rich blocks. It checks that CodeMirror virtualization, markdown render plugins, and tab header scroll logic can cooperate while a reader keeps moving without stopping.`,
            "",
            "> [!note] Scroll observation",
            `> Section ${sectionIndex} keeps a callout-like quote in the stream so blockquote styling participates in the same document height map.`,
            "",
            "- [ ] Capture downward wheel samples",
            "- [x] Preserve the active editor scroll container",
            `- [ ] Confirm section ${sectionIndex} has no reverse jump during continuous input`,
            "",
            `1. Ordered checkpoint ${sectionIndex}.1`,
            `2. Ordered checkpoint ${sectionIndex}.2 with \`inline code\` and another [[reference-${sectionIndex}]].`,
            "",
        ];

        if (sectionIndex % 3 === 0) {
            sectionLines.push(...buildTable(sectionIndex));
        }

        if (sectionIndex % 4 === 0) {
            sectionLines.push(...buildCodeBlock(sectionIndex));
        }

        if (sectionIndex % 5 === 0) {
            sectionLines.push(...buildLatexBlock(sectionIndex));
        }

        sectionLines.push(
            `Closing paragraph for section ${sectionIndex}. Continuous scrolling should advance through this text without sudden scrollTop compensation.`,
            "",
        );
        return sectionLines;
    }).flat();

    return [
        ...frontmatter,
        "# Comprehensive Scroll Stability Article",
        "",
        "This generated article intentionally mixes the markdown features that tend to alter visual height: frontmatter, tables, code fences, quotes, lists, links, inline syntax, and LaTeX blocks.",
        "",
        ...sections,
        "## Final Checkpoint",
        "",
        ...Array.from({ length: 80 }, (_, index) => {
            const lineNumber = String(index + 1).padStart(2, "0");
            return `Tail checkpoint ${lineNumber}: the bottom boundary should stop cleanly and the upward pass should not jump away from the reader.`;
        }),
    ].join("\n");
}

async function startEditorScrollStabilityMonitor(page: Page): Promise<void> {
    await page.evaluate(() => {
        const monitorKey = "__OFIVE_EDITOR_SCROLL_STABILITY_MONITOR__";
        const existingMonitor = (window as any)[monitorKey];
        if (existingMonitor?.stop) {
            existingMonitor.stop();
        }

        const samples: Array<EditorScrollStabilitySample> = [];
        let frameId = 0;

        const sample = (): void => {
            const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card[aria-hidden='false']");
            const editor = activeCard?.querySelector<HTMLElement>(".cm-editor") ?? null;
            const scroller = editor?.querySelector<HTMLElement>(".cm-scroller") ?? null;
            if (scroller) {
                samples.push({
                    scrollTop: scroller.scrollTop,
                    scrollHeight: scroller.scrollHeight,
                    tableWidgetCount: activeCard?.querySelectorAll(".cm-markdown-table-widget").length ?? 0,
                    tableWidgetHeight: activeCard?.querySelector<HTMLElement>(".cm-markdown-table-widget")
                        ?.getBoundingClientRect().height ?? 0,
                    frontmatterWidgetCount: activeCard?.querySelectorAll(".cm-frontmatter-widget").length ?? 0,
                    codeBlockWidgetCount: activeCard?.querySelectorAll(".cm-code-block, .cm-codeblock, pre code").length ?? 0,
                    latexWidgetCount: activeCard?.querySelectorAll(".cm-latex-widget, .katex, .katex-display").length ?? 0,
                    firstVisibleText: activeCard?.querySelector<HTMLElement>(".cm-content .cm-line")
                        ?.textContent?.slice(0, 100) ?? "",
                });
            }

            frameId = window.requestAnimationFrame(sample);
        };

        frameId = window.requestAnimationFrame(sample);
        (window as any)[monitorKey] = {
            samples,
            stop: () => window.cancelAnimationFrame(frameId),
        };
    });
}

async function stopEditorScrollStabilityMonitor(page: Page): Promise<EditorScrollStabilitySample[]> {
    return page.evaluate(() => {
        const monitorKey = "__OFIVE_EDITOR_SCROLL_STABILITY_MONITOR__";
        const monitor = (window as any)[monitorKey];
        if (!monitor) {
            return [];
        }

        monitor.stop();
        return monitor.samples;
    });
}

async function performContinuousEditorWheelScroll(
    page: Page,
    deltaY: number,
    stepLimit: number,
): Promise<void> {
    for (let stepIndex = 0; stepIndex < stepLimit; stepIndex += 1) {
        await page.mouse.wheel(0, deltaY);
        await page.waitForTimeout(10);

        if (stepIndex % 4 === 3) {
            const state = await readVisibleEditorState(page);
            const distanceToBottom = state.scrollHeight - state.clientHeight - state.scrollTop;
            if (deltaY > 0 && distanceToBottom <= 6) {
                break;
            }
            if (deltaY < 0 && state.scrollTop <= 6) {
                break;
            }
        }
    }

    await waitForEditorActivationFrame(page);
}

async function scrollVisibleEditorToBoundary(page: Page, boundary: "top" | "bottom"): Promise<void> {
    await page.evaluate((targetBoundary) => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card[aria-hidden='false']");
        const editor = activeCard?.querySelector<HTMLElement>(".cm-editor") ?? null;
        const scroller = editor?.querySelector<HTMLElement>(".cm-scroller") ?? null;
        if (!scroller) {
            throw new Error("scrollVisibleEditorToBoundary: visible editor scroller missing");
        }

        scroller.scrollTop = targetBoundary === "bottom"
            ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
            : 0;
        scroller.dispatchEvent(new Event("scroll"));
    }, boundary);
    await waitForEditorActivationFrame(page);
}

function analyzeDirectionalScrollStability(
    samples: EditorScrollStabilitySample[],
    direction: "down" | "up",
): {
    maxReverseDelta: number;
    maxScrollHeightDelta: number;
} {
    let maxReverseDelta = 0;
    let maxScrollHeightDelta = 0;

    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1]!;
        const current = samples[index]!;
        const reverseDelta = direction === "down"
            ? previous.scrollTop - current.scrollTop
            : current.scrollTop - previous.scrollTop;

        maxReverseDelta = Math.max(maxReverseDelta, reverseDelta);
        maxScrollHeightDelta = Math.max(
            maxScrollHeightDelta,
            Math.abs(current.scrollHeight - previous.scrollHeight),
        );
    }

    return {
        maxReverseDelta,
        maxScrollHeightDelta,
    };
}

async function waitForLargeTableWidgets(page: Page, minimumCount: number): Promise<void> {
    await expect.poll(async () => page.locator(".layout-v2-tab-section__card--active .cm-markdown-table-widget").count())
        .toBeGreaterThanOrEqual(minimumCount);
}

async function waitForVisibleEditorTitle(page: Page, expectedTitle: string): Promise<void> {
    await expect.poll(async () => (await readVisibleEditorState(page)).title).toBe(expectedTitle);
}

async function readVisibleEditorFrontmatterState(page: Page): Promise<{
    frontmatterWidgetCount: number;
    hiddenSourceLineCount: number;
}> {
    return page.evaluate(() => {
        const activeCard = document.querySelector<HTMLElement>(".layout-v2-tab-section__card[aria-hidden='false']");
        if (!activeCard) {
            throw new Error("readVisibleEditorFrontmatterState: visible editor missing");
        }

        return {
            frontmatterWidgetCount: activeCard.querySelectorAll(".cm-frontmatter-widget").length,
            hiddenSourceLineCount: activeCard.querySelectorAll(
                ".cm-hidden-block-line, .cm-hidden-block-anchor-line",
            ).length,
        };
    });
}

async function startFrontmatterPresentationMonitor(page: Page): Promise<void> {
    await page.evaluate(() => {
        const monitorKey = "__OFIVE_FRONTMATTER_PRESENTATION_MONITOR__";
        const existingMonitor = (window as any)[monitorKey];
        if (existingMonitor?.stop) {
            existingMonitor.stop();
        }

        const samples: Array<{
            title: string | null;
            presentationState: string | null;
            frontmatterWidgetCount: number;
            hiddenSourceLineCount: number;
            rawVisibleDelimiterCount: number;
        }> = [];
        let frameId = 0;

        const isRenderedElementVisible = (element: HTMLElement): boolean => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };

        const readRawVisibleDelimiterCount = (activeCard: HTMLElement): number => {
            return Array.from(activeCard.querySelectorAll<HTMLElement>(".cm-line"))
                .filter((lineElement) => {
                    if (lineElement.textContent?.trim() !== "---") {
                        return false;
                    }

                    if (
                        lineElement.classList.contains("cm-hidden-block-line") ||
                        lineElement.classList.contains("cm-hidden-block-anchor-line")
                    ) {
                        return false;
                    }

                    return isRenderedElementVisible(lineElement);
                }).length;
        };

        const sample = (): void => {
            const activeEditorCard = Array.from(document.querySelectorAll<HTMLElement>(
                ".layout-v2-tab-section__card[aria-hidden='false']",
            )).find((card) => card.querySelector(".cm-editor"));

            if (activeEditorCard) {
                const titleInput = activeEditorCard.querySelector<HTMLInputElement>(".cm-tab-title-input");
                samples.push({
                    title: titleInput instanceof HTMLInputElement ? titleInput.value : null,
                    presentationState: activeEditorCard.dataset.layoutPresentationState ?? null,
                    frontmatterWidgetCount: activeEditorCard.querySelectorAll(".cm-frontmatter-widget .fmv-editor").length,
                    hiddenSourceLineCount: activeEditorCard.querySelectorAll(
                        ".cm-hidden-block-line, .cm-hidden-block-anchor-line",
                    ).length,
                    rawVisibleDelimiterCount: readRawVisibleDelimiterCount(activeEditorCard),
                });
            }

            frameId = window.requestAnimationFrame(sample);
        };

        frameId = window.requestAnimationFrame(sample);
        (window as any)[monitorKey] = {
            samples,
            stop: () => window.cancelAnimationFrame(frameId),
        };
    });
}

async function stopFrontmatterPresentationMonitor(page: Page): Promise<Array<{
    title: string | null;
    presentationState: string | null;
    frontmatterWidgetCount: number;
    hiddenSourceLineCount: number;
    rawVisibleDelimiterCount: number;
}>> {
    return page.evaluate(() => {
        const monitorKey = "__OFIVE_FRONTMATTER_PRESENTATION_MONITOR__";
        const monitor = (window as any)[monitorKey];
        if (!monitor) {
            return [];
        }

        monitor.stop();
        return monitor.samples;
    });
}

async function waitForFrontmatterPresentationSample(page: Page, title: string): Promise<void> {
    await expect.poll(async () => page.evaluate((expectedTitle) => {
        const monitorKey = "__OFIVE_FRONTMATTER_PRESENTATION_MONITOR__";
        const monitor = (window as any)[monitorKey];
        if (!monitor?.samples) {
            return 0;
        }

        return monitor.samples.filter((sample: { title: string | null }) => {
            return sample.title === expectedTitle;
        }).length;
    }, title)).toBeGreaterThan(0);
}

async function updateEditorTabRestoreMode(page: Page, nextMode: "viewport" | "cursor"): Promise<void> {
    await page.evaluate(async (mode) => {
        const configStoreModule = await import("/src/host/config/configStore.ts");
        await configStoreModule.updateFeatureSetting("editorTabRestoreMode", mode);
    }, nextMode);
}

async function waitForEditorActivationFrame(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
        });
    }));
}

test.describe("editor view state regression", () => {
    test.beforeEach(async ({ page }) => {
        await waitForMockWorkbench(page);
        await updateEditorTabRestoreMode(page, "viewport");
    });

    test("switching editor tabs updates the visible title to the active file", async ({ page }) => {
        await openMockNote(page, SCROLL_NOTE_PATH);
        await openMockNote(page, ALT_SCROLL_NOTE_PATH);

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression");

        await page.getByRole("button", { name: "scroll-regression-alt.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression-alt");

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression");
    });

    test("viewport mode keeps frontmatter collapsed on first open", async ({ page }) => {
        await startFrontmatterPresentationMonitor(page);
        await openMockNote(page, FRONTMATTER_NOTE_PATH);
        await waitForEditorActivationFrame(page);

        const frontmatterState = await readVisibleEditorFrontmatterState(page);
        expect(frontmatterState.frontmatterWidgetCount).toBe(1);
        expect(frontmatterState.hiddenSourceLineCount).toBe(0);

        await waitForFrontmatterPresentationSample(page, "network-segment");
        const samples = await stopFrontmatterPresentationMonitor(page);
        const editorSamples = samples.filter((sample) => sample.title === "network-segment");
        expect(editorSamples.length).toBeGreaterThan(0);
        expect(editorSamples.every((sample) => sample.presentationState === "committed")).toBe(true);
        expect(editorSamples.some((sample) => sample.frontmatterWidgetCount === 1)).toBe(true);
        expect(editorSamples.every((sample) => sample.hiddenSourceLineCount === 0)).toBe(true);
        expect(editorSamples.every((sample) => sample.rawVisibleDelimiterCount === 0)).toBe(true);
    });

    test("viewport restore mode preserves reading progress without restoring editor focus", async ({ page }) => {
        await openMockNote(page, SCROLL_NOTE_PATH);
        await openMockNote(page, ALT_SCROLL_NOTE_PATH);

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await clickVisibleEditor(page, 140, 92);
        await setVisibleEditorScrollTop(page, 2800);

        const beforeSwitch = await readVisibleEditorState(page);
        expect(beforeSwitch.title).toBe("scroll-regression");
        expect(beforeSwitch.scrollTop).toBeGreaterThan(2600);
        expect(beforeSwitch.scrollHeight - beforeSwitch.clientHeight).toBeGreaterThan(2600);

        await page.getByRole("button", { name: "scroll-regression-alt.md" }).first().click();
        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression");

        const afterSwitch = await readVisibleEditorState(page);
        expect(afterSwitch.title).toBe("scroll-regression");
        expect(Math.abs(afterSwitch.scrollTop - beforeSwitch.scrollTop)).toBeLessThan(48);
        expect(afterSwitch.editorHasFocus).toBe(false);

        await clickVisibleEditor(page, 220, 320);

        const afterRefocus = await readVisibleEditorState(page);
        expect(afterRefocus.title).toBe("scroll-regression");
        expect(Math.abs(afterRefocus.scrollTop - beforeSwitch.scrollTop)).toBeLessThan(96);
        expect(afterRefocus.editorHasFocus).toBe(true);
    });

    test("cursor restore mode refocuses the editor and reveals the saved caret position", async ({ page }) => {
        await updateEditorTabRestoreMode(page, "cursor");
        await openMockNote(page, SCROLL_NOTE_PATH);
        await openMockNote(page, ALT_SCROLL_NOTE_PATH);

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await clickVisibleEditor(page, 40, 24);
        await setVisibleEditorScrollTop(page, 2800);

        const beforeSwitch = await readVisibleEditorState(page);
        expect(beforeSwitch.scrollTop).toBeGreaterThan(2600);

        await page.getByRole("button", { name: "scroll-regression-alt.md" }).first().click();
        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression");
        await waitForEditorActivationFrame(page);

        await expect.poll(async () => {
            const state = await readVisibleEditorState(page);
            return state.title === "scroll-regression"
                && state.scrollTop < 240
                && state.editorHasFocus;
        }).toBe(true);

        const afterSwitch = await readVisibleEditorState(page);
        expect(afterSwitch.title).toBe("scroll-regression");
        expect(afterSwitch.scrollTop).toBeLessThan(240);
        expect(afterSwitch.editorHasFocus).toBe(true);
    });

    test("settings tab switch restores editor reading progress immediately", async ({ page }) => {
        await openMockNote(page, SCROLL_NOTE_PATH);

        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await clickVisibleEditor(page, 140, 92);
        await setVisibleEditorScrollTop(page, 2800);

        const beforeSwitch = await readVisibleEditorState(page);
        expect(beforeSwitch.title).toBe("scroll-regression");
        expect(beforeSwitch.scrollTop).toBeGreaterThan(2600);

        await page.getByTestId("activity-bar-item-__settings__").click();
        await expect(page.locator(".layout-v2-tab-section__tab--focused").filter({ hasText: /设置|Settings/ })).toBeVisible();
        await page.getByRole("button", { name: "scroll-regression.md" }).first().click();
        await waitForVisibleEditorTitle(page, "scroll-regression");

        const afterSwitch = await readVisibleEditorState(page);
        expect(afterSwitch.title).toBe("scroll-regression");
        expect(Math.abs(afterSwitch.scrollTop - beforeSwitch.scrollTop)).toBeLessThan(96);
    });

    test("closing settings tab returns to the editor without resetting the caret", async ({ page }) => {
        await openMockNote(page, SCROLL_NOTE_PATH);
        await waitForVisibleEditorTitle(page, "scroll-regression");

        const caretOffset = await findVisibleEditorOffset(page, "120. Scroll regression checkpoint line 120.");
        await setVisibleEditorSelection(page, caretOffset);
        expect(await readVisibleEditorSelection(page)).toEqual({
            anchor: caretOffset,
            head: caretOffset,
        });

        await page.getByTestId("activity-bar-item-__settings__").click();
        await expect(page.locator(".layout-v2-tab-section__tab--focused").filter({ hasText: /设置|Settings/ })).toBeVisible();
        await page.locator(".layout-v2-tab-section__tab--focused .layout-v2-tab-section__tab-close").click();
        await waitForVisibleEditorTitle(page, "scroll-regression");
        await waitForEditorActivationFrame(page);

        expect(await readVisibleEditorSelection(page)).toEqual({
            anchor: caretOffset,
            head: caretOffset,
        });
    });

    test("sidebar activity switch does not yank editor scroll or create a range selection", async ({ page }) => {
        await openMockNote(page, SCROLL_NOTE_PATH);
        await clickVisibleEditor(page, 140, 92);
        await setVisibleEditorScrollTop(page, 2800);

        const beforeSidebarSwitch = await readVisibleEditorState(page);
        await page.locator("[data-testid='sidebar-right'] [data-layout-panel-id='ai-chat'][data-layout-role='panel']").click();
        await page.locator("[data-testid='sidebar-right'] [data-layout-panel-id='outline'][data-layout-role='panel']").click();
        await clickVisibleEditor(page, 320, 360);

        const afterSidebarSwitch = await readVisibleEditorState(page);
        expect(afterSidebarSwitch.selectionCollapsed).toBe(true);
        expect(afterSidebarSwitch.selectionText).toBe("");
        expect(afterSidebarSwitch.scrollTop).toBeGreaterThan(beforeSidebarSwitch.scrollTop - 120);
    });

    test("large markdown tables do not drift or teleport while scrolling", async ({ page }) => {
        await openMockNote(page, LARGE_TABLE_SCROLL_NOTE_PATH);
        await waitForLargeTableWidgets(page, 1);
        await replaceActiveEditorDoc(
            page,
            await createLargeMarkdownTableScrollDocument(),
            "Runtime Tail",
        );
        await waitForLargeTableWidgets(page, 1);
        await setVisibleEditorScrollTop(page, 0);
        await page.waitForTimeout(160);
        await moveMouseToVisibleEditorCenter(page);

        await startEditorScrollStabilityMonitor(page);
        for (let stepIndex = 0; stepIndex < 12; stepIndex += 1) {
            await page.mouse.wheel(0, 640);
            await page.waitForTimeout(70);
        }

        const duringScrollSamples = await stopEditorScrollStabilityMonitor(page);
        expect(duringScrollSamples.length).toBeGreaterThan(8);
        expect(duringScrollSamples.some((sample) => sample.tableWidgetCount > 0)).toBe(true);

        let maxUnexpectedJump = 0;
        for (let index = 1; index < duringScrollSamples.length; index += 1) {
            const previous = duringScrollSamples[index - 1]!;
            const current = duringScrollSamples[index]!;
            const scrollDelta = Math.abs(current.scrollTop - previous.scrollTop);
            const heightDelta = Math.abs(current.scrollHeight - previous.scrollHeight);
            maxUnexpectedJump = Math.max(maxUnexpectedJump, Math.max(0, scrollDelta - heightDelta));
        }

        expect(maxUnexpectedJump).toBeLessThan(2400);

        const settledBefore = await readVisibleEditorState(page);
        await page.waitForTimeout(180);
        const settledAfter = await readVisibleEditorState(page);
        expect(Math.abs(settledAfter.scrollTop - settledBefore.scrollTop)).toBeLessThan(32);
    });

    test("large markdown tables do not reverse-jump while scrolling upward", async ({ page }) => {
        await openMockNote(page, LARGE_TABLE_SCROLL_NOTE_PATH);
        await waitForLargeTableWidgets(page, 1);
        await replaceActiveEditorDoc(
            page,
            await createLargeMarkdownTableScrollDocument(),
            "Runtime Tail",
        );
        await waitForLargeTableWidgets(page, 1);
        await setVisibleEditorScrollNearBottom(page, 96);
        await page.waitForTimeout(160);
        await moveMouseToVisibleEditorCenter(page);

        await startEditorScrollStabilityMonitor(page);
        for (let stepIndex = 0; stepIndex < 18; stepIndex += 1) {
            await page.mouse.wheel(0, -640);
            await page.waitForTimeout(70);
        }

        const duringScrollSamples = await stopEditorScrollStabilityMonitor(page);
        expect(duringScrollSamples.length).toBeGreaterThan(8);
        expect(duringScrollSamples.some((sample) => sample.tableWidgetCount > 0 && sample.tableWidgetHeight > 1200))
            .toBe(true);

        let maxReverseScrollJump = 0;
        let maxScrollHeightDelta = 0;
        for (let index = 1; index < duringScrollSamples.length; index += 1) {
            const previous = duringScrollSamples[index - 1]!;
            const current = duringScrollSamples[index]!;
            maxReverseScrollJump = Math.max(
                maxReverseScrollJump,
                current.scrollTop - previous.scrollTop,
            );
            maxScrollHeightDelta = Math.max(
                maxScrollHeightDelta,
                Math.abs(current.scrollHeight - previous.scrollHeight),
            );
        }

        expect(maxReverseScrollJump).toBeLessThan(240);
        expect(maxScrollHeightDelta).toBeLessThan(480);
    });

    test("comprehensive markdown article scrolls down and back up without jitter", async ({ page }) => {
        test.slow();
        await openMockNote(page, LARGE_TABLE_SCROLL_NOTE_PATH);
        await replaceActiveEditorDoc(
            page,
            createComprehensiveMarkdownScrollDocument(),
            "This generated article intentionally mixes",
        );
        await expect(page.locator(".layout-v2-tab-section__card--active .cm-frontmatter-widget").first())
            .toBeVisible();
        await setVisibleEditorScrollTop(page, 0);
        await page.waitForTimeout(180);
        await moveMouseToVisibleEditorCenter(page);

        const initialState = await readVisibleEditorState(page);
        expect(initialState.scrollHeight - initialState.clientHeight).toBeGreaterThan(6000);

        await startEditorScrollStabilityMonitor(page);
        await performContinuousEditorWheelScroll(page, 900, 240);
        const downwardSamples = await stopEditorScrollStabilityMonitor(page);
        const afterDownwardScroll = await readVisibleEditorState(page);
        const downwardStability = analyzeDirectionalScrollStability(downwardSamples, "down");

        expect(downwardSamples.length).toBeGreaterThan(20);
        expect(downwardSamples.some((sample) => sample.frontmatterWidgetCount > 0)).toBe(true);
        expect(downwardSamples.some((sample) => sample.tableWidgetCount > 0)).toBe(true);
        expect(afterDownwardScroll.scrollTop).toBeGreaterThan(initialState.scrollTop + 4800);
        expect(downwardStability.maxReverseDelta).toBeLessThan(180);

        await scrollVisibleEditorToBoundary(page, "bottom");
        await page.waitForTimeout(180);
        const settledAtBottom = await readVisibleEditorState(page);
        expect(settledAtBottom.scrollHeight - settledAtBottom.clientHeight - settledAtBottom.scrollTop)
            .toBeLessThan(96);

        await startEditorScrollStabilityMonitor(page);
        await performContinuousEditorWheelScroll(page, -900, 240);
        const upwardSamples = await stopEditorScrollStabilityMonitor(page);
        const afterUpwardScroll = await readVisibleEditorState(page);
        const upwardStability = analyzeDirectionalScrollStability(upwardSamples, "up");

        expect(upwardSamples.length).toBeGreaterThan(20);
        expect(upwardSamples.some((sample) => sample.tableWidgetCount > 0)).toBe(true);
        expect(afterUpwardScroll.scrollTop).toBeLessThan(settledAtBottom.scrollTop - 4800);
        expect(upwardStability.maxReverseDelta).toBeLessThan(180);

        await scrollVisibleEditorToBoundary(page, "top");
        await page.waitForTimeout(180);
        const settledAtTop = await readVisibleEditorState(page);
        expect(settledAtTop.scrollTop).toBeLessThan(96);
        await expect(page.locator(".layout-v2-tab-section__card--active .cm-frontmatter-widget").first())
            .toBeVisible();
    });
});
