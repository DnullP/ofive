/**
 * @module e2e/workbench-section-performance
 * @description web-mock 主工作区 section 连续拖拽性能采样。
 *   固定恢复 editor + calendar + task board 多 section 布局，用同一条拖拽轨迹采集 rAF 和 Long Task。
 *   默认不打开 Chromium tracing，避免采样器本身像浏览器 event recording 一样明显扰动帧表现。
 *   需要归因时可用 OFIVE_PERF_TRACE=1 额外采集 Chromium timeline 事件。
 *
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/mockVault
 */

import { expect, test, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

const MOCK_PAGE = "/web-mock/mock-tauri-test.html?showControls=0&glass=0";
const BROWSER_FALLBACK_CONFIG_PREFIX = "ofive:browser-fallback:vault-config:";
const SHOULD_COLLECT_CHROMIUM_TRACE = process.env.OFIVE_PERF_TRACE === "1";
const TASK_NOTE_PATH = "test-resources/notes/task-board-e2e.md";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";
const NETWORK_NOTE_PATH = "test-resources/notes/network-segment.md";
const TABLE_EDITOR_NOTE_PATH = "test-resources/notes/table-editor.md";
const TABLE_VIM_NOTE_PATH = "test-resources/notes/table-vim-boundary.md";
const PERF_PLACEHOLDER_COMPONENT_ID = "performance-placeholder";

interface PerformanceScenarioConfig {
    id: string;
    calendarVisible: boolean;
    taskVisible: boolean;
    activeGroupId: string;
    expectedDom: ScenarioSummary["dom"];
}

const PERFORMANCE_SCENARIOS: PerformanceScenarioConfig[] = [
    {
        id: "editor-placeholders",
        calendarVisible: false,
        taskVisible: false,
        activeGroupId: "main-tabs",
        expectedDom: { tabSections: 3, taskCards: 0, calendarDays: 0, editors: 1 },
    },
    {
        id: "editor-calendar",
        calendarVisible: true,
        taskVisible: false,
        activeGroupId: "calendar-tabs",
        expectedDom: { tabSections: 3, taskCards: 0, calendarDays: 42, editors: 1 },
    },
    {
        id: "editor-task",
        calendarVisible: false,
        taskVisible: true,
        activeGroupId: "task-tabs",
        expectedDom: { tabSections: 3, taskCards: 2, calendarDays: 0, editors: 1 },
    },
    {
        id: "editor-calendar-task",
        calendarVisible: true,
        taskVisible: true,
        activeGroupId: "task-tabs",
        expectedDom: { tabSections: 3, taskCards: 2, calendarDays: 42, editors: 1 },
    },
];

interface FrameSample {
    delta: number;
    timestamp: number;
}

interface LongTaskSample {
    duration: number;
    startTime: number;
}

interface PerfSamplerSummary {
    label: string;
    durationMs: number;
    frameCount: number;
    frameDeltas: number[];
    maxFrameDelta: number;
    p50FrameDelta: number;
    p90FrameDelta: number;
    p95FrameDelta: number;
    p99FrameDelta: number;
    framesOver16: number;
    framesOver33: number;
    framesOver50: number;
    framesOver100: number;
    longTaskCount: number;
    longTaskTotalMs: number;
    longTaskMaxMs: number;
}

interface TraceEvent {
    name?: string;
    ph?: string;
    cat?: string;
    ts?: number;
    dur?: number;
}

interface TimelineSummaryItem {
    name: string;
    count: number;
    totalMs: number;
    maxMs: number;
}

interface ScenarioSummary {
    scenario: string;
    dom: {
        tabSections: number;
        taskCards: number;
        calendarDays: number;
        editors: number;
    };
    liveResize: LiveResizeSummary;
    sampler: PerfSamplerSummary;
    timelineTop: TimelineSummaryItem[];
    timelineSelected: TimelineSummaryItem[];
}

interface LiveResizeFrameSample {
    phase: "start" | "move" | "end";
    index: number;
    mainSlotWidth: number | null;
    rightSlotWidth: number | null;
    editorWidth: number | null;
    calendarWidth: number | null;
    taskBoardWidth: number | null;
    innerTransformCount: number;
}

interface LiveResizeSummary {
    strategy: string | null;
    sampleCount: number;
    mainSlotWidthRange: number;
    rightSlotWidthRange: number;
    editorWidthRange: number;
    calendarWidthRange: number;
    taskBoardWidthRange: number;
    distinctMainSlotWidths: number;
    distinctEditorWidths: number;
    distinctCalendarWidths: number;
    distinctTaskBoardWidths: number;
    maxInnerTransformCount: number;
    samples: LiveResizeFrameSample[];
}

declare global {
    interface Window {
        __OFIVE_E2E_PERF__?: {
            start: (label: string) => void;
            stop: () => PerfSamplerSummary;
        };
    }
}

function roundMetric(value: number): number {
    return Math.round(value * 10) / 10;
}

function compactScenarioSummary(summary: ScenarioSummary): Record<string, unknown> {
    const selectedByName = new Map(summary.timelineSelected.map((item) => [item.name, item]));
    return {
        scenario: summary.scenario,
        dom: summary.dom,
        liveResize: {
            strategy: summary.liveResize.strategy,
            samples: summary.liveResize.sampleCount,
            mainRange: summary.liveResize.mainSlotWidthRange,
            editorRange: summary.liveResize.editorWidthRange,
            calendarRange: summary.liveResize.calendarWidthRange,
            taskRange: summary.liveResize.taskBoardWidthRange,
            maxInnerTransforms: summary.liveResize.maxInnerTransformCount,
        },
        frames: {
            count: summary.sampler.frameCount,
            p95: summary.sampler.p95FrameDelta,
            p99: summary.sampler.p99FrameDelta,
            max: summary.sampler.maxFrameDelta,
            over33: summary.sampler.framesOver33,
            over50: summary.sampler.framesOver50,
            longTasks: summary.sampler.longTaskCount,
            longTaskMax: summary.sampler.longTaskMaxMs,
        },
        timelineMs: {
            raster: selectedByName.get("RasterTask")?.totalMs ?? 0,
            functionCall: selectedByName.get("FunctionCall")?.totalMs ?? 0,
            eventDispatch: selectedByName.get("EventDispatch")?.totalMs ?? 0,
            layout: selectedByName.get("Layout")?.totalMs ?? 0,
            paint: selectedByName.get("Paint")?.totalMs ?? 0,
            layerize: selectedByName.get("Layerize")?.totalMs ?? 0,
        },
    };
}

function workbenchNode(
    id: string,
    title: string,
    role: "root" | "container" | "activity-bar" | "sidebar" | "main",
    component: { type: string; props: Record<string, unknown> },
    split: Record<string, unknown> | null = null,
    meta?: Record<string, unknown>,
): Record<string, unknown> {
    return {
        id,
        title,
        data: { role, component },
        resizableEdges: { top: true, right: true, bottom: true, left: true },
        ...(meta ? { meta } : {}),
        split,
    };
}

function tabSectionNode(id: string, title: string, tabSectionId: string): Record<string, unknown> {
    return workbenchNode(
        id,
        title,
        "main",
        { type: "tab-section", props: { tabSectionId } },
    );
}

function buildMarkdownTab(path: string): Record<string, unknown> {
    return {
        id: `file:${path}`,
        title: path.split("/").pop() ?? path,
        component: "codemirror",
        params: { path },
    };
}

function buildPlaceholderTab(id: string, title: string): Record<string, unknown> {
    return {
        id,
        title,
        component: PERF_PLACEHOLDER_COMPONENT_ID,
    };
}

function buildPerformanceWorkspaceLayout(scenario: PerformanceScenarioConfig): Record<string, unknown> {
    const mainTabs = tabSectionNode("main-tabs", "Editor", "main-tabs");
    const calendarTabs = tabSectionNode("calendar-tabs", "Calendar", "calendar-tabs");
    const taskTabs = tabSectionNode("task-tabs", "Task Board", "task-tabs");
    const calendarActiveTab = scenario.calendarVisible
        ? { id: "calendar", title: "日历", component: "calendar-tab" }
        : buildPlaceholderTab("calendar-placeholder", "Calendar Placeholder");
    const taskActiveTab = scenario.taskVisible
        ? { id: "task-board", title: "任务看板", component: "task-board-tab" }
        : buildPlaceholderTab("task-placeholder", "Task Placeholder");
    const rightMainStack = workbenchNode(
        "right-main-stack",
        "Calendar And Tasks",
        "container",
        { type: "empty", props: { label: "Calendar and tasks", description: "performance fixture" } },
        {
            direction: "vertical",
            ratio: 0.48,
            children: [calendarTabs, taskTabs],
        },
    );
    const mainWorkspace = workbenchNode(
        "main-workspace",
        "Main Workspace",
        "container",
        { type: "empty", props: { label: "Main workspace", description: "performance fixture" } },
        {
            direction: "horizontal",
            ratio: 0.54,
            children: [mainTabs, rightMainStack],
        },
    );
    const centerShell = workbenchNode(
        "center-shell",
        "Center Shell",
        "container",
        { type: "empty", props: { label: "Center", description: "main region" } },
        {
            direction: "horizontal",
            ratio: 0.79,
            children: [
                mainWorkspace,
                workbenchNode(
                    "right-sidebar",
                    "Right Sidebar",
                    "sidebar",
                    { type: "panel-section", props: { panelSectionId: "right-panel-section" } },
                ),
            ],
        },
    );
    const workbenchShell = workbenchNode(
        "workbench-shell",
        "Workbench Shell",
        "container",
        { type: "empty", props: { label: "Workbench", description: "workbench container" } },
        {
            direction: "horizontal",
            ratio: 0.2,
            children: [
                workbenchNode(
                    "left-sidebar",
                    "Left Sidebar",
                    "sidebar",
                    { type: "panel-section", props: { panelSectionId: "left-panel-section" } },
                ),
                centerShell,
            ],
        },
    );

    return {
        version: 1,
        root: workbenchNode(
            "root",
            "Workbench Root",
            "root",
            { type: "empty", props: { label: "Root", description: "workbench root" } },
            {
                direction: "horizontal",
                ratio: 0.04,
                children: [
                    workbenchNode(
                        "left-activity-bar",
                        "Left Activity Bar",
                        "activity-bar",
                        { type: "activity-rail", props: {} },
                        null,
                        { fixedSizePx: 48 },
                    ),
                    workbenchShell,
                ],
            },
        ),
        tabSections: [
            {
                id: "main-tabs",
                tabs: [
                    buildMarkdownTab(TASK_NOTE_PATH),
                    buildMarkdownTab(GUIDE_NOTE_PATH),
                ],
                focusedTabId: `file:${TASK_NOTE_PATH}`,
                isRoot: true,
            },
            {
                id: "calendar-tabs",
                tabs: [
                    calendarActiveTab,
                    buildMarkdownTab(NETWORK_NOTE_PATH),
                ],
                focusedTabId: String(calendarActiveTab.id),
            },
            {
                id: "task-tabs",
                tabs: [
                    taskActiveTab,
                    buildMarkdownTab(TABLE_EDITOR_NOTE_PATH),
                    buildMarkdownTab(TABLE_VIM_NOTE_PATH),
                ],
                focusedTabId: String(taskActiveTab.id),
            },
        ],
        activeGroupId: scenario.activeGroupId,
    };
}

async function installPerformanceSampler(page: Page): Promise<void> {
    await page.evaluate(() => {
        const toQuantile = (values: number[], percentile: number): number => {
            if (values.length === 0) {
                return 0;
            }

            const sorted = [...values].sort((left, right) => left - right);
            const index = Math.min(
                sorted.length - 1,
                Math.max(0, Math.ceil(percentile * sorted.length) - 1),
            );
            return sorted[index] ?? 0;
        };

        const toRoundedMetric = (value: number): number => Math.round(value * 10) / 10;

        const summarize = (
            label: string,
            startTime: number,
            endTime: number,
            frames: FrameSample[],
            longTasks: LongTaskSample[],
        ): PerfSamplerSummary => {
            const frameDeltas = frames.map((frame) => frame.delta);
            const longTaskDurations = longTasks.map((task) => task.duration);
            return {
                label,
                durationMs: Math.round(endTime - startTime),
                frameCount: frameDeltas.length,
                frameDeltas,
                maxFrameDelta: toRoundedMetric(Math.max(0, ...frameDeltas)),
                p50FrameDelta: toRoundedMetric(toQuantile(frameDeltas, 0.5)),
                p90FrameDelta: toRoundedMetric(toQuantile(frameDeltas, 0.9)),
                p95FrameDelta: toRoundedMetric(toQuantile(frameDeltas, 0.95)),
                p99FrameDelta: toRoundedMetric(toQuantile(frameDeltas, 0.99)),
                framesOver16: frameDeltas.filter((delta) => delta > 16.7).length,
                framesOver33: frameDeltas.filter((delta) => delta > 33.4).length,
                framesOver50: frameDeltas.filter((delta) => delta > 50).length,
                framesOver100: frameDeltas.filter((delta) => delta > 100).length,
                longTaskCount: longTasks.length,
                longTaskTotalMs: toRoundedMetric(longTaskDurations.reduce((sum, duration) => sum + duration, 0)),
                longTaskMaxMs: toRoundedMetric(Math.max(0, ...longTaskDurations)),
            };
        };

        let active = false;
        let label = "";
        let startTime = 0;
        let previousFrameTime = 0;
        let frameId: number | null = null;
        let observer: PerformanceObserver | null = null;
        let frames: FrameSample[] = [];
        let longTasks: LongTaskSample[] = [];

        const tick = (timestamp: number): void => {
            if (!active) {
                return;
            }

            if (previousFrameTime > 0) {
                frames.push({
                    timestamp,
                    delta: timestamp - previousFrameTime,
                });
            }
            previousFrameTime = timestamp;
            frameId = window.requestAnimationFrame(tick);
        };

        window.__OFIVE_E2E_PERF__ = {
            start(nextLabel: string): void {
                if (frameId !== null) {
                    window.cancelAnimationFrame(frameId);
                }
                observer?.disconnect();

                active = true;
                label = nextLabel;
                frames = [];
                longTasks = [];
                startTime = performance.now();
                previousFrameTime = 0;

                if (typeof PerformanceObserver !== "undefined") {
                    try {
                        observer = new PerformanceObserver((list) => {
                            for (const entry of list.getEntries()) {
                                longTasks.push({
                                    startTime: entry.startTime,
                                    duration: entry.duration,
                                });
                            }
                        });
                        observer.observe({ type: "longtask", buffered: true });
                    } catch {
                        observer = null;
                    }
                }

                frameId = window.requestAnimationFrame(tick);
            },
            stop(): PerfSamplerSummary {
                const endTime = performance.now();
                active = false;
                if (frameId !== null) {
                    window.cancelAnimationFrame(frameId);
                    frameId = null;
                }
                observer?.disconnect();
                observer = null;
                return summarize(label, startTime, endTime, frames, longTasks);
            },
        };
    });
}

async function configurePerformanceFixture(
    page: Page,
    mockVaultPath: string,
    scenario: PerformanceScenarioConfig,
): Promise<void> {
    const config = {
        schemaVersion: 1,
        entries: {
            features: {
                restoreWorkspaceLayout: true,
                fileOpenMode: "new-tab",
                glassEffectEnabled: false,
                notificationsEnabled: false,
            },
            sidebarLayout: {
                version: 1,
                left: {
                    width: 260,
                    visible: true,
                    activeActivityId: "files",
                    activePanelId: "files",
                },
                right: {
                    width: 280,
                    visible: true,
                    activeActivityId: "ai-chat",
                    activePanelId: "ai-chat",
                },
            },
            workspaceLayout: buildPerformanceWorkspaceLayout(scenario),
        },
    };

    await page.evaluate(
        ({ storageKey, configValue }) => {
            window.localStorage.setItem(storageKey, JSON.stringify(configValue));
        },
        {
            storageKey: `${BROWSER_FALLBACK_CONFIG_PREFIX}${mockVaultPath}`,
            configValue: config,
        },
    );
    await page.reload();
}

async function waitForFixtureReady(page: Page, scenario: PerformanceScenarioConfig): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await expect(page.locator(".layout-v2-tab-section")).toHaveCount(3);
    await expect(page.locator("[data-tab-section-id='main-tabs'] .cm-editor")).toBeVisible();
    if (scenario.calendarVisible) {
        await expect(page.locator("[data-tab-section-id='calendar-tabs'] .calendar-tab__calendar-surface")).toBeVisible();
        await expect(page.locator("[data-tab-section-id='calendar-tabs'] .calendar-tab__day")).toHaveCount(42);
    } else {
        await expect(page.locator("[data-tab-section-id='calendar-tabs']")).toContainText("Unregistered: performance-placeholder");
    }

    if (scenario.taskVisible) {
        const taskSection = page.locator("[data-tab-section-id='task-tabs']");
        await expect(taskSection.locator(".task-board")).toBeVisible();
        await taskSection.getByRole("button", { name: /All|全部/ }).click();
        await expect(taskSection.locator(".task-board__task-card")).toHaveCount(2);
    } else {
        await expect(page.locator("[data-tab-section-id='task-tabs']")).toContainText("Unregistered: performance-placeholder");
    }
}

async function startChromiumTimelineTrace(page: Page): Promise<() => Promise<TraceEvent[]>> {
    const client = await page.context().newCDPSession(page);
    const events: TraceEvent[] = [];
    client.on("Tracing.dataCollected", (payload) => {
        events.push(...((payload as { value?: TraceEvent[] }).value ?? []));
    });

    await client.send("Tracing.start", {
        categories: [
            "devtools.timeline",
            "disabled-by-default-devtools.timeline",
            "blink.user_timing",
            "cc",
            "toplevel",
            "v8",
        ].join(","),
        transferMode: "ReportEvents",
    });

    return async () => {
        const complete = new Promise<void>((resolve) => {
            client.once("Tracing.tracingComplete", () => resolve());
        });
        await client.send("Tracing.end");
        await complete;
        await client.detach();
        return events;
    };
}

function summarizeTimelineEvents(events: TraceEvent[]): TimelineSummaryItem[] {
    const byName = new Map<string, { count: number; totalMs: number; maxMs: number }>();
    for (const event of events) {
        if (event.ph !== "X" || typeof event.dur !== "number" || event.dur <= 0) {
            continue;
        }

        const name = event.name ?? "unknown";
        const durationMs = event.dur / 1000;
        const current = byName.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
        current.count += 1;
        current.totalMs += durationMs;
        current.maxMs = Math.max(current.maxMs, durationMs);
        byName.set(name, current);
    }

    return [...byName.entries()]
        .map(([name, value]) => ({
            name,
            count: value.count,
            totalMs: roundMetric(value.totalMs),
            maxMs: roundMetric(value.maxMs),
        }))
        .sort((left, right) => right.totalMs - left.totalMs);
}

function summarizeLiveResizeSamples(
    samples: LiveResizeFrameSample[],
    strategy: string | null,
): LiveResizeSummary {
    const rangeFor = (selector: (sample: LiveResizeFrameSample) => number | null): number => {
        const values = samples
            .map(selector)
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        if (values.length === 0) {
            return 0;
        }
        return roundMetric(Math.max(...values) - Math.min(...values));
    };
    const distinctCountFor = (selector: (sample: LiveResizeFrameSample) => number | null): number => {
        const values = samples
            .map(selector)
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
            .map((value) => Math.round(value));
        return new Set(values).size;
    };

    return {
        strategy,
        sampleCount: samples.length,
        mainSlotWidthRange: rangeFor((sample) => sample.mainSlotWidth),
        rightSlotWidthRange: rangeFor((sample) => sample.rightSlotWidth),
        editorWidthRange: rangeFor((sample) => sample.editorWidth),
        calendarWidthRange: rangeFor((sample) => sample.calendarWidth),
        taskBoardWidthRange: rangeFor((sample) => sample.taskBoardWidth),
        distinctMainSlotWidths: distinctCountFor((sample) => sample.mainSlotWidth),
        distinctEditorWidths: distinctCountFor((sample) => sample.editorWidth),
        distinctCalendarWidths: distinctCountFor((sample) => sample.calendarWidth),
        distinctTaskBoardWidths: distinctCountFor((sample) => sample.taskBoardWidth),
        maxInnerTransformCount: Math.max(0, ...samples.map((sample) => sample.innerTransformCount)),
        samples,
    };
}

async function sampleLiveResizeDuringShortDrag(
    page: Page,
    dividerSelector: string,
    options: { delta: number; framesPerLeg: number },
): Promise<LiveResizeSummary> {
    const result = await page.evaluate(
        ({ selector, delta, framesPerLeg }) => new Promise<{ samples: LiveResizeFrameSample[]; strategy: string | null }>((resolve, reject) => {
            const divider = document.querySelector(selector);
            if (!(divider instanceof HTMLElement)) {
                reject(new Error(`Divider not found: ${selector}`));
                return;
            }

            const roundWidth = (value: number): number => Math.round(value * 10) / 10;
            const readWidth = (targetSelector: string): number | null => {
                const element = document.querySelector(targetSelector);
                return element instanceof HTMLElement
                    ? roundWidth(element.getBoundingClientRect().width)
                    : null;
            };
            const readMainWorkspaceSlotWidths = (): { mainSlotWidth: number | null; rightSlotWidth: number | null } => {
                const branch = document.querySelector("[data-section-id='main-workspace']");
                if (!(branch instanceof HTMLElement)) {
                    return { mainSlotWidth: null, rightSlotWidth: null };
                }
                const slots = Array.from(branch.children).filter((child): child is HTMLElement => (
                    child instanceof HTMLElement && child.classList.contains("layout-v2__child-slot")
                ));
                return {
                    mainSlotWidth: slots[0] ? roundWidth(slots[0].getBoundingClientRect().width) : null,
                    rightSlotWidth: slots[1] ? roundWidth(slots[1].getBoundingClientRect().width) : null,
                };
            };
            const samples: LiveResizeFrameSample[] = [];
            const countTransformedInnerNodes = (): number => {
                const branch = document.querySelector("[data-section-id='main-workspace']");
                if (!(branch instanceof HTMLElement)) {
                    return 0;
                }
                return Array.from(branch.querySelectorAll<HTMLElement>(".layout-v2__child-slot-inner"))
                    .filter((element) => {
                        const transform = window.getComputedStyle(element).transform;
                        return transform !== "" && transform !== "none";
                    })
                    .length;
            };
            const sample = (phase: LiveResizeFrameSample["phase"], index: number): void => {
                const slotWidths = readMainWorkspaceSlotWidths();
                samples.push({
                    phase,
                    index,
                    ...slotWidths,
                    editorWidth: readWidth("[data-tab-section-id='main-tabs'] .cm-editor"),
                    calendarWidth: readWidth("[data-tab-section-id='calendar-tabs'] .calendar-tab__calendar-surface"),
                    taskBoardWidth: readWidth("[data-tab-section-id='task-tabs'] .task-board"),
                    innerTransformCount: countTransformedInnerNodes(),
                });
            };

            const rect = divider.getBoundingClientRect();
            const startX = rect.left + rect.width / 2;
            const startY = rect.top + rect.height / 2;
            const pointerId = 23;
            const dispatchPointerEvent = (
                target: EventTarget,
                type: "pointerdown" | "pointermove" | "pointerup",
                x: number,
            ): void => {
                target.dispatchEvent(new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerId,
                    pointerType: "mouse",
                    isPrimary: true,
                    button: 0,
                    buttons: type === "pointerup" ? 0 : 1,
                    clientX: x,
                    clientY: startY,
                }));
            };

            const positions: number[] = [];
            let currentX = startX;
            for (const targetX of [startX + delta, startX - delta, startX]) {
                const legStartX = currentX;
                for (let frame = 1; frame <= framesPerLeg; frame += 1) {
                    positions.push(legStartX + ((targetX - legStartX) * frame) / framesPerLeg);
                }
                currentX = targetX;
            }

            let index = 0;
            dispatchPointerEvent(divider, "pointerdown", startX);
            sample("start", index);

            const dispatchNextMove = (): void => {
                const nextX = positions[index];
                if (typeof nextX !== "number") {
                    dispatchPointerEvent(window, "pointerup", currentX);
                    window.requestAnimationFrame(() => {
                        sample("end", index);
                        const root = document.querySelector(".layout-v2__root[data-layout-root-id]");
                        resolve({
                            samples,
                            strategy: root instanceof HTMLElement
                                ? root.getAttribute("data-layout-resize-strategy")
                                : null,
                        });
                    });
                    return;
                }

                dispatchPointerEvent(window, "pointermove", nextX);
                index += 1;
                window.requestAnimationFrame(() => {
                    sample("move", index);
                    dispatchNextMove();
                });
            };

            window.requestAnimationFrame(dispatchNextMove);
        }),
        {
            selector: dividerSelector,
            delta: options.delta,
            framesPerLeg: options.framesPerLeg,
        },
    );

    await page.waitForTimeout(80);
    return summarizeLiveResizeSamples(result.samples, result.strategy);
}

async function dragDividerBackAndForth(
    page: Page,
    dividerSelector: string,
    options: { delta: number; cycles: number; framesPerLeg: number },
): Promise<void> {
    await page.evaluate(
        ({ selector, delta, cycles, framesPerLeg }) => new Promise<void>((resolve, reject) => {
            const divider = document.querySelector(selector);
            if (!(divider instanceof HTMLElement)) {
                reject(new Error(`Divider not found: ${selector}`));
                return;
            }

            const rect = divider.getBoundingClientRect();
            const startX = rect.left + rect.width / 2;
            const startY = rect.top + rect.height / 2;
            const pointerId = 17;
            const dispatchPointerEvent = (
                target: EventTarget,
                type: "pointerdown" | "pointermove" | "pointerup",
                x: number,
            ): void => {
                target.dispatchEvent(new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerId,
                    pointerType: "mouse",
                    isPrimary: true,
                    button: 0,
                    buttons: type === "pointerup" ? 0 : 1,
                    clientX: x,
                    clientY: startY,
                }));
            };

            const positions: number[] = [];
            let currentX = startX;
            for (let cycle = 0; cycle < cycles; cycle += 1) {
                for (const targetX of [startX + delta, startX - delta, startX]) {
                    const legStartX = currentX;
                    for (let frame = 1; frame <= framesPerLeg; frame += 1) {
                        positions.push(legStartX + ((targetX - legStartX) * frame) / framesPerLeg);
                    }
                    currentX = targetX;
                }
            }

            let index = 0;
            dispatchPointerEvent(divider, "pointerdown", startX);
            const dispatchNextMove = (): void => {
                const nextX = positions[index];
                if (typeof nextX !== "number") {
                    dispatchPointerEvent(window, "pointerup", currentX);
                    window.requestAnimationFrame(() => resolve());
                    return;
                }

                dispatchPointerEvent(window, "pointermove", nextX);
                index += 1;
                window.requestAnimationFrame(dispatchNextMove);
            };

            window.requestAnimationFrame(dispatchNextMove);
        }),
        {
            selector: dividerSelector,
            delta: options.delta,
            cycles: options.cycles,
            framesPerLeg: options.framesPerLeg,
        },
    );
    await page.waitForTimeout(120);
}

async function runSectionDragScenario(page: Page, scenario: PerformanceScenarioConfig): Promise<ScenarioSummary> {
    const dividerSelector = "[data-section-id='main-workspace'] > .layout-v2__divider--horizontal[aria-label='Resize sections']";
    const liveResize = await sampleLiveResizeDuringShortDrag(
        page,
        dividerSelector,
        {
            delta: 120,
            framesPerLeg: 12,
        },
    );

    const stopTrace = SHOULD_COLLECT_CHROMIUM_TRACE
        ? await startChromiumTimelineTrace(page)
        : null;
    await page.evaluate(
        (label) => window.__OFIVE_E2E_PERF__?.start(label),
        `${scenario.id}:main-divider-drag`,
    );

    await dragDividerBackAndForth(
        page,
        dividerSelector,
        {
            delta: 180,
            cycles: 2,
            framesPerLeg: 24,
        },
    );

    const sampler = await page.evaluate(() => {
        const summary = window.__OFIVE_E2E_PERF__?.stop();
        if (!summary) {
            throw new Error("Performance sampler is not installed");
        }
        return summary;
    });
    const events = stopTrace ? await stopTrace() : [];
    const timeline = summarizeTimelineEvents(events);
    const selectedNames = new Set([
        "EventDispatch",
        "FunctionCall",
        "EvaluateScript",
        "Layout",
        "UpdateLayoutTree",
        "RecalculateStyles",
        "PrePaint",
        "Paint",
        "CompositeLayers",
        "Layerize",
        "RasterTask",
        "RunTask",
    ]);

    return {
        scenario: scenario.id,
        dom: await page.evaluate(() => ({
            tabSections: document.querySelectorAll(".layout-v2-tab-section").length,
            taskCards: document.querySelectorAll(
                ".layout-v2-tab-section__card--active .task-board__task-card",
            ).length,
            calendarDays: document.querySelectorAll(
                ".layout-v2-tab-section__card--active .calendar-tab__day",
            ).length,
            editors: document.querySelectorAll(
                ".layout-v2-tab-section__card--active .cm-editor:not([data-editor-preview-mirror-node='true'])",
            ).length,
        })),
        liveResize,
        sampler,
        timelineTop: timeline.slice(0, 12),
        timelineSelected: timeline.filter((item) => selectedNames.has(item.name)),
    };
}

test.describe("workbench section performance", () => {
    test("compares continuous main-section resize across editor, calendar and task board variants", async ({ page }, testInfo) => {
        test.slow();
        const summaries: ScenarioSummary[] = [];

        for (const scenario of PERFORMANCE_SCENARIOS) {
            const mockVaultPath = await gotoMockVaultPage(
                page,
                `workbench-section-performance-${scenario.id}`,
                MOCK_PAGE,
            );
            await configurePerformanceFixture(page, mockVaultPath, scenario);
            await waitForFixtureReady(page, scenario);
            await installPerformanceSampler(page);

            const summary = await runSectionDragScenario(page, scenario);
            summaries.push(summary);

            console.log(`[workbench-section-performance] ${JSON.stringify(compactScenarioSummary(summary))}`);
            await testInfo.attach(`workbench-section-performance-${scenario.id}.json`, {
                body: JSON.stringify(summary, null, 2),
                contentType: "application/json",
            });

            expect(summary.dom).toEqual(scenario.expectedDom);
            expect(summary.liveResize.strategy).toBe("dom-flex");
            expect(summary.liveResize.maxInnerTransformCount).toBe(0);
            expect(summary.liveResize.sampleCount).toBeGreaterThan(20);
            expect(summary.liveResize.mainSlotWidthRange).toBeGreaterThan(80);
            expect(summary.liveResize.rightSlotWidthRange).toBeGreaterThan(80);
            expect(summary.liveResize.editorWidthRange).toBeGreaterThan(60);
            expect(summary.liveResize.distinctMainSlotWidths).toBeGreaterThan(8);
            expect(summary.liveResize.distinctEditorWidths).toBeGreaterThan(8);
            if (scenario.calendarVisible) {
                expect(summary.liveResize.calendarWidthRange).toBeGreaterThan(60);
                expect(summary.liveResize.distinctCalendarWidths).toBeGreaterThan(8);
            }
            if (scenario.taskVisible) {
                expect(summary.liveResize.taskBoardWidthRange).toBeGreaterThan(60);
                expect(summary.liveResize.distinctTaskBoardWidths).toBeGreaterThan(8);
            }
            expect(summary.sampler.frameCount).toBeGreaterThan(10);
            expect(summary.sampler.durationMs).toBeGreaterThan(500);
        }

        await testInfo.attach("workbench-section-performance-summary.json", {
            body: JSON.stringify(summaries.map(compactScenarioSummary), null, 2),
            contentType: "application/json",
        });
    });
});
