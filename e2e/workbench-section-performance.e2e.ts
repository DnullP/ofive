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

const MOCK_PAGE_BASE = "/web-mock/mock-tauri-test.html?showControls=0";
const BROWSER_FALLBACK_CONFIG_PREFIX = "ofive:browser-fallback:vault-config:";
const SHOULD_COLLECT_CHROMIUM_TRACE = process.env.OFIVE_PERF_TRACE === "1";
const SHOULD_ENFORCE_STRICT_60FPS = process.env.OFIVE_PERF_STRICT_60 === "1";
const SIXTY_FPS_FRAME_BUDGET_MS = 16.7;
const FAST_ENV_RESIZE_P95_BUDGET_MS = 20;
const SLOW_ENV_RESIZE_P95_FALLBACK_BUDGET_MS = 28;
const SLOW_ENV_RESIZE_P95_SLACK_MS = 4;
const RESIZE_FRAME_OVER_33_RATIO_BUDGET = 0.03;
const COMPONENT_RESIZE_DEFAULT_SCENARIO_IDS = new Set([
    "codemirror",
    "ai-chat-tab",
]);
const COMPONENT_RESIZE_SCENARIO_FILTER = new Set(
    (process.env.OFIVE_PERF_COMPONENTS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
);
const ARTICLE_PANEL_RESIZE_SCENARIO_FILTER = new Set(
    (process.env.OFIVE_PERF_PANELS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
);
const TASK_NOTE_PATH = "test-resources/notes/task-board-e2e.md";
const GUIDE_NOTE_PATH = "test-resources/notes/guide.md";
const NETWORK_NOTE_PATH = "test-resources/notes/network-segment.md";
const TABLE_EDITOR_NOTE_PATH = "test-resources/notes/table-editor.md";
const TABLE_VIM_NOTE_PATH = "test-resources/notes/table-vim-boundary.md";
const PERF_PLACEHOLDER_COMPONENT_ID = "performance-placeholder";
const SIX_EDITOR_NOTE_PATHS = [
    "test-resources/notes/perf-six-editor-01.md",
    "test-resources/notes/perf-six-editor-02.md",
    "test-resources/notes/perf-six-editor-03.md",
    "test-resources/notes/perf-six-editor-04.md",
    "test-resources/notes/perf-six-editor-05.md",
    "test-resources/notes/perf-six-editor-06.md",
] as const;
const SIX_EDITOR_TAB_SECTION_IDS = [
    "main-tabs",
    "six-left-middle-tabs",
    "six-left-bottom-tabs",
    "six-right-top-tabs",
    "six-right-middle-tabs",
    "six-right-bottom-tabs",
] as const;

interface PerformanceScenarioConfig {
    id: string;
    glassEnabled: boolean;
    mainVisible: boolean;
    calendarVisible: boolean;
    taskVisible: boolean;
    activeGroupId: string;
    expectedDom: ScenarioSummary["dom"];
}

interface ComponentResizeScenarioConfig {
    id: string;
    title: string;
    tab: Record<string, unknown>;
    readySelector: string;
    sampleSelector: string;
}

interface ArticlePanelResizeScenarioConfig {
    id: string;
    title: string;
    side: "left" | "right";
    activeActivityId: string;
    activePanelId: string;
    activityBarId: "left-activity-bar" | "right-activity-bar";
    panelSectionId: "left-panel-section" | "right-panel-section";
    readySelector: string;
    sampleSelector: string;
}

const PERFORMANCE_SCENARIOS: PerformanceScenarioConfig[] = [
    {
        id: "placeholders-only",
        glassEnabled: false,
        mainVisible: false,
        calendarVisible: false,
        taskVisible: false,
        activeGroupId: "main-tabs",
        expectedDom: { tabSections: 3, taskCards: 0, calendarDays: 0, editors: 0 },
    },
    {
        id: "editor-placeholders",
        glassEnabled: false,
        mainVisible: true,
        calendarVisible: false,
        taskVisible: false,
        activeGroupId: "main-tabs",
        expectedDom: { tabSections: 3, taskCards: 0, calendarDays: 0, editors: 1 },
    },
    {
        id: "editor-calendar",
        glassEnabled: false,
        mainVisible: true,
        calendarVisible: true,
        taskVisible: false,
        activeGroupId: "calendar-tabs",
        expectedDom: { tabSections: 3, taskCards: 0, calendarDays: 42, editors: 1 },
    },
    {
        id: "editor-task",
        glassEnabled: false,
        mainVisible: true,
        calendarVisible: false,
        taskVisible: true,
        activeGroupId: "task-tabs",
        expectedDom: { tabSections: 3, taskCards: 2, calendarDays: 0, editors: 1 },
    },
    {
        id: "editor-calendar-task",
        glassEnabled: false,
        mainVisible: true,
        calendarVisible: true,
        taskVisible: true,
        activeGroupId: "task-tabs",
        expectedDom: { tabSections: 3, taskCards: 2, calendarDays: 42, editors: 1 },
    },
    {
        id: "editor-calendar-task-glass",
        glassEnabled: true,
        mainVisible: true,
        calendarVisible: true,
        taskVisible: true,
        activeGroupId: "task-tabs",
        expectedDom: { tabSections: 3, taskCards: 2, calendarDays: 42, editors: 1 },
    },
];

const COMPONENT_RESIZE_SCENARIOS: ComponentResizeScenarioConfig[] = [
    {
        id: "codemirror",
        title: "Markdown Editor",
        tab: buildMarkdownTab(TASK_NOTE_PATH),
        readySelector: "[data-tab-section-id='main-tabs'] .cm-editor",
        sampleSelector: "[data-tab-section-id='main-tabs'] [data-tab-component='codemirror']",
    },
    {
        id: "calendar-tab",
        title: "Calendar",
        tab: { id: "component-calendar", title: "日历", component: "calendar-tab" },
        readySelector: "[data-tab-section-id='main-tabs'] .calendar-tab__calendar-surface",
        sampleSelector: "[data-tab-section-id='main-tabs'] [data-tab-component='calendar-tab']",
    },
    {
        id: "task-board-tab",
        title: "Task Board",
        tab: { id: "component-task-board", title: "任务看板", component: "task-board-tab" },
        readySelector: "[data-tab-section-id='main-tabs'] .task-board",
        sampleSelector: "[data-tab-section-id='main-tabs'] [data-tab-component='task-board-tab']",
    },
    {
        id: "canvas",
        title: "Canvas",
        tab: {
            id: "component-canvas",
            title: "glass-validation.canvas",
            component: "canvas",
            params: { path: "test-resources/notes/glass-validation.canvas" },
        },
        readySelector: "[data-tab-section-id='main-tabs'] .canvas-tab__surface",
        sampleSelector: "[data-tab-section-id='main-tabs'] [data-tab-component='canvas']",
    },
    {
        id: "imageviewer",
        title: "Image Viewer",
        tab: {
            id: "component-imageviewer",
            title: "mock-image.png",
            component: "imageviewer",
            params: {
                path: "test-resources/notes/mock-image.png",
                absolutePath: "/mock/notes/test-resources/notes/mock-image.png",
            },
        },
        readySelector: "[data-tab-section-id='main-tabs'] .image-viewer-tab",
        sampleSelector: "[data-tab-section-id='main-tabs'] [data-tab-component='imageviewer']",
    },
    {
        id: "settings",
        title: "Settings",
        tab: { id: "component-settings", title: "Settings", component: "settings" },
        readySelector: "[data-tab-section-id='main-tabs'] .settings-tab",
        sampleSelector: "[data-tab-section-id='main-tabs'] [data-tab-component='settings']",
    },
    {
        id: "architecture-devtools",
        title: "Architecture Devtools",
        tab: { id: "component-architecture", title: "Architecture Devtools", component: "architecture-devtools" },
        readySelector: "[data-tab-section-id='main-tabs'] [data-tab-component='architecture-devtools']",
        sampleSelector: "[data-tab-section-id='main-tabs'] [data-tab-component='architecture-devtools']",
    },
    {
        id: "knowledgegraph",
        title: "Knowledge Graph",
        tab: { id: "component-knowledgegraph", title: "知识图谱", component: "knowledgegraph" },
        readySelector: "[data-tab-section-id='main-tabs'] .knowledge-graph-tab",
        sampleSelector: "[data-tab-section-id='main-tabs'] [data-tab-component='knowledgegraph']",
    },
    {
        id: "ai-chat-tab",
        title: "AI Chat Tab",
        tab: { id: "component-ai-chat", title: "AI Chat", component: "ai-chat-tab" },
        readySelector: "[data-tab-section-id='main-tabs'] .ai-chat-panel",
        sampleSelector: "[data-tab-section-id='main-tabs'] [data-tab-component='ai-chat-tab']",
    },
    {
        id: "project-reader-code",
        title: "Project Reader Code",
        tab: {
            id: "component-project-reader-code",
            title: "long-scroll.ts",
            component: "project-reader.code",
            params: {
                projectId: "mock-ofive-project",
                projectName: "mock-ofive",
                rootPath: "/mock/ofive",
                relativePath: "src/long-scroll.ts",
            },
        },
        readySelector: "[data-tab-section-id='main-tabs'] .project-reader-code-line",
        sampleSelector: "[data-tab-section-id='main-tabs'] [data-tab-component='project-reader.code']",
    },
];

const ARTICLE_PANEL_RESIZE_SCENARIOS: ArticlePanelResizeScenarioConfig[] = [
    {
        id: "file-tree",
        title: "File Tree",
        side: "left",
        activeActivityId: "files",
        activePanelId: "files",
        activityBarId: "left-activity-bar",
        panelSectionId: "left-panel-section",
        readySelector: ".file-tree",
        sampleSelector: ".file-tree",
    },
    {
        id: "ai-chat",
        title: "AI Chat Panel",
        side: "right",
        activeActivityId: "ai-chat",
        activePanelId: "ai-chat",
        activityBarId: "right-activity-bar",
        panelSectionId: "right-panel-section",
        readySelector: ".layout-v2-panel-section__pane--active .ai-chat-panel",
        sampleSelector: ".layout-v2-panel-section__pane--active .ai-chat-panel",
    },
    {
        id: "outline",
        title: "Outline Panel",
        side: "right",
        activeActivityId: "outline",
        activePanelId: "outline",
        activityBarId: "right-activity-bar",
        panelSectionId: "right-panel-section",
        readySelector: ".layout-v2-panel-section__pane--active .outline-panel",
        sampleSelector: ".layout-v2-panel-section__pane--active .outline-panel",
    },
    {
        id: "backlinks",
        title: "Backlinks Panel",
        side: "right",
        activeActivityId: "outline",
        activePanelId: "backlinks",
        activityBarId: "right-activity-bar",
        panelSectionId: "right-panel-section",
        readySelector: ".layout-v2-panel-section__pane--active .backlinks-panel",
        sampleSelector: ".layout-v2-panel-section__pane--active .backlinks-panel",
    },
    {
        id: "search",
        title: "Search Panel",
        side: "left",
        activeActivityId: "search",
        activePanelId: "search",
        activityBarId: "left-activity-bar",
        panelSectionId: "left-panel-section",
        readySelector: ".layout-v2-panel-section__pane--active .search-panel",
        sampleSelector: ".layout-v2-panel-section__pane--active .search-panel",
    },
];

const TIMELINE_SELECTED_EVENT_NAMES = new Set([
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
    glassEnabled: boolean;
    dom: {
        tabSections: number;
        taskCards: number;
        calendarDays: number;
        editors: number;
    };
    idleSampler: PerfSamplerSummary;
    liveResize: LiveResizeSummary;
    sampler: PerfSamplerSummary;
    timelineTop: TimelineSummaryItem[];
    timelineSelected: TimelineSummaryItem[];
}

interface ComponentResizeSummary {
    component: string;
    title: string;
    liveResize: LiveResizeSummary;
    idleSampler: PerfSamplerSummary;
    sampler: PerfSamplerSummary;
    dom: {
        mounted: boolean;
        tabComponent: string | null;
    };
    timelineTop: TimelineSummaryItem[];
    timelineSelected: TimelineSummaryItem[];
}

type ArticlePanelResizeSummary = ComponentResizeSummary;

interface SixEditorDomSummary {
    tabSections: number;
    editors: number;
    activeEditorCards: number;
    frontmatterWidgets: number;
    tableWidgets: number;
    latexBlockWidgets: number;
    wikilinks: number;
}

interface SixEditorLiveResizeFrameSample {
    phase: "start" | "move" | "end";
    index: number;
    leftColumnWidth: number | null;
    rightColumnWidth: number | null;
    editorWidths: Record<string, number>;
    visibleEditorCount: number;
    frontmatterWidgetCount: number;
    tableWidgetCount: number;
    latexBlockWidgetCount: number;
    wikilinkCount: number;
    innerTransformCount: number;
    rootIsResizing: boolean;
    rootIsLightweight: boolean;
    childSlotPointerEvents: string | null;
    activeTabGroupSectionCount: number;
    activeTabGroupSectionIds: string[];
    activeTabGroupValues: string[];
    activeCardContainValues: string[];
    editorContainValues: string[];
    scrollerContainValues: string[];
    frontmatterWidgetContainValues: string[];
    tableWidgetContainValues: string[];
    latexWidgetContainValues: string[];
    tableCellBoxShadow: string | null;
    tableCellOutlineStyle: string | null;
    tableCellOutlineWidth: string | null;
    tableResizeHandleOpacity: string | null;
    tableEdgeHandleOpacity: string | null;
    frontmatterRowBoxShadow: string | null;
    frontmatterActionOpacity: string | null;
    latexBlockBoxShadow: string | null;
    wikilinkTextShadow: string | null;
    editorBackgroundColor: string | null;
    scrollerBackgroundColor: string | null;
    activeLineBackgroundColor: string | null;
    activeLineGutterBackgroundColor: string | null;
    gutterBoxShadow: string | null;
    nonActiveGutterDisplay: string | null;
    nonActiveGutterVisibility: string | null;
    nonActiveSelectionLayerDisplay: string | null;
    nonActiveSelectionLayerVisibility: string | null;
    nonActiveHeaderSourceMarkerVisibility: string | null;
    nonFocusedCursorLayerVisibleCount: number;
    codeBlockCopyButtonDisplay: string | null;
    dividerLineTransitionProperty: string | null;
}

interface SixEditorLiveResizeSummary {
    strategy: string | null;
    sampleCount: number;
    leftColumnWidthRange: number;
    rightColumnWidthRange: number;
    editorWidthRanges: Record<string, number>;
    distinctEditorWidths: Record<string, number>;
    editorsWithWidthRangeOver40: number;
    minVisibleEditorCount: number;
    minFrontmatterWidgetCount: number;
    minTableWidgetCount: number;
    minLatexBlockWidgetCount: number;
    minWikilinkCount: number;
    maxInnerTransformCount: number;
    samples: SixEditorLiveResizeFrameSample[];
}

interface SixEditorResizeSummary {
    scenario: string;
    dom: SixEditorDomSummary;
    idleSampler: PerfSamplerSummary;
    liveResize: SixEditorLiveResizeSummary;
    sampler: PerfSamplerSummary;
    timelineTop: TimelineSummaryItem[];
    timelineSelected: TimelineSummaryItem[];
}

interface LiveResizeFrameSample {
    phase: "start" | "move" | "end";
    index: number;
    mainSlotWidth: number | null;
    rightSlotWidth: number | null;
    targetWidth: number | null;
    targetContain: string | null;
    targetPointerEvents: string | null;
    editorWidth: number | null;
    calendarWidth: number | null;
    taskBoardWidth: number | null;
    innerTransformCount: number;
    rootIsResizing: boolean;
    rootIsLightweight: boolean;
    childSlotPointerEvents: string | null;
    activeCardContain: string | null;
    activePaneContain: string | null;
    editorContain: string | null;
    calendarContain: string | null;
    taskBoardContain: string | null;
    aiPanelContain: string | null;
    taskCardBoxShadow: string | null;
    dividerLineTransitionProperty: string | null;
    appShellBackdropFilter: string | null;
    aiComposerBackdropFilter: string | null;
    canvasAuxiliaryVisibleCount: number;
    canvasNodeBodyVisibility: string | null;
    projectReaderCodeTextVisibility: string | null;
    knowledgeGraphLabelLayerOpacity: string | null;
    knowledgeGraphSimulationRunning: boolean | null;
    knowledgeGraphResizeLightweightActive: boolean | null;
    knowledgeGraphPixelRatio: number | null;
    knowledgeGraphRenderLinks: boolean | null;
    knowledgeGraphEnableDrag: boolean | null;
    knowledgeGraphEnableZoom: boolean | null;
    fileTreeItemTransitionProperty: string | null;
    outlineItemTransitionProperty: string | null;
    backlinksItemTransitionProperty: string | null;
    searchResultTransitionProperty: string | null;
    searchResultSnippetVisibility: string | null;
    backlinksItemPreviewVisibility: string | null;
}

interface LiveResizeSummary {
    strategy: string | null;
    sampleCount: number;
    mainSlotWidthRange: number;
    rightSlotWidthRange: number;
    targetWidthRange: number;
    editorWidthRange: number;
    calendarWidthRange: number;
    taskBoardWidthRange: number;
    distinctMainSlotWidths: number;
    distinctTargetWidths: number;
    distinctEditorWidths: number;
    distinctCalendarWidths: number;
    distinctTaskBoardWidths: number;
    maxInnerTransformCount: number;
    samples: LiveResizeFrameSample[];
}

interface ResizeFrameBudgetSummary {
    targetFrameMs: number;
    targetFps: number;
    strict60Fps: boolean;
    idleP95: number;
    resizeP95: number;
    resizeP95Delta: number;
    normalizedP95Budget: number;
    usingIdleBaseline: boolean;
    p95FpsEstimate: number;
    framesOver33: number;
    maxFramesOver33: number;
    framesOver50: number;
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

function hasLayoutContain(value: string | null): boolean {
    return typeof value === "string" && (
        value.includes("layout") ||
        value === "content" ||
        value === "strict"
    );
}

function buildResizeFrameBudgetSummary(
    idleSampler: PerfSamplerSummary,
    resizeSampler: PerfSamplerSummary,
): ResizeFrameBudgetSummary {
    const usingIdleBaseline = idleSampler.p95FrameDelta > FAST_ENV_RESIZE_P95_BUDGET_MS;
    const normalizedP95Budget = usingIdleBaseline
        ? Math.max(
            SLOW_ENV_RESIZE_P95_FALLBACK_BUDGET_MS,
            roundMetric(idleSampler.p95FrameDelta + SLOW_ENV_RESIZE_P95_SLACK_MS),
        )
        : FAST_ENV_RESIZE_P95_BUDGET_MS;
    return {
        targetFrameMs: SIXTY_FPS_FRAME_BUDGET_MS,
        targetFps: 60,
        strict60Fps: SHOULD_ENFORCE_STRICT_60FPS,
        idleP95: idleSampler.p95FrameDelta,
        resizeP95: resizeSampler.p95FrameDelta,
        resizeP95Delta: roundMetric(resizeSampler.p95FrameDelta - idleSampler.p95FrameDelta),
        normalizedP95Budget,
        usingIdleBaseline,
        p95FpsEstimate: resizeSampler.p95FrameDelta > 0
            ? roundMetric(1000 / resizeSampler.p95FrameDelta)
            : 0,
        framesOver33: resizeSampler.framesOver33,
        maxFramesOver33: Math.max(
            3,
            Math.ceil(resizeSampler.frameCount * RESIZE_FRAME_OVER_33_RATIO_BUDGET),
        ),
        framesOver50: resizeSampler.framesOver50,
    };
}

function expectResizeFrameBudget(
    label: string,
    idleSampler: PerfSamplerSummary,
    resizeSampler: PerfSamplerSummary,
): void {
    const budget = buildResizeFrameBudgetSummary(idleSampler, resizeSampler);
    if (SHOULD_ENFORCE_STRICT_60FPS) {
        expect(
            resizeSampler.p95FrameDelta,
            `${label} strict 60fps resize p95 must stay within ${String(SIXTY_FPS_FRAME_BUDGET_MS)}ms; ` +
            `idle p95=${String(idleSampler.p95FrameDelta)}ms`,
        ).toBeLessThanOrEqual(SIXTY_FPS_FRAME_BUDGET_MS);
        expect(
            resizeSampler.framesOver33,
            `${label} strict 60fps should not produce 30fps-level frames`,
        ).toBe(0);
        expect(
            resizeSampler.framesOver50,
            `${label} strict 60fps should not produce 50ms+ resize frames`,
        ).toBe(0);
        return;
    }

    expect(
        resizeSampler.p95FrameDelta,
        `${label} resize p95 should target ${String(SIXTY_FPS_FRAME_BUDGET_MS)}ms; ` +
        `headless idle p95=${String(idleSampler.p95FrameDelta)}ms normalized budget=${String(budget.normalizedP95Budget)}ms`,
    ).toBeLessThanOrEqual(budget.normalizedP95Budget);
    expect(
        resizeSampler.framesOver33,
        `${label} should not regress to 30fps-level resize frames`,
    ).toBeLessThanOrEqual(budget.maxFramesOver33);
    expect(
        resizeSampler.framesOver50,
        `${label} should not produce 50ms+ resize frames`,
    ).toBe(0);
}

function compactScenarioSummary(summary: ScenarioSummary): Record<string, unknown> {
    const selectedByName = new Map(summary.timelineSelected.map((item) => [item.name, item]));
    return {
        scenario: summary.scenario,
        glassEnabled: summary.glassEnabled,
        dom: summary.dom,
        liveResize: {
            strategy: summary.liveResize.strategy,
            samples: summary.liveResize.sampleCount,
            mainRange: summary.liveResize.mainSlotWidthRange,
            editorRange: summary.liveResize.editorWidthRange,
            calendarRange: summary.liveResize.calendarWidthRange,
            taskRange: summary.liveResize.taskBoardWidthRange,
            maxInnerTransforms: summary.liveResize.maxInnerTransformCount,
            rootResizingDuringDrag: summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .every((sample) => sample.rootIsResizing),
            rootLightweightDuringDrag: summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .every((sample) => sample.rootIsLightweight),
            dividerTransitionsDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.dividerLineTransitionProperty ?? "missing"))),
            appShellBackdropDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.appShellBackdropFilter ?? "missing"))),
            activeCardContainDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.activeCardContain ?? "missing"))),
            activePaneContainDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.activePaneContain ?? "missing"))),
            childSlotPointerEventsDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.childSlotPointerEvents ?? "missing"))),
            taskCardShadowDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.taskCardBoxShadow ?? "missing"))),
            aiComposerBackdropDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.aiComposerBackdropFilter ?? "missing"))),
        },
        idleFrames: {
            count: summary.idleSampler.frameCount,
            p95: summary.idleSampler.p95FrameDelta,
            p99: summary.idleSampler.p99FrameDelta,
            max: summary.idleSampler.maxFrameDelta,
            over33: summary.idleSampler.framesOver33,
            longTasks: summary.idleSampler.longTaskCount,
            longTaskMax: summary.idleSampler.longTaskMaxMs,
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
        frameBudget: buildResizeFrameBudgetSummary(summary.idleSampler, summary.sampler),
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

function compactComponentResizeSummary(summary: ComponentResizeSummary): Record<string, unknown> {
    const selectedByName = new Map(summary.timelineSelected.map((item) => [item.name, item]));
    return {
        component: summary.component,
        title: summary.title,
        dom: summary.dom,
        liveResize: {
            strategy: summary.liveResize.strategy,
            samples: summary.liveResize.sampleCount,
            targetRange: summary.liveResize.targetWidthRange,
            distinctTargetWidths: summary.liveResize.distinctTargetWidths,
            maxInnerTransforms: summary.liveResize.maxInnerTransformCount,
            rootResizingDuringDrag: summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .every((sample) => sample.rootIsResizing),
            rootLightweightDuringDrag: summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .every((sample) => sample.rootIsLightweight),
            targetContainDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.targetContain ?? "missing"))),
            targetPointerEventsDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.targetPointerEvents ?? "missing"))),
            canvasAuxiliaryVisibleDuringDrag: Math.max(0, ...summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.canvasAuxiliaryVisibleCount)),
            knowledgeGraphLabelOpacityDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.knowledgeGraphLabelLayerOpacity ?? "missing"))),
            knowledgeGraphSimulationDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.knowledgeGraphSimulationRunning))),
            knowledgeGraphResizeProfileDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => JSON.stringify({
                    active: sample.knowledgeGraphResizeLightweightActive,
                    pixelRatio: sample.knowledgeGraphPixelRatio,
                    renderLinks: sample.knowledgeGraphRenderLinks,
                    enableDrag: sample.knowledgeGraphEnableDrag,
                    enableZoom: sample.knowledgeGraphEnableZoom,
                })))).map((item) => JSON.parse(item) as Record<string, unknown>),
            canvasNodeBodyVisibilityDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.canvasNodeBodyVisibility ?? "missing"))),
            projectReaderCodeTextVisibilityDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.projectReaderCodeTextVisibility ?? "missing"))),
        },
        idleFrames: {
            count: summary.idleSampler.frameCount,
            p95: summary.idleSampler.p95FrameDelta,
            p99: summary.idleSampler.p99FrameDelta,
            max: summary.idleSampler.maxFrameDelta,
            over33: summary.idleSampler.framesOver33,
            longTasks: summary.idleSampler.longTaskCount,
            longTaskMax: summary.idleSampler.longTaskMaxMs,
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
        frameBudget: buildResizeFrameBudgetSummary(summary.idleSampler, summary.sampler),
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

function compactArticlePanelResizeSummary(summary: ArticlePanelResizeSummary): Record<string, unknown> {
    const compact = compactComponentResizeSummary(summary);
    return {
        ...compact,
        liveResize: {
            ...(compact.liveResize as Record<string, unknown>),
            fileTreeItemTransitionsDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.fileTreeItemTransitionProperty ?? "missing"))),
            outlineItemTransitionsDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.outlineItemTransitionProperty ?? "missing"))),
            backlinksItemTransitionsDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.backlinksItemTransitionProperty ?? "missing"))),
            searchResultTransitionsDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.searchResultTransitionProperty ?? "missing"))),
            searchSnippetVisibilityDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.searchResultSnippetVisibility ?? "missing"))),
            backlinksPreviewVisibilityDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.backlinksItemPreviewVisibility ?? "missing"))),
        },
    };
}

function compactSixEditorResizeSummary(summary: SixEditorResizeSummary): Record<string, unknown> {
    const selectedByName = new Map(summary.timelineSelected.map((item) => [item.name, item]));
    return {
        scenario: summary.scenario,
        dom: summary.dom,
        liveResize: {
            strategy: summary.liveResize.strategy,
            samples: summary.liveResize.sampleCount,
            leftColumnRange: summary.liveResize.leftColumnWidthRange,
            rightColumnRange: summary.liveResize.rightColumnWidthRange,
            editorsWithWidthRangeOver40: summary.liveResize.editorsWithWidthRangeOver40,
            editorWidthRanges: summary.liveResize.editorWidthRanges,
            distinctEditorWidths: summary.liveResize.distinctEditorWidths,
            minVisibleEditorCount: summary.liveResize.minVisibleEditorCount,
            minFrontmatterWidgetCount: summary.liveResize.minFrontmatterWidgetCount,
            minTableWidgetCount: summary.liveResize.minTableWidgetCount,
            minLatexBlockWidgetCount: summary.liveResize.minLatexBlockWidgetCount,
            minWikilinkCount: summary.liveResize.minWikilinkCount,
            maxInnerTransforms: summary.liveResize.maxInnerTransformCount,
            rootResizingDuringDrag: summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .every((sample) => sample.rootIsResizing),
            rootLightweightDuringDrag: summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .every((sample) => sample.rootIsLightweight),
            childSlotPointerEventsDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.childSlotPointerEvents ?? "missing"))),
            activeTabGroupCountDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.activeTabGroupSectionCount))),
            activeTabGroupIdsDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .flatMap((sample) => sample.activeTabGroupSectionIds))),
            tabGroupValuesDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .flatMap((sample) => sample.activeTabGroupValues))),
            dividerTransitionsDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.dividerLineTransitionProperty ?? "missing"))),
            activeCardContainDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .flatMap((sample) => sample.activeCardContainValues))),
            editorContainDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .flatMap((sample) => sample.editorContainValues))),
            scrollerContainDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .flatMap((sample) => sample.scrollerContainValues))),
            frontmatterWidgetContainDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .flatMap((sample) => sample.frontmatterWidgetContainValues))),
            tableWidgetContainDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .flatMap((sample) => sample.tableWidgetContainValues))),
            latexWidgetContainDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .flatMap((sample) => sample.latexWidgetContainValues))),
            tableCellBoxShadowDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.tableCellBoxShadow ?? "missing"))),
            tableCellOutlineDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => JSON.stringify({
                    style: sample.tableCellOutlineStyle,
                    width: sample.tableCellOutlineWidth,
                })))).map((item) => JSON.parse(item) as Record<string, unknown>),
            tableHandlesOpacityDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => JSON.stringify({
                    resize: sample.tableResizeHandleOpacity,
                    edge: sample.tableEdgeHandleOpacity,
                })))).map((item) => JSON.parse(item) as Record<string, unknown>),
            frontmatterRowBoxShadowDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.frontmatterRowBoxShadow ?? "missing"))),
            frontmatterActionOpacityDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.frontmatterActionOpacity ?? "missing"))),
            latexBlockBoxShadowDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.latexBlockBoxShadow ?? "missing"))),
            wikilinkTextShadowDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.wikilinkTextShadow ?? "missing"))),
            editorBackgroundDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.editorBackgroundColor ?? "missing"))),
            scrollerBackgroundDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.scrollerBackgroundColor ?? "missing"))),
            activeLineBackgroundDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.activeLineBackgroundColor ?? "missing"))),
            activeLineGutterBackgroundDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.activeLineGutterBackgroundColor ?? "missing"))),
            gutterBoxShadowDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.gutterBoxShadow ?? "missing"))),
            nonActiveGutterDisplayDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.nonActiveGutterDisplay ?? "missing"))),
            nonActiveGutterVisibilityDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.nonActiveGutterVisibility ?? "missing"))),
            nonActiveSelectionLayerDisplayDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.nonActiveSelectionLayerDisplay ?? "missing"))),
            nonActiveSelectionLayerVisibilityDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.nonActiveSelectionLayerVisibility ?? "missing"))),
            nonActiveHeaderSourceMarkerVisibilityDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.nonActiveHeaderSourceMarkerVisibility ?? "missing"))),
            maxNonFocusedCursorLayersVisibleDuringDrag: Math.max(0, ...summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.nonFocusedCursorLayerVisibleCount)),
            codeBlockCopyButtonDisplayDuringDrag: Array.from(new Set(summary.liveResize.samples
                .filter((sample) => sample.phase !== "end")
                .map((sample) => sample.codeBlockCopyButtonDisplay ?? "missing"))),
        },
        idleFrames: {
            count: summary.idleSampler.frameCount,
            p95: summary.idleSampler.p95FrameDelta,
            p99: summary.idleSampler.p99FrameDelta,
            max: summary.idleSampler.maxFrameDelta,
            over33: summary.idleSampler.framesOver33,
            longTasks: summary.idleSampler.longTaskCount,
            longTaskMax: summary.idleSampler.longTaskMaxMs,
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
        frameBudget: buildResizeFrameBudgetSummary(summary.idleSampler, summary.sampler),
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

function buildMockPageUrl(scenario: PerformanceScenarioConfig): string {
    return `${MOCK_PAGE_BASE}&glass=${scenario.glassEnabled ? "1" : "0"}`;
}

function buildComponentMockPageUrl(): string {
    return `${MOCK_PAGE_BASE}&glass=0`;
}

function resolveArticlePanelDividerSelector(scenario: ArticlePanelResizeScenarioConfig): string {
    return scenario.side === "left"
        ? "[data-section-id='workbench-shell'] > .layout-v2__divider--horizontal[aria-label='Resize sections']"
        : "[data-section-id='center-shell'] > .layout-v2__divider--horizontal[aria-label='Resize sections']";
}

function resolveArticlePanelDragDelta(scenario: ArticlePanelResizeScenarioConfig, magnitude: number): number {
    return scenario.side === "left" ? magnitude : -magnitude;
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
    const mainActiveTab = scenario.mainVisible
        ? buildMarkdownTab(TASK_NOTE_PATH)
        : buildPlaceholderTab("main-placeholder", "Main Placeholder");
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
                    mainActiveTab,
                    scenario.mainVisible
                        ? buildMarkdownTab(GUIDE_NOTE_PATH)
                        : buildPlaceholderTab("main-placeholder-secondary", "Main Placeholder 2"),
                ],
                focusedTabId: String(mainActiveTab.id),
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

function buildComponentResizeWorkspaceLayout(scenario: ComponentResizeScenarioConfig): Record<string, unknown> {
    const mainTabs = tabSectionNode("main-tabs", scenario.title, "main-tabs");
    const sideTabs = tabSectionNode("component-side-tabs", "Reference", "component-side-tabs");
    const bottomTabs = tabSectionNode("component-bottom-tabs", "Notes", "component-bottom-tabs");
    const rightMainStack = workbenchNode(
        "right-main-stack",
        "Reference Stack",
        "container",
        { type: "empty", props: { label: "Reference stack", description: "component resize fixture" } },
        {
            direction: "vertical",
            ratio: 0.5,
            children: [sideTabs, bottomTabs],
        },
    );
    const mainWorkspace = workbenchNode(
        "main-workspace",
        "Component Resize Workspace",
        "container",
        { type: "empty", props: { label: "Component resize", description: "component resize fixture" } },
        {
            direction: "horizontal",
            ratio: 0.58,
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
                    scenario.tab,
                    buildMarkdownTab(GUIDE_NOTE_PATH),
                ],
                focusedTabId: String(scenario.tab.id),
                isRoot: true,
            },
            {
                id: "component-side-tabs",
                tabs: [
                    buildPlaceholderTab("component-side-placeholder", "Reference Placeholder"),
                    buildMarkdownTab(NETWORK_NOTE_PATH),
                ],
                focusedTabId: "component-side-placeholder",
            },
            {
                id: "component-bottom-tabs",
                tabs: [
                    buildPlaceholderTab("component-bottom-placeholder", "Notes Placeholder"),
                    buildMarkdownTab(TABLE_EDITOR_NOTE_PATH),
                ],
                focusedTabId: "component-bottom-placeholder",
            },
        ],
        activeGroupId: "main-tabs",
    };
}

function buildSixEditorColumn(
    columnId: "six-left-column" | "six-right-column",
    sectionIds: readonly [string, string, string],
): Record<string, unknown> {
    const [topSectionId, middleSectionId, bottomSectionId] = sectionIds;
    const middleAndBottom = workbenchNode(
        `${columnId}-lower-stack`,
        `${columnId} lower stack`,
        "container",
        { type: "empty", props: { label: `${columnId} lower stack`, description: "six editor resize fixture" } },
        {
            direction: "vertical",
            ratio: 0.5,
            children: [
                tabSectionNode(middleSectionId, middleSectionId, middleSectionId),
                tabSectionNode(bottomSectionId, bottomSectionId, bottomSectionId),
            ],
        },
    );

    return workbenchNode(
        columnId,
        columnId,
        "container",
        { type: "empty", props: { label: columnId, description: "six editor resize fixture" } },
        {
            direction: "vertical",
            ratio: 0.34,
            children: [
                tabSectionNode(topSectionId, topSectionId, topSectionId),
                middleAndBottom,
            ],
        },
    );
}

function buildSixEditorWorkspaceLayout(): Record<string, unknown> {
    const leftColumn = buildSixEditorColumn("six-left-column", [
        SIX_EDITOR_TAB_SECTION_IDS[0],
        SIX_EDITOR_TAB_SECTION_IDS[1],
        SIX_EDITOR_TAB_SECTION_IDS[2],
    ]);
    const rightColumn = buildSixEditorColumn("six-right-column", [
        SIX_EDITOR_TAB_SECTION_IDS[3],
        SIX_EDITOR_TAB_SECTION_IDS[4],
        SIX_EDITOR_TAB_SECTION_IDS[5],
    ]);
    const mainWorkspace = workbenchNode(
        "main-workspace",
        "Six Editor Workspace",
        "container",
        { type: "empty", props: { label: "Six editor workspace", description: "six editor resize fixture" } },
        {
            direction: "horizontal",
            ratio: 0.5,
            children: [leftColumn, rightColumn],
        },
    );
    const centerShell = workbenchNode(
        "center-shell",
        "Center Shell",
        "container",
        { type: "empty", props: { label: "Center", description: "main region" } },
        {
            direction: "horizontal",
            ratio: 0.99,
            children: [
                mainWorkspace,
                workbenchNode(
                    "right-sidebar",
                    "Right Sidebar",
                    "sidebar",
                    { type: "panel-section", props: { panelSectionId: "right-panel-section" } },
                    null,
                    { "layout-v2:hidden": true },
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
            ratio: 0.01,
            children: [
                workbenchNode(
                    "left-sidebar",
                    "Left Sidebar",
                    "sidebar",
                    { type: "panel-section", props: { panelSectionId: "left-panel-section" } },
                    null,
                    { "layout-v2:hidden": true },
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
        tabSections: SIX_EDITOR_TAB_SECTION_IDS.map((sectionId, index) => {
            const tab = buildMarkdownTab(SIX_EDITOR_NOTE_PATHS[index]);
            return {
                id: sectionId,
                tabs: [tab],
                focusedTabId: String(tab.id),
                isRoot: index === 0,
            };
        }),
        activeGroupId: SIX_EDITOR_TAB_SECTION_IDS[0],
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
                        observer.observe({ type: "longtask" });
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
                glassEffectEnabled: scenario.glassEnabled,
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

async function configureComponentResizeFixture(
    page: Page,
    mockVaultPath: string,
    scenario: ComponentResizeScenarioConfig,
): Promise<void> {
    const config = {
        schemaVersion: 1,
        entries: {
            features: {
                restoreWorkspaceLayout: true,
                fileOpenMode: "new-tab",
                glassEffectEnabled: false,
                knowledgeGraphEnabled: true,
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
                    width: 260,
                    visible: true,
                    activeActivityId: "outline",
                    activePanelId: "outline",
                },
            },
            workspaceLayout: buildComponentResizeWorkspaceLayout(scenario),
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

async function configureArticlePanelResizeFixture(
    page: Page,
    mockVaultPath: string,
    scenario: ArticlePanelResizeScenarioConfig,
): Promise<void> {
    const config = {
        schemaVersion: 1,
        entries: {
            features: {
                restoreWorkspaceLayout: true,
                fileOpenMode: "new-tab",
                glassEffectEnabled: false,
                notificationsEnabled: false,
                searchEnabled: true,
            },
            sidebarLayout: {
                version: 1,
                left: {
                    width: 260,
                    visible: true,
                    activeActivityId: scenario.side === "left" ? scenario.activeActivityId : "files",
                    activePanelId: scenario.side === "left" ? scenario.activePanelId : "files",
                },
                right: {
                    width: 300,
                    visible: true,
                    activeActivityId: scenario.side === "right" ? scenario.activeActivityId : "ai-chat",
                    activePanelId: scenario.side === "right" ? scenario.activePanelId : "ai-chat",
                },
            },
            workspaceLayout: buildPerformanceWorkspaceLayout({
                id: `article-panel-${scenario.id}`,
                glassEnabled: false,
                mainVisible: true,
                calendarVisible: false,
                taskVisible: false,
                activeGroupId: "main-tabs",
                expectedDom: { tabSections: 3, taskCards: 0, calendarDays: 0, editors: 1 },
            }),
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

async function configureSixEditorResizeFixture(
    page: Page,
    mockVaultPath: string,
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
                    width: 1,
                    visible: false,
                    activeActivityId: "files",
                    activePanelId: "files",
                },
                right: {
                    width: 1,
                    visible: false,
                    activeActivityId: "outline",
                    activePanelId: "outline",
                },
            },
            workspaceLayout: buildSixEditorWorkspaceLayout(),
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
    await expect(page.locator(".ai-chat-panel")).toBeVisible();
    if (scenario.mainVisible) {
        await expect(page.locator("[data-tab-section-id='main-tabs'] .cm-editor")).toBeVisible();
    } else {
        await expect(page.locator("[data-tab-section-id='main-tabs']")).toContainText("Unregistered: performance-placeholder");
    }
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

async function waitForComponentResizeFixtureReady(page: Page, scenario: ComponentResizeScenarioConfig): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await expect(page.locator(".layout-v2-tab-section")).toHaveCount(3);
    await expect(page.locator(scenario.sampleSelector)).toBeVisible();
    await expect(page.locator(scenario.readySelector).first()).toBeVisible({ timeout: 15_000 });

    if (scenario.id === "task-board-tab") {
        const taskSection = page.locator("[data-tab-section-id='main-tabs']");
        await taskSection.getByRole("button", { name: /All|全部/ }).click();
        await expect(taskSection.locator(".task-board__task-card")).toHaveCount(2);
    }
}

function buildArticlePanelActivitySelector(scenario: ArticlePanelResizeScenarioConfig): string {
    return [
        "button[data-layout-role='activity-icon']",
        `[data-layout-bar-id='${scenario.activityBarId}']`,
        `[data-layout-icon-id='${scenario.activeActivityId}']`,
    ].join("");
}

function buildArticlePanelTabSelector(scenario: ArticlePanelResizeScenarioConfig): string {
    return [
        "button[data-layout-role='panel']",
        `[data-layout-panel-section-id='${scenario.panelSectionId}']`,
        `[data-layout-panel-id='${scenario.activePanelId}']`,
    ].join("");
}

async function waitForArticlePanelResizeFixtureReady(page: Page, scenario: ArticlePanelResizeScenarioConfig): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await expect(page.locator("[data-tab-section-id='main-tabs'] .cm-editor")).toBeVisible();

    const target = page.locator(scenario.readySelector).first();
    if (!(await target.isVisible())) {
        const panelTab = page.locator(buildArticlePanelTabSelector(scenario)).first();
        if (scenario.side === "left" && !(await panelTab.isVisible())) {
            await page.locator(buildArticlePanelActivitySelector(scenario)).click({ timeout: 15_000 });
        }
        await panelTab.click({ timeout: 15_000 });
    }

    await expect(page.locator(scenario.sampleSelector).first()).toBeVisible();
    await expect(target).toBeVisible({ timeout: 15_000 });
}

async function readSixEditorDomSummary(page: Page): Promise<SixEditorDomSummary> {
    return page.evaluate(() => {
        const activeCards = Array.from(
            document.querySelectorAll<HTMLElement>(".layout-v2-tab-section__card--active"),
        );
        const countCardsWith = (selector: string): number =>
            activeCards.filter((card) => Boolean(card.querySelector(selector))).length;

        return {
            tabSections: document.querySelectorAll(".layout-v2-tab-section").length,
            editors: document.querySelectorAll(
                ".layout-v2-tab-section__card--active .cm-editor:not([data-editor-preview-mirror-node='true'])",
            ).length,
            activeEditorCards: document.querySelectorAll(
                ".layout-v2-tab-section__card--active [data-tab-component='codemirror']",
            ).length,
            frontmatterWidgets: countCardsWith(".cm-frontmatter-widget"),
            tableWidgets: countCardsWith(".cm-markdown-table-widget, [data-markdown-table-block-from]"),
            latexBlockWidgets: countCardsWith(".cm-latex-block-widget"),
            wikilinks: document.querySelectorAll(
                ".layout-v2-tab-section__card--active .cm-rendered-wikilink",
            ).length,
        };
    });
}

async function waitForSixEditorResizeFixtureReady(page: Page): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
    await expect(page.locator(".layout-v2-tab-section")).toHaveCount(6, { timeout: 15_000 });
    await expect(page.locator(
        ".layout-v2-tab-section__card--active .cm-editor:not([data-editor-preview-mirror-node='true'])",
    )).toHaveCount(6, { timeout: 20_000 });

    for (const sectionId of SIX_EDITOR_TAB_SECTION_IDS) {
        await expect(page.locator(`[data-tab-section-id='${sectionId}'] .cm-editor`).first())
            .toBeVisible({ timeout: 20_000 });
    }

    await expect.poll(() => readSixEditorDomSummary(page), {
        message: "six editor resize fixture should mount rich markdown widgets in all panes",
        timeout: 20_000,
    }).toMatchObject({
        tabSections: 6,
        editors: 6,
        activeEditorCards: 6,
        frontmatterWidgets: 6,
        tableWidgets: 6,
        latexBlockWidgets: 6,
    });
    await expect.poll(async () => (await readSixEditorDomSummary(page)).wikilinks, {
        message: "six editor resize fixture should render wikilinks",
        timeout: 20_000,
    }).toBeGreaterThanOrEqual(6);
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
        targetWidthRange: rangeFor((sample) => sample.targetWidth),
        editorWidthRange: rangeFor((sample) => sample.editorWidth),
        calendarWidthRange: rangeFor((sample) => sample.calendarWidth),
        taskBoardWidthRange: rangeFor((sample) => sample.taskBoardWidth),
        distinctMainSlotWidths: distinctCountFor((sample) => sample.mainSlotWidth),
        distinctTargetWidths: distinctCountFor((sample) => sample.targetWidth),
        distinctEditorWidths: distinctCountFor((sample) => sample.editorWidth),
        distinctCalendarWidths: distinctCountFor((sample) => sample.calendarWidth),
        distinctTaskBoardWidths: distinctCountFor((sample) => sample.taskBoardWidth),
        maxInnerTransformCount: Math.max(0, ...samples.map((sample) => sample.innerTransformCount)),
        samples,
    };
}

function summarizeSixEditorLiveResizeSamples(
    samples: SixEditorLiveResizeFrameSample[],
    strategy: string | null,
): SixEditorLiveResizeSummary {
    const rangeFor = (selector: (sample: SixEditorLiveResizeFrameSample) => number | null): number => {
        const values = samples
            .map(selector)
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        if (values.length === 0) {
            return 0;
        }
        return roundMetric(Math.max(...values) - Math.min(...values));
    };
    const editorWidthRanges: Record<string, number> = {};
    const distinctEditorWidths: Record<string, number> = {};

    for (const sectionId of SIX_EDITOR_TAB_SECTION_IDS) {
        const values = samples
            .map((sample) => sample.editorWidths[sectionId])
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        editorWidthRanges[sectionId] = values.length > 0
            ? roundMetric(Math.max(...values) - Math.min(...values))
            : 0;
        distinctEditorWidths[sectionId] = new Set(values.map((value) => Math.round(value))).size;
    }

    return {
        strategy,
        sampleCount: samples.length,
        leftColumnWidthRange: rangeFor((sample) => sample.leftColumnWidth),
        rightColumnWidthRange: rangeFor((sample) => sample.rightColumnWidth),
        editorWidthRanges,
        distinctEditorWidths,
        editorsWithWidthRangeOver40: Object.values(editorWidthRanges).filter((range) => range > 40).length,
        minVisibleEditorCount: Math.min(...samples.map((sample) => sample.visibleEditorCount)),
        minFrontmatterWidgetCount: Math.min(...samples.map((sample) => sample.frontmatterWidgetCount)),
        minTableWidgetCount: Math.min(...samples.map((sample) => sample.tableWidgetCount)),
        minLatexBlockWidgetCount: Math.min(...samples.map((sample) => sample.latexBlockWidgetCount)),
        minWikilinkCount: Math.min(...samples.map((sample) => sample.wikilinkCount)),
        maxInnerTransformCount: Math.max(0, ...samples.map((sample) => sample.innerTransformCount)),
        samples,
    };
}

async function sampleSixEditorLiveResizeDuringShortDrag(
    page: Page,
    dividerSelector: string,
    options: { delta: number; framesPerLeg: number },
): Promise<SixEditorLiveResizeSummary> {
    const result = await page.evaluate(
        ({ selector, delta, framesPerLeg, sectionIds }) => new Promise<{ samples: SixEditorLiveResizeFrameSample[]; strategy: string | null }>((resolve, reject) => {
            const divider = document.querySelector(selector);
            if (!(divider instanceof HTMLElement)) {
                reject(new Error(`Divider not found: ${selector}`));
                return;
            }

            const roundWidth = (value: number): number => Math.round(value * 10) / 10;
            const readComputedStyle = (targetSelector: string, property: keyof CSSStyleDeclaration): string | null => {
                const element = document.querySelector(targetSelector);
                if (!(element instanceof HTMLElement)) {
                    return null;
                }

                const value = window.getComputedStyle(element)[property];
                return typeof value === "string" && value.length > 0 ? value : null;
            };
            const readComputedStyleValues = (
                targetSelector: string,
                property: keyof CSSStyleDeclaration,
            ): string[] => Array.from(document.querySelectorAll<HTMLElement>(targetSelector))
                .map((element) => window.getComputedStyle(element)[property])
                .filter((value): value is string => typeof value === "string" && value.length > 0);
            const readComputedStyleInFirstNonActiveGroup = (
                targetSelector: string,
                property: keyof CSSStyleDeclaration,
            ): string | null => {
                const nonActiveSection = document.querySelector(
                    "[data-section-id='main-workspace'] .layout-v2-tab-section[data-layout-active-tab-group='false']",
                );
                if (!(nonActiveSection instanceof HTMLElement)) {
                    return null;
                }

                const element = nonActiveSection.querySelector(targetSelector);
                if (!(element instanceof HTMLElement)) {
                    return null;
                }

                const value = window.getComputedStyle(element)[property];
                return typeof value === "string" && value.length > 0 ? value : null;
            };
            const countVisibleElements = (targetSelector: string): number => Array.from(
                document.querySelectorAll<HTMLElement>(targetSelector),
            ).filter((element) => {
                const style = window.getComputedStyle(element);
                return style.display !== "none"
                    && style.visibility !== "hidden"
                    && Number(style.opacity || "1") > 0.01
                    && element.getBoundingClientRect().width > 0
                    && element.getBoundingClientRect().height > 0;
            }).length;
            const readMainWorkspaceSlotWidths = (): { leftColumnWidth: number | null; rightColumnWidth: number | null } => {
                const branch = document.querySelector("[data-section-id='main-workspace']");
                if (!(branch instanceof HTMLElement)) {
                    return { leftColumnWidth: null, rightColumnWidth: null };
                }
                const slots = Array.from(branch.children).filter((child): child is HTMLElement => (
                    child instanceof HTMLElement && child.classList.contains("layout-v2__child-slot")
                ));
                return {
                    leftColumnWidth: slots[0] ? roundWidth(slots[0].getBoundingClientRect().width) : null,
                    rightColumnWidth: slots[1] ? roundWidth(slots[1].getBoundingClientRect().width) : null,
                };
            };
            const readEditorWidths = (): Record<string, number> => {
                const widths: Record<string, number> = {};
                for (const sectionId of sectionIds) {
                    const editor = document.querySelector(`[data-tab-section-id='${sectionId}'] .cm-editor:not([data-editor-preview-mirror-node='true'])`);
                    if (editor instanceof HTMLElement) {
                        widths[sectionId] = roundWidth(editor.getBoundingClientRect().width);
                    }
                }
                return widths;
            };
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
            const readActiveCardContainValues = (): string[] => Array.from(
                document.querySelectorAll<HTMLElement>("[data-section-id='main-workspace'] .layout-v2-tab-section__card--active"),
            )
                .map((element) => window.getComputedStyle(element).contain)
                .filter((value) => value.length > 0);

            const samples: SixEditorLiveResizeFrameSample[] = [];
            const sample = (phase: SixEditorLiveResizeFrameSample["phase"], index: number): void => {
                const dividerLine = divider.querySelector<HTMLElement>(".layout-v2__divider-line");
                const activeCards = Array.from(
                    document.querySelectorAll<HTMLElement>(".layout-v2-tab-section__card--active"),
                );
                const countCardsWith = (selector: string): number =>
                    activeCards.filter((card) => Boolean(card.querySelector(selector))).length;
                const activeTabGroupSections = Array.from(
                    document.querySelectorAll<HTMLElement>(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section[data-layout-active-tab-group='true']",
                    ),
                );
                const tabGroupSections = Array.from(
                    document.querySelectorAll<HTMLElement>(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section[data-layout-active-tab-group]",
                    ),
                );

                samples.push({
                    phase,
                    index,
                    ...readMainWorkspaceSlotWidths(),
                    editorWidths: readEditorWidths(),
                    visibleEditorCount: document.querySelectorAll(
                        ".layout-v2-tab-section__card--active .cm-editor:not([data-editor-preview-mirror-node='true'])",
                    ).length,
                    frontmatterWidgetCount: countCardsWith(".cm-frontmatter-widget"),
                    tableWidgetCount: countCardsWith(".cm-markdown-table-widget, [data-markdown-table-block-from]"),
                    latexBlockWidgetCount: countCardsWith(".cm-latex-block-widget"),
                    wikilinkCount: document.querySelectorAll(
                        ".layout-v2-tab-section__card--active .cm-rendered-wikilink",
                    ).length,
                    innerTransformCount: countTransformedInnerNodes(),
                    rootIsResizing: document.documentElement.getAttribute("data-layout-resizing") === "true",
                    rootIsLightweight: document.documentElement.getAttribute("data-layout-lightweight") === "true",
                    childSlotPointerEvents: readComputedStyle("[data-section-id='main-workspace'] .layout-v2__child-slot-inner", "pointerEvents"),
                    activeTabGroupSectionCount: activeTabGroupSections.length,
                    activeTabGroupSectionIds: activeTabGroupSections
                        .map((section) => section.getAttribute("data-tab-section-id") ?? "missing"),
                    activeTabGroupValues: tabGroupSections
                        .map((section) => section.getAttribute("data-layout-active-tab-group") ?? "missing"),
                    activeCardContainValues: readActiveCardContainValues(),
                    editorContainValues: readComputedStyleValues(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-tab-editor .cm-editor",
                        "contain",
                    ),
                    scrollerContainValues: readComputedStyleValues(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-tab-editor .cm-scroller",
                        "contain",
                    ),
                    frontmatterWidgetContainValues: readComputedStyleValues(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-frontmatter-widget",
                        "contain",
                    ),
                    tableWidgetContainValues: readComputedStyleValues(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-markdown-table-widget",
                        "contain",
                    ),
                    latexWidgetContainValues: readComputedStyleValues(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-latex-block-widget",
                        "contain",
                    ),
                    tableCellBoxShadow: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active :is(.mtv-table-body-cell, .mtv-table-head-cell)",
                        "boxShadow",
                    ),
                    tableCellOutlineStyle: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active :is(.mtv-table-body-cell, .mtv-table-head-cell)",
                        "outlineStyle",
                    ),
                    tableCellOutlineWidth: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active :is(.mtv-table-body-cell, .mtv-table-head-cell)",
                        "outlineWidth",
                    ),
                    tableResizeHandleOpacity: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .mtv-resize-handle",
                        "opacity",
                    ),
                    tableEdgeHandleOpacity: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .mtv-edge-handle",
                        "opacity",
                    ),
                    frontmatterRowBoxShadow: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .fmv-row",
                        "boxShadow",
                    ),
                    frontmatterActionOpacity: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active :is(.fmv-mini-action, .fmv-mini-action-remove, .fmv-add-plus-button)",
                        "opacity",
                    ),
                    latexBlockBoxShadow: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-latex-block-widget",
                        "boxShadow",
                    ),
                    wikilinkTextShadow: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-rendered-wikilink",
                        "textShadow",
                    ),
                    editorBackgroundColor: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-tab-editor .cm-editor",
                        "backgroundColor",
                    ),
                    scrollerBackgroundColor: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-tab-editor .cm-scroller",
                        "backgroundColor",
                    ),
                    activeLineBackgroundColor: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-activeLine",
                        "backgroundColor",
                    ),
                    activeLineGutterBackgroundColor: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-activeLineGutter",
                        "backgroundColor",
                    ),
                    gutterBoxShadow: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-gutters",
                        "boxShadow",
                    ),
                    nonActiveGutterDisplay: readComputedStyleInFirstNonActiveGroup(
                        ".cm-tab-editor .cm-editor:not(.cm-focused) .cm-gutters",
                        "display",
                    ),
                    nonActiveGutterVisibility: readComputedStyleInFirstNonActiveGroup(
                        ".cm-tab-editor .cm-editor:not(.cm-focused) .cm-gutters",
                        "visibility",
                    ),
                    nonActiveSelectionLayerDisplay: readComputedStyleInFirstNonActiveGroup(
                        ".cm-tab-editor .cm-editor:not(.cm-focused) .cm-selectionLayer",
                        "display",
                    ),
                    nonActiveSelectionLayerVisibility: readComputedStyleInFirstNonActiveGroup(
                        ".cm-tab-editor .cm-editor:not(.cm-focused) .cm-selectionLayer",
                        "visibility",
                    ),
                    nonActiveHeaderSourceMarkerVisibility: readComputedStyleInFirstNonActiveGroup(
                        ".cm-tab-editor .cm-editor:not(.cm-focused) .cm-rendered-header-source-marker",
                        "visibility",
                    ),
                    nonFocusedCursorLayerVisibleCount: countVisibleElements(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-editor:not(.cm-focused) .cm-cursorLayer",
                    ),
                    codeBlockCopyButtonDisplay: readComputedStyle(
                        "[data-section-id='main-workspace'] .layout-v2-tab-section__card--active .cm-code-block-copy-btn",
                        "display",
                    ),
                    dividerLineTransitionProperty: dividerLine
                        ? window.getComputedStyle(dividerLine).transitionProperty
                        : null,
                });
            };

            const rect = divider.getBoundingClientRect();
            const startX = rect.left + rect.width / 2;
            const startY = rect.top + rect.height / 2;
            const pointerId = 29;
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
            sectionIds: [...SIX_EDITOR_TAB_SECTION_IDS],
        },
    );

    await page.waitForTimeout(80);
    return summarizeSixEditorLiveResizeSamples(result.samples, result.strategy);
}

async function sampleLiveResizeDuringShortDrag(
    page: Page,
    dividerSelector: string,
    options: { delta: number; framesPerLeg: number; targetSelector?: string },
): Promise<LiveResizeSummary> {
    const result = await page.evaluate(
        ({ selector, delta, framesPerLeg, targetSelector }) => new Promise<{ samples: LiveResizeFrameSample[]; strategy: string | null }>((resolve, reject) => {
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
            const readComputedStyle = (targetSelector: string, property: keyof CSSStyleDeclaration): string | null => {
                const element = document.querySelector(targetSelector);
                if (!(element instanceof HTMLElement)) {
                    return null;
                }

                const value = window.getComputedStyle(element)[property];
                return typeof value === "string" && value.length > 0 ? value : null;
            };
            const readBackdropFilter = (targetSelector: string): string | null => {
                const element = document.querySelector(targetSelector);
                if (!(element instanceof HTMLElement)) {
                    return null;
                }

                const style = window.getComputedStyle(element);
                return style.backdropFilter || style.webkitBackdropFilter || "none";
            };
            const countVisibleElements = (targetSelector: string): number => Array.from(
                document.querySelectorAll<HTMLElement>(targetSelector),
            ).filter((element) => {
                const style = window.getComputedStyle(element);
                return style.display !== "none"
                    && style.visibility !== "hidden"
                    && Number(style.opacity || "1") > 0.01
                    && element.getBoundingClientRect().width > 0
                    && element.getBoundingClientRect().height > 0;
            }).length;
            const readKnowledgeGraphResizeProfile = (): {
                active: boolean;
                pixelRatio: number | undefined;
                renderLinks: boolean | undefined;
                enableDrag: boolean | undefined;
                enableZoom: boolean | undefined;
            } | null => {
                const hook = (window as unknown as {
                    __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                        getSimulationRunning: () => boolean;
                        getResizeLightweightProfile?: () => {
                            active: boolean;
                            pixelRatio: number | undefined;
                            renderLinks: boolean | undefined;
                            enableDrag: boolean | undefined;
                            enableZoom: boolean | undefined;
                        };
                    };
                }).__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
                if (!hook) {
                    return null;
                }

                return hook.getResizeLightweightProfile?.() ?? null;
            };
            const readKnowledgeGraphSimulationRunning = (): boolean | null => {
                const hook = (window as unknown as {
                    __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: {
                        getSimulationRunning: () => boolean;
                    };
                }).__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
                if (!hook) {
                    return null;
                }

                return hook.getSimulationRunning();
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
                const dividerLine = divider.querySelector<HTMLElement>(".layout-v2__divider-line");
                const appShell = document.querySelector<HTMLElement>(".app-shell");
                const appShellStyle = appShell ? window.getComputedStyle(appShell) : null;
                const knowledgeGraphResizeProfile = readKnowledgeGraphResizeProfile();
                samples.push({
                    phase,
                    index,
                    ...slotWidths,
                    targetWidth: targetSelector ? readWidth(targetSelector) : null,
                    targetContain: targetSelector ? readComputedStyle(targetSelector, "contain") : null,
                    targetPointerEvents: targetSelector ? readComputedStyle(targetSelector, "pointerEvents") : null,
                    editorWidth: readWidth("[data-tab-section-id='main-tabs'] .cm-editor"),
                    calendarWidth: readWidth("[data-tab-section-id='calendar-tabs'] .calendar-tab__calendar-surface"),
                    taskBoardWidth: readWidth("[data-tab-section-id='task-tabs'] .task-board"),
                    innerTransformCount: countTransformedInnerNodes(),
                    rootIsResizing: document.documentElement.getAttribute("data-layout-resizing") === "true",
                    rootIsLightweight: document.documentElement.getAttribute("data-layout-lightweight") === "true",
                    childSlotPointerEvents: readComputedStyle("[data-section-id='main-workspace'] .layout-v2__child-slot-inner", "pointerEvents"),
                    activeCardContain: readComputedStyle("[data-section-id='main-workspace'] .layout-v2-tab-section__card--active", "contain"),
                    activePaneContain: readComputedStyle(".layout-v2-panel-section__pane--active", "contain"),
                    editorContain: readComputedStyle("[data-tab-section-id='main-tabs'] .cm-tab", "contain"),
                    calendarContain: readComputedStyle("[data-tab-section-id='calendar-tabs'] .calendar-tab", "contain"),
                    taskBoardContain: readComputedStyle("[data-tab-section-id='task-tabs'] .task-board", "contain"),
                    aiPanelContain: readComputedStyle(".ai-chat-panel", "contain"),
                    taskCardBoxShadow: readComputedStyle("[data-tab-section-id='task-tabs'] .task-board__task-card", "boxShadow"),
                    dividerLineTransitionProperty: dividerLine
                        ? window.getComputedStyle(dividerLine).transitionProperty
                        : null,
                    appShellBackdropFilter: appShellStyle
                        ? appShellStyle.backdropFilter || appShellStyle.webkitBackdropFilter || "none"
                        : null,
                    aiComposerBackdropFilter: readBackdropFilter(".ai-chat-composer"),
                    canvasAuxiliaryVisibleCount: countVisibleElements([
                        ".canvas-tab .react-flow__background",
                        ".canvas-tab .react-flow__controls",
                        ".canvas-tab .react-flow__minimap",
                        ".canvas-tab .react-flow__edge-textwrapper",
                        ".canvas-tab .react-flow__resize-control",
                        ".canvas-tab__actions",
                    ].join(",")),
                    canvasNodeBodyVisibility: readComputedStyle(
                        ".canvas-tab__node:not(.canvas-tab__node--editing) .canvas-tab__node-body",
                        "visibility",
                    ),
                    projectReaderCodeTextVisibility: readComputedStyle(
                        ".project-reader-code-text",
                        "visibility",
                    ),
                    knowledgeGraphLabelLayerOpacity: readComputedStyle(
                        ".knowledge-graph-tab__labels-layer",
                        "opacity",
                    ),
                    knowledgeGraphSimulationRunning: readKnowledgeGraphSimulationRunning(),
                    knowledgeGraphResizeLightweightActive: knowledgeGraphResizeProfile?.active ?? null,
                    knowledgeGraphPixelRatio: knowledgeGraphResizeProfile?.pixelRatio ?? null,
                    knowledgeGraphRenderLinks: knowledgeGraphResizeProfile?.renderLinks ?? null,
                    knowledgeGraphEnableDrag: knowledgeGraphResizeProfile?.enableDrag ?? null,
                    knowledgeGraphEnableZoom: knowledgeGraphResizeProfile?.enableZoom ?? null,
                    fileTreeItemTransitionProperty: readComputedStyle(".tree-item", "transitionProperty"),
                    outlineItemTransitionProperty: readComputedStyle(".outline-item", "transitionProperty"),
                    backlinksItemTransitionProperty: readComputedStyle(".backlinks-item", "transitionProperty"),
                    searchResultTransitionProperty: readComputedStyle(".search-result", "transitionProperty"),
                    searchResultSnippetVisibility: readComputedStyle(".search-result-snippet", "visibility"),
                    backlinksItemPreviewVisibility: readComputedStyle(".backlinks-item-preview", "visibility"),
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
            targetSelector: options.targetSelector ?? "",
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

async function sampleIdleFrames(page: Page, label: string, durationMs: number): Promise<PerfSamplerSummary> {
    await page.evaluate(
        (nextLabel) => window.__OFIVE_E2E_PERF__?.start(nextLabel),
        label,
    );
    await page.waitForTimeout(durationMs);
    return page.evaluate(() => {
        const summary = window.__OFIVE_E2E_PERF__?.stop();
        if (!summary) {
            throw new Error("Performance sampler is not installed");
        }
        return summary;
    });
}

async function runSectionDragScenario(page: Page, scenario: PerformanceScenarioConfig): Promise<ScenarioSummary> {
    const dividerSelector = "[data-section-id='main-workspace'] > .layout-v2__divider--horizontal[aria-label='Resize sections']";
    const idleSampler = await sampleIdleFrames(page, `${scenario.id}:idle`, 900);
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

    return {
        scenario: scenario.id,
        glassEnabled: scenario.glassEnabled,
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
        idleSampler,
        liveResize,
        sampler,
        timelineTop: timeline.slice(0, 12),
        timelineSelected: timeline.filter((item) => TIMELINE_SELECTED_EVENT_NAMES.has(item.name)),
    };
}

async function runComponentResizeScenario(
    page: Page,
    scenario: ComponentResizeScenarioConfig,
): Promise<ComponentResizeSummary> {
    const dividerSelector = "[data-section-id='main-workspace'] > .layout-v2__divider--horizontal[aria-label='Resize sections']";
    const idleSampler = await sampleIdleFrames(page, `${scenario.id}:idle`, 900);
    const liveResize = await sampleLiveResizeDuringShortDrag(
        page,
        dividerSelector,
        {
            delta: 120,
            framesPerLeg: 12,
            targetSelector: scenario.sampleSelector,
        },
    );

    const stopTrace = SHOULD_COLLECT_CHROMIUM_TRACE
        ? await startChromiumTimelineTrace(page)
        : null;
    await page.evaluate(
        (label) => window.__OFIVE_E2E_PERF__?.start(label),
        `${scenario.id}:component-resize`,
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

    const dom = await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
            return {
                mounted: false,
                tabComponent: null,
            };
        }

        return {
            mounted: true,
            tabComponent: element.getAttribute("data-tab-component"),
        };
    }, scenario.sampleSelector);

    return {
        component: scenario.id,
        title: scenario.title,
        liveResize,
        idleSampler,
        sampler,
        dom,
        timelineTop: timeline.slice(0, 12),
        timelineSelected: timeline.filter((item) => TIMELINE_SELECTED_EVENT_NAMES.has(item.name)),
    };
}

async function runArticlePanelResizeScenario(
    page: Page,
    scenario: ArticlePanelResizeScenarioConfig,
): Promise<ArticlePanelResizeSummary> {
    const dividerSelector = resolveArticlePanelDividerSelector(scenario);
    const idleSampler = await sampleIdleFrames(page, `${scenario.id}:idle`, 900);
    const liveResize = await sampleLiveResizeDuringShortDrag(
        page,
        dividerSelector,
        {
            delta: resolveArticlePanelDragDelta(scenario, 120),
            framesPerLeg: 12,
            targetSelector: scenario.sampleSelector,
        },
    );

    const stopTrace = SHOULD_COLLECT_CHROMIUM_TRACE
        ? await startChromiumTimelineTrace(page)
        : null;
    await page.evaluate(
        (label) => window.__OFIVE_E2E_PERF__?.start(label),
        `${scenario.id}:article-panel-resize`,
    );

    await dragDividerBackAndForth(
        page,
        dividerSelector,
        {
            delta: resolveArticlePanelDragDelta(scenario, 180),
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

    const dom = await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
            return {
                mounted: false,
                tabComponent: null,
            };
        }

        return {
            mounted: true,
            tabComponent: element.closest(".layout-v2-panel-section__pane")?.getAttribute("data-panel-id") ?? null,
        };
    }, scenario.sampleSelector);

    return {
        component: scenario.id,
        title: scenario.title,
        liveResize,
        idleSampler,
        sampler,
        dom,
        timelineTop: timeline.slice(0, 12),
        timelineSelected: timeline.filter((item) => TIMELINE_SELECTED_EVENT_NAMES.has(item.name)),
    };
}

async function runSixEditorResizeScenario(page: Page): Promise<SixEditorResizeSummary> {
    const dividerSelector = "[data-section-id='main-workspace'] > .layout-v2__divider--horizontal[aria-label='Resize sections']";
    const idleSampler = await sampleIdleFrames(page, "six-editor-grid:idle", 900);
    const liveResize = await sampleSixEditorLiveResizeDuringShortDrag(
        page,
        dividerSelector,
        {
            delta: 180,
            framesPerLeg: 18,
        },
    );

    const stopTrace = SHOULD_COLLECT_CHROMIUM_TRACE
        ? await startChromiumTimelineTrace(page)
        : null;
    await page.evaluate(
        (label) => window.__OFIVE_E2E_PERF__?.start(label),
        "six-editor-grid:main-divider-drag",
    );

    await dragDividerBackAndForth(
        page,
        dividerSelector,
        {
            delta: 220,
            cycles: 2,
            framesPerLeg: 30,
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

    return {
        scenario: "six-editor-grid",
        dom: await readSixEditorDomSummary(page),
        idleSampler,
        liveResize,
        sampler,
        timelineTop: timeline.slice(0, 12),
        timelineSelected: timeline.filter((item) => TIMELINE_SELECTED_EVENT_NAMES.has(item.name)),
    };
}

test.describe("workbench section performance", () => {
    test("profiles six split markdown editors reflowing during one continuous resize", async ({ page }, testInfo) => {
        test.slow();
        await page.setViewportSize({ width: 1920, height: 1200 });
        const mockVaultPath = await gotoMockVaultPage(
            page,
            "workbench-six-editor-resize",
            buildComponentMockPageUrl(),
        );
        await configureSixEditorResizeFixture(page, mockVaultPath);
        await waitForSixEditorResizeFixtureReady(page);
        await installPerformanceSampler(page);

        const summary = await runSixEditorResizeScenario(page);
        console.log(`[workbench-six-editor-resize] ${JSON.stringify(compactSixEditorResizeSummary(summary))}`);
        await testInfo.attach("workbench-six-editor-resize.json", {
            body: JSON.stringify(summary, null, 2),
            contentType: "application/json",
        });
        await testInfo.attach("workbench-six-editor-resize-summary.json", {
            body: JSON.stringify(compactSixEditorResizeSummary(summary), null, 2),
            contentType: "application/json",
        });

        const activeResizeSamples = summary.liveResize.samples.filter((sample) => sample.phase !== "end");
        expect(summary.dom).toMatchObject({
            tabSections: 6,
            editors: 6,
            activeEditorCards: 6,
            frontmatterWidgets: 6,
            tableWidgets: 6,
            latexBlockWidgets: 6,
        });
        expect(summary.dom.wikilinks).toBeGreaterThanOrEqual(6);
        expect(summary.liveResize.strategy).toBe("dom-flex");
        expect(summary.liveResize.maxInnerTransformCount).toBe(0);
        expect(summary.liveResize.sampleCount).toBeGreaterThan(40);
        expect(summary.liveResize.leftColumnWidthRange).toBeGreaterThan(120);
        expect(summary.liveResize.rightColumnWidthRange).toBeGreaterThan(120);
        expect(summary.liveResize.editorsWithWidthRangeOver40).toBe(6);
        for (const sectionId of SIX_EDITOR_TAB_SECTION_IDS) {
            expect(summary.liveResize.distinctEditorWidths[sectionId]).toBeGreaterThan(12);
        }
        expect(summary.liveResize.minVisibleEditorCount).toBe(6);
        expect(summary.liveResize.minFrontmatterWidgetCount).toBe(6);
        expect(summary.liveResize.minTableWidgetCount).toBe(6);
        expect(summary.liveResize.minLatexBlockWidgetCount).toBe(6);
        expect(summary.liveResize.minWikilinkCount).toBeGreaterThanOrEqual(6);
        expect(activeResizeSamples.every((sample) => sample.rootIsResizing)).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.rootIsLightweight)).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.childSlotPointerEvents === "none")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.activeTabGroupSectionCount === 1)).toBe(true);
        expect(activeResizeSamples.every((sample) => (
            sample.activeTabGroupSectionIds.length === 1 &&
            sample.activeTabGroupSectionIds[0] === SIX_EDITOR_TAB_SECTION_IDS[0]
        ))).toBe(true);
        expect(activeResizeSamples.every((sample) => (
            sample.activeTabGroupValues.filter((value) => value === "true").length === 1 &&
            sample.activeTabGroupValues.filter((value) => value === "false").length === 5
        ))).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.dividerLineTransitionProperty === "none")).toBe(true);
        expect(activeResizeSamples.every((sample) => (
            sample.activeCardContainValues.length === 6 &&
            sample.activeCardContainValues.every((value) => hasLayoutContain(value))
        ))).toBe(true);
        expect(activeResizeSamples.every((sample) => (
            sample.editorContainValues.length === 6 &&
            sample.editorContainValues.every((value) => hasLayoutContain(value))
        ))).toBe(true);
        expect(activeResizeSamples.every((sample) => (
            sample.scrollerContainValues.length === 6 &&
            sample.scrollerContainValues.every((value) => hasLayoutContain(value))
        ))).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.tableCellBoxShadow === "none")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.tableCellOutlineStyle === "solid")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.tableCellOutlineWidth === "1px")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.tableResizeHandleOpacity === "0")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.tableEdgeHandleOpacity === "0")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.frontmatterRowBoxShadow === "none")).toBe(true);
        expect(activeResizeSamples
            .filter((sample) => sample.frontmatterActionOpacity !== null)
            .every((sample) => sample.frontmatterActionOpacity === "0")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.latexBlockBoxShadow === "none")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.wikilinkTextShadow === "none")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.editorBackgroundColor === "rgba(0, 0, 0, 0)")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.scrollerBackgroundColor === "rgba(0, 0, 0, 0)")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.activeLineBackgroundColor === "rgba(0, 0, 0, 0)")).toBe(true);
        expect(activeResizeSamples
            .filter((sample) => sample.activeLineGutterBackgroundColor !== null)
            .every((sample) => sample.activeLineGutterBackgroundColor === "rgba(0, 0, 0, 0)")).toBe(true);
        expect(activeResizeSamples
            .filter((sample) => sample.gutterBoxShadow !== null)
            .every((sample) => sample.gutterBoxShadow === "none")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.nonActiveGutterDisplay !== "none")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.nonActiveGutterVisibility === "hidden")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.nonActiveSelectionLayerDisplay !== "none")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.nonActiveSelectionLayerVisibility !== "hidden")).toBe(true);
        expect(activeResizeSamples
            .filter((sample) => sample.nonActiveHeaderSourceMarkerVisibility !== null)
            .every((sample) => sample.nonActiveHeaderSourceMarkerVisibility === "hidden")).toBe(true);
        expect(activeResizeSamples.every((sample) => sample.nonFocusedCursorLayerVisibleCount === 0)).toBe(true);
        expect(activeResizeSamples
            .filter((sample) => sample.codeBlockCopyButtonDisplay !== null)
            .every((sample) => sample.codeBlockCopyButtonDisplay === "none")).toBe(true);
        expect(summary.idleSampler.frameCount).toBeGreaterThan(10);
        expect(summary.sampler.frameCount).toBeGreaterThan(10);
        expect(summary.sampler.durationMs).toBeGreaterThan(500);
        expectResizeFrameBudget("six-editor-grid", summary.idleSampler, summary.sampler);
    });

    test("compares continuous main-section resize across editor, calendar and task board variants", async ({ page }, testInfo) => {
        test.slow();
        const summaries: ScenarioSummary[] = [];

        for (const scenario of PERFORMANCE_SCENARIOS) {
            const mockVaultPath = await gotoMockVaultPage(
                page,
                `workbench-section-performance-${scenario.id}`,
                buildMockPageUrl(scenario),
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
            const activeResizeSamples = summary.liveResize.samples.filter((sample) => sample.phase !== "end");
            expect(activeResizeSamples.every((sample) => sample.rootIsResizing)).toBe(true);
            expect(activeResizeSamples.every((sample) => sample.rootIsLightweight)).toBe(true);
            expect(activeResizeSamples.every((sample) => sample.childSlotPointerEvents === "none")).toBe(true);
            expect(activeResizeSamples.every((sample) => hasLayoutContain(sample.activeCardContain))).toBe(true);
            expect(activeResizeSamples.some((sample) => hasLayoutContain(sample.activePaneContain))).toBe(true);
            expect(activeResizeSamples.every((sample) => sample.dividerLineTransitionProperty === "none")).toBe(true);
            expect(activeResizeSamples.some((sample) => hasLayoutContain(sample.aiPanelContain))).toBe(true);
            expect(activeResizeSamples.every((sample) => sample.aiComposerBackdropFilter === "none")).toBe(true);
            if (scenario.glassEnabled) {
                expect(activeResizeSamples.every((sample) => sample.appShellBackdropFilter === "none")).toBe(true);
            }
            expect(summary.liveResize.mainSlotWidthRange).toBeGreaterThan(80);
            expect(summary.liveResize.rightSlotWidthRange).toBeGreaterThan(80);
            expect(summary.liveResize.distinctMainSlotWidths).toBeGreaterThan(8);
            if (scenario.mainVisible) {
                expect(summary.liveResize.editorWidthRange).toBeGreaterThan(60);
                expect(summary.liveResize.distinctEditorWidths).toBeGreaterThan(8);
                expect(activeResizeSamples.every((sample) => hasLayoutContain(sample.editorContain))).toBe(true);
            } else {
                expect(summary.liveResize.editorWidthRange).toBe(0);
                expect(summary.liveResize.distinctEditorWidths).toBe(0);
            }
            if (scenario.calendarVisible) {
                expect(summary.liveResize.calendarWidthRange).toBeGreaterThan(60);
                expect(summary.liveResize.distinctCalendarWidths).toBeGreaterThan(8);
                expect(activeResizeSamples.every((sample) => hasLayoutContain(sample.calendarContain))).toBe(true);
            }
            if (scenario.taskVisible) {
                expect(summary.liveResize.taskBoardWidthRange).toBeGreaterThan(60);
                expect(summary.liveResize.distinctTaskBoardWidths).toBeGreaterThan(8);
                expect(activeResizeSamples.every((sample) => hasLayoutContain(sample.taskBoardContain))).toBe(true);
                expect(activeResizeSamples.every((sample) => sample.taskCardBoxShadow === "none")).toBe(true);
            }
            expect(summary.idleSampler.frameCount).toBeGreaterThan(10);
            expect(summary.sampler.frameCount).toBeGreaterThan(10);
            expect(summary.sampler.durationMs).toBeGreaterThan(500);
            expectResizeFrameBudget(`section:${scenario.id}`, summary.idleSampler, summary.sampler);
        }

        await testInfo.attach("workbench-section-performance-summary.json", {
            body: JSON.stringify(summaries.map(compactScenarioSummary), null, 2),
            contentType: "application/json",
        });
    });

    test("keeps high-priority article tab components mounted and reflowing during continuous resize", async ({ page }, testInfo) => {
        test.slow();
        const summaries: ComponentResizeSummary[] = [];

        const scenarios = COMPONENT_RESIZE_SCENARIO_FILTER.size > 0
            ? COMPONENT_RESIZE_SCENARIOS.filter((scenario) => COMPONENT_RESIZE_SCENARIO_FILTER.has(scenario.id))
            : COMPONENT_RESIZE_SCENARIOS.filter((scenario) => COMPONENT_RESIZE_DEFAULT_SCENARIO_IDS.has(scenario.id));

        expect(scenarios.length).toBeGreaterThan(0);

        for (const scenario of scenarios) {
            const mockVaultPath = await gotoMockVaultPage(
                page,
                `workbench-component-resize-${scenario.id}`,
                buildComponentMockPageUrl(),
            );
            await configureComponentResizeFixture(page, mockVaultPath, scenario);
            await waitForComponentResizeFixtureReady(page, scenario);
            await installPerformanceSampler(page);

            const summary = await runComponentResizeScenario(page, scenario);
            summaries.push(summary);

            console.log(`[workbench-component-resize] ${JSON.stringify(compactComponentResizeSummary(summary))}`);
            await testInfo.attach(`workbench-component-resize-${scenario.id}.json`, {
                body: JSON.stringify(summary, null, 2),
                contentType: "application/json",
            });

            const activeResizeSamples = summary.liveResize.samples.filter((sample) => sample.phase !== "end");

            expect(summary.dom.mounted).toBe(true);
            expect(summary.liveResize.strategy).toBe("dom-flex");
            expect(summary.liveResize.maxInnerTransformCount).toBe(0);
            expect(summary.liveResize.sampleCount).toBeGreaterThan(20);
            expect(summary.liveResize.targetWidthRange).toBeGreaterThan(60);
            expect(summary.liveResize.distinctTargetWidths).toBeGreaterThan(8);
            expect(activeResizeSamples.every((sample) => sample.rootIsResizing)).toBe(true);
            expect(activeResizeSamples.every((sample) => sample.rootIsLightweight)).toBe(true);
            expect(activeResizeSamples.every((sample) => sample.childSlotPointerEvents === "none")).toBe(true);
            expect(activeResizeSamples.every((sample) => hasLayoutContain(sample.activeCardContain))).toBe(true);
            expect(activeResizeSamples.every((sample) => hasLayoutContain(sample.targetContain))).toBe(true);
            if (scenario.id === "canvas") {
                expect(activeResizeSamples.every((sample) => sample.canvasAuxiliaryVisibleCount === 0)).toBe(true);
                expect(activeResizeSamples.every((sample) => sample.canvasNodeBodyVisibility === "hidden")).toBe(true);
            }
            if (scenario.id === "knowledgegraph") {
                expect(activeResizeSamples.every((sample) => sample.knowledgeGraphLabelLayerOpacity === "0")).toBe(true);
                const moveSamples = activeResizeSamples.filter((sample) => sample.phase === "move");
                expect(moveSamples.every((sample) => sample.knowledgeGraphSimulationRunning === false)).toBe(true);
                expect(moveSamples.every((sample) => sample.knowledgeGraphResizeLightweightActive === true)).toBe(true);
                expect(moveSamples.every((sample) => sample.knowledgeGraphPixelRatio === 1)).toBe(true);
                expect(moveSamples.every((sample) => sample.knowledgeGraphRenderLinks === false)).toBe(true);
                expect(moveSamples.every((sample) => sample.knowledgeGraphEnableDrag === false)).toBe(true);
                expect(moveSamples.every((sample) => sample.knowledgeGraphEnableZoom === false)).toBe(true);
            }
            if (scenario.id === "project-reader-code") {
                expect(activeResizeSamples.every((sample) => sample.projectReaderCodeTextVisibility === "hidden")).toBe(true);
            }
            expect(summary.idleSampler.frameCount).toBeGreaterThan(10);
            expect(summary.sampler.frameCount).toBeGreaterThan(10);
            expect(summary.sampler.durationMs).toBeGreaterThan(500);
            expectResizeFrameBudget(`component:${scenario.id}`, summary.idleSampler, summary.sampler);
        }

        await testInfo.attach("workbench-component-resize-summary.json", {
            body: JSON.stringify(summaries.map(compactComponentResizeSummary), null, 2),
            contentType: "application/json",
        });
    });

    test("keeps article side panels mounted and reflowing during continuous resize", async ({ page }, testInfo) => {
        test.slow();
        const summaries: ArticlePanelResizeSummary[] = [];

        const scenarios = ARTICLE_PANEL_RESIZE_SCENARIO_FILTER.size > 0
            ? ARTICLE_PANEL_RESIZE_SCENARIOS.filter((scenario) => ARTICLE_PANEL_RESIZE_SCENARIO_FILTER.has(scenario.id))
            : ARTICLE_PANEL_RESIZE_SCENARIOS;

        expect(scenarios.length).toBeGreaterThan(0);

        for (const scenario of scenarios) {
            const mockVaultPath = await gotoMockVaultPage(
                page,
                `workbench-article-panel-resize-${scenario.id}`,
                buildComponentMockPageUrl(),
            );
            await configureArticlePanelResizeFixture(page, mockVaultPath, scenario);
            await waitForArticlePanelResizeFixtureReady(page, scenario);
            await installPerformanceSampler(page);

            const summary = await runArticlePanelResizeScenario(page, scenario);
            summaries.push(summary);

            console.log(`[workbench-article-panel-resize] ${JSON.stringify(compactArticlePanelResizeSummary(summary))}`);
            await testInfo.attach(`workbench-article-panel-resize-${scenario.id}.json`, {
                body: JSON.stringify(summary, null, 2),
                contentType: "application/json",
            });

            const activeResizeSamples = summary.liveResize.samples.filter((sample) => sample.phase !== "end");

            expect(summary.dom.mounted).toBe(true);
            expect(summary.liveResize.strategy).toBe("dom-flex");
            expect(summary.liveResize.maxInnerTransformCount).toBe(0);
            expect(summary.liveResize.sampleCount).toBeGreaterThan(20);
            expect(summary.liveResize.targetWidthRange).toBeGreaterThan(60);
            expect(summary.liveResize.distinctTargetWidths).toBeGreaterThan(8);
            expect(activeResizeSamples.every((sample) => sample.rootIsResizing)).toBe(true);
            expect(activeResizeSamples.every((sample) => sample.rootIsLightweight)).toBe(true);
            expect(activeResizeSamples.every((sample) => hasLayoutContain(sample.activePaneContain))).toBe(true);
            expect(activeResizeSamples.every((sample) => hasLayoutContain(sample.targetContain))).toBe(true);
            expect(activeResizeSamples.every((sample) => sample.dividerLineTransitionProperty === "none")).toBe(true);
            if (scenario.id === "file-tree") {
                expect(activeResizeSamples.every((sample) => sample.fileTreeItemTransitionProperty === "none")).toBe(true);
            }
            if (scenario.id === "outline") {
                expect(activeResizeSamples.every((sample) => sample.outlineItemTransitionProperty === "none")).toBe(true);
            }
            if (scenario.id === "backlinks") {
                expect(activeResizeSamples
                    .filter((sample) => sample.backlinksItemTransitionProperty !== null)
                    .every((sample) => sample.backlinksItemTransitionProperty === "none")).toBe(true);
            }
            if (scenario.id === "search") {
                expect(activeResizeSamples
                    .filter((sample) => sample.searchResultTransitionProperty !== null)
                    .every((sample) => sample.searchResultTransitionProperty === "none")).toBe(true);
            }
            expect(summary.idleSampler.frameCount).toBeGreaterThan(10);
            expect(summary.sampler.frameCount).toBeGreaterThan(10);
            expect(summary.sampler.durationMs).toBeGreaterThan(500);
            expectResizeFrameBudget(`article-panel:${scenario.id}`, summary.idleSampler, summary.sampler);
        }

        await testInfo.attach("workbench-article-panel-resize-summary.json", {
            body: JSON.stringify(summaries.map(compactArticlePanelResizeSummary), null, 2),
            contentType: "application/json",
        });
    });
});
