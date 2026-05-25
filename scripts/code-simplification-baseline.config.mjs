/**
 * @file scripts/code-simplification-baseline.config.mjs
 * @description 代码简化扫描与门禁的共享配置：记录历史债务基线，并阻止新增复杂度入口。
 */

export const codeSimplificationScanRoots = [
    "src",
    "src-tauri/src",
    "src-tauri/tests",
    "sidecars/go/ofive-ai-agent/internal",
    "scripts",
    "e2e",
    "tests",
];

export const codeSimplificationSourceExtensions = new Set([
    ".css",
    ".go",
    ".mjs",
    ".rs",
    ".ts",
    ".tsx",
]);

export const codeSimplificationIgnoredDirectoryNames = new Set([
    ".git",
    "dist",
    "gen",
    "node_modules",
    "target",
]);

export const lineCountThresholds = {
    source: 800,
    backendSource: 900,
    css: 700,
    script: 600,
    test: 1200,
};

/**
 * 历史超大文件基线。guard 允许这些文件继续存在，但不允许继续膨胀。
 */
export const lineCountBaseline = {
    "src/plugins/ai-chat/aiChatPlugin.tsx": 3784,
    "src/api/vaultApi.ts": 3060,
    "src/plugins/markdown-codemirror/editor/components/MarkdownTableVisualEditor.tsx": 2477,
    "src/plugins/architecture-devtools/ArchitectureDevtoolsTab.tsx": 2468,
    "src-tauri/src/app/project_reader/project_reader_app_service.rs": 2025,
    "src/host/layout/WorkbenchLayoutHost.tsx": 2007,
    "src/plugins/ai-chat/aiChatPlugin.css": 1971,
    "src/plugins/architecture-devtools/architectureDiscovery.ts": 1888,
    "src/plugins/markdown-codemirror/editor/components/FrontmatterYamlVisualEditor.tsx": 1812,
    "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css": 1752,
    "sidecars/go/ofive-ai-agent/internal/agent/runtime.go": 1821,
    "src/plugins/knowledge-graph/tab/KnowledgeGraphTab.tsx": 1627,
    "src-tauri/src/infra/fs/write_runtime.rs": 1526,
    "src-tauri/src/app/semantic_index/index_app_service.rs": 1441,
    "src/plugins/file-tree/panel/FileTree.tsx": 1427,
    "src/App.css": 1426,
    "src/plugins/markdown-codemirror/editor/MarkdownReadView.tsx": 1413,
    "src-tauri/src/infra/persistence/ai_chat_store.rs": 1373,
    "src-tauri/src/infra/query/query_index.rs": 1350,
    "src/host/config/configStore.ts": 1371,
    "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts": 1272,
    "src/plugins/project-reader/ProjectReaderCodeTab.tsx": 1250,
    "e2e/markdown-table-vim.e2e.ts": 1204,
    "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.tsx": 1184,
    "src/plugins/semantic-index/semanticIndexPlugin.tsx": 1137,
    "src/plugins/canvas/CanvasTab.tsx": 1107,
    "src/plugins/calendar/CalendarView.tsx": 1277,
    "src/i18n/locales/zh.ts": 1149,
    "src/i18n/locales/en.ts": 1139,
    "sidecars/go/ofive-ai-agent/internal/llms/baidu.go": 1052,
    "sidecars/go/ofive-ai-agent/internal/llms/minimax.go": 989,
    "scripts/perf-report.mjs": 987,
    "src/plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkPreviewExtension.tsx": 978,
    "src-tauri/src/app/vault/capability_execution.rs": 1808,
    "src/plugins/architecture-devtools/architectureDevtools.css": 964,
    "src-tauri/src/infra/query/search.rs": 942,
    "src/plugins/file-tree/panel/VaultPanel.tsx": 891,
    "src/plugins/tasks/task-board/taskBoard.css": 883,
    "src/plugins/tasks/task-board/TaskBoardTab.tsx": 1957,
    "src/plugins/markdown-codemirror/editor/editPlugins/wikilinkSuggestEditPlugin.ts": 825,
    "src/host/layout/SettingsTab.css": 735,
};

/**
 * TypeScript escape hatch 基线。新增或增加这些逃逸点需要先收敛类型边界。
 */
export const escapeHatchBaseline = {
    "src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.ts": 3,
    "src/host/editor/autoSaveService.ts": 2,
    "src/api/vaultApi.ts": 1,
    "src/host/layout/WorkbenchLayoutHost.tsx": 1,
    "src/host/registry/registerBuiltinComponents.ts": 1,
    "src/plugins/canvas/canvasPlugin.tsx": 1,
    "src/plugins/image-viewer/imageViewerOpenerPlugin.tsx": 1,
    "src/plugins/markdown-codemirror/codemirrorOpenerPlugin.tsx": 1,
    "src/plugins/project-reader/projectReaderPlugin.tsx": 1,
};

export const allowedRawTauriFiles = new Set([
    "src/host/commands/systemShortcutSubsystem.ts",
    "src/host/layout/CustomTitlebar.tsx",
    "src/host/layout/nativeContextMenu.ts",
    "src/host/window/mainWindowFullscreenController.ts",
    "src/utils/frontendLogBridge.ts",
    "src/utils/windowDragGesture.ts",
]);

export const legacyStoreEntrypointModules = new Set([
    "configStore",
    "shortcutStore",
    "themeStore",
    "vaultStore",
]);

export const duplicateStoreEntrypointPairs = [
    {
        canonical: "src/host/config/configStore.ts",
        duplicate: "src/host/store/configStore.ts",
    },
    {
        canonical: "src/host/vault/vaultStore.ts",
        duplicate: "src/host/store/vaultStore.ts",
    },
    {
        canonical: "src/host/theme/themeStore.ts",
        duplicate: "src/host/store/themeStore.ts",
    },
    {
        canonical: "src/host/commands/shortcutStore.ts",
        duplicate: "src/host/store/shortcutStore.ts",
    },
];

export const persistedContentAllowedFilesBySymbol = {
    deleteVaultCanvasFile: new Set([
        "src/api/vaultApi.ts",
        "src/host/vault/vaultMutationService.ts",
    ]),
    deleteVaultMarkdownFile: new Set([
        "src/api/vaultApi.ts",
        "src/host/vault/vaultMutationService.ts",
    ]),
    emitPersistedContentUpdatedEvent: new Set([
        "src/host/editor/autoSaveService.ts",
        "src/host/editor/persistedMarkdownContentSync.ts",
        "src/host/events/appEventBus.ts",
        "src/host/vault/vaultMutationService.ts",
        "src/plugins/vault-fs-sync/vaultFsSyncPlugin.ts",
    ]),
    moveVaultMarkdownFileToDirectory: new Set([
        "src/api/vaultApi.ts",
        "src/host/vault/vaultMutationService.ts",
    ]),
    moveVaultCanvasFileToDirectory: new Set([
        "src/api/vaultApi.ts",
        "src/host/vault/vaultMutationService.ts",
    ]),
    renameVaultCanvasFile: new Set([
        "src/api/vaultApi.ts",
        "src/host/vault/vaultMutationService.ts",
    ]),
    renameVaultMarkdownFile: new Set([
        "src/api/vaultApi.ts",
        "src/host/vault/vaultMutationService.ts",
    ]),
    saveVaultCanvasFile: new Set([
        "src/api/vaultApi.ts",
        "src/host/editor/persistedMarkdownContentSync.ts",
    ]),
    saveVaultMarkdownFile: new Set([
        "src/api/vaultApi.ts",
        "src/host/editor/autoSaveService.ts",
        "src/host/editor/persistedMarkdownContentSync.ts",
    ]),
};
