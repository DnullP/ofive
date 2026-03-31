/**
 * @file scripts/store-state-flow-coverage.config.mjs
 * @description store 状态全流程测试覆盖清单：声明 store 逻辑与 store 使用逻辑必须对应的测试锚点。
 */

/**
 * 主发现源为 store 注册中心；以下模块作为显式治理例外继续纳入 guard。
 * 这类模块要么是根状态枢纽，要么是尚未接入 store hub、但仍必须完成状态全流程测试的状态模块。
 */
export const explicitlyGovernedStoreLogicModules = [
    "src/host/store/storeRegistry.ts",
    "src/host/store/registerBuiltinManagedStores.ts",
    "src/host/layout/activityBarStore.ts",
    "src/host/editor/editorDisplayModeStore.ts",
    "src/host/editor/activeEditorStore.ts",
    "src/host/editor/editorContextStore.ts",
    "src/host/editor/autoSaveService.ts",
];

/**
 * store 逻辑覆盖清单。
 */
export const storeLogicCoverage = {
    "src/host/store/configStore.ts": [
        "src/host/store/configStore.test.ts",
        "src/host/window/useWindowEffectsSync.test.ts",
    ],
    "src/host/store/vaultStore.ts": [
        "e2e/vault-switch-regression.e2e.ts",
    ],
    "src/host/store/storeRegistry.ts": [
        "src/host/store/storeRegistry.test.ts",
    ],
    "src/host/store/registerBuiltinManagedStores.ts": [
        "src/host/store/registerBuiltinManagedStores.test.ts",
    ],
    "src/host/theme/themeStore.ts": [
        "src/host/window/useWindowEffectsSync.test.ts",
        "e2e/glass-visual.e2e.ts",
    ],
    "src/host/commands/shortcutStore.ts": [
        "src/host/commands/shortcutDispatcher.test.ts",
        "src/host/commands/shortcutGovernance.test.ts",
    ],
    "src/host/layout/activityBarStore.ts": [
        "src/host/layout/activityBarStore.test.ts",
    ],
    "src/host/editor/editorDisplayModeStore.ts": [
        "src/host/editor/editorDisplayModeStore.test.ts",
    ],
    "src/host/editor/activeEditorStore.ts": [
        "src/host/editor/activeEditorStore.test.ts",
    ],
    "src/host/editor/editorContextStore.ts": [
        "src/host/editor/editorContextStore.test.ts",
    ],
    "src/host/editor/autoSaveService.ts": [
        "src/host/editor/autoSaveService.test.ts",
    ],
    "src/plugins/ai-chat/aiChatSettingsStore.ts": [
        "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
    ],
    "src/plugins/knowledge-graph/store/graphSettingsStore.ts": [
        "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
        "tests/knowledgeGraphInteractions.test.ts",
    ],
};

/**
 * 已注册 store 的 schema 覆盖清单。
 * 每个 action / flow 触发 / failure mode 都必须绑定真实测试锚点。
 */
export const storeSchemaCoverage = {
    "src/host/store/configStore.ts": {
        actions: {
            "load-config": [
                "src/host/store/configStore.test.ts",
            ],
            "update-backend-config": [
                "src/host/store/configStore.test.ts",
            ],
            "update-frontend-settings": [
                "src/host/store/configStore.test.ts",
            ],
            "reset-config": [
                "src/host/store/configStore.test.ts",
            ],
        },
        flow: {
            "hydrate-active-vault": [
                "src/host/store/configStore.test.ts",
            ],
            "hydrate-success": [
                "src/host/store/configStore.test.ts",
            ],
            "hydrate-failure": [
                "src/host/store/configStore.test.ts",
            ],
            "reset-context": [
                "src/host/store/configStore.test.ts",
            ],
        },
        failureModes: {
            "backend read/write failure leaves normalized defaults plus error message": [
                "src/host/store/configStore.test.ts",
            ],
            "vault switches can invalidate in-flight config results and require reset before next hydrate": [
                "src/host/store/configStore.test.ts",
            ],
        },
    },
    "src/host/store/vaultStore.ts": {
        actions: {
            "set-current-vault": [
                "e2e/vault-switch-regression.e2e.ts",
            ],
            "load-tree": [
                "e2e/vault-switch-regression.e2e.ts",
            ],
            "apply-fs-event": [
                "src/plugins/vault-fs-sync/vaultFsSyncPlugin.test.ts",
            ],
            "reset-vault-state": [
                "e2e/vault-switch-regression.e2e.ts",
            ],
        },
        flow: {
            "select-vault": [
                "e2e/vault-switch-regression.e2e.ts",
            ],
            "backend-ready": [
                "e2e/vault-switch-regression.e2e.ts",
            ],
            "tree-load-success": [
                "e2e/vault-switch-regression.e2e.ts",
            ],
            "sync-or-load-failure": [
                "e2e/vault-switch-regression.e2e.ts",
            ],
            "clear-vault": [
                "e2e/vault-switch-regression.e2e.ts",
            ],
        },
        failureModes: {
            "backend handshake failure keeps backendReady=false and surfaces error": [
                "e2e/vault-switch-regression.e2e.ts",
            ],
            "tree load failure leaves the previous file snapshot stale until the next successful refresh": [
                "e2e/vault-switch-regression.e2e.ts",
            ],
        },
    },
    "src/host/theme/themeStore.ts": {
        actions: {
            "update-theme-mode": [
                "src/host/window/useWindowEffectsSync.test.ts",
                "e2e/glass-visual.e2e.ts",
            ],
            "hydrate-theme-mode": [
                "src/host/window/useWindowEffectsSync.test.ts",
            ],
        },
        flow: {
            "application bootstrap": [
                "src/host/window/useWindowEffectsSync.test.ts",
            ],
            "user changes appearance settings": [
                "e2e/glass-visual.e2e.ts",
            ],
        },
        failureModes: {
            "invalid persisted value falls back to dark before notifying subscribers": [
                "src/host/window/useWindowEffectsSync.test.ts",
            ],
        },
    },
    "src/host/commands/shortcutStore.ts": {
        actions: {
            "load-shortcuts": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
            "update-binding": [
                "src/host/commands/shortcutDispatcher.test.ts",
                "src/host/commands/shortcutGovernance.test.ts",
            ],
            "sync-registered-commands": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
            "reset-shortcuts": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
        },
        flow: {
            "load-request": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
            "load-success": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
            "save-request": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
            "save-success": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
            "request-failure": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
            "reset-context": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
        },
        failureModes: {
            "save failure rolls bindings back to the previous stable snapshot": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
            "loading against a stale vault path must not leak bindings into the next vault context": [
                "src/host/commands/shortcutDispatcher.test.ts",
            ],
        },
    },
    "src/plugins/ai-chat/aiChatSettingsStore.ts": {
        actions: {
            "ensure-loaded": [
                "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
            ],
            "save-settings": [
                "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
            ],
            "reset-settings": [
                "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
            ],
        },
        flow: {
            "load-or-save-request": [
                "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
            ],
            "request-success": [
                "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
            ],
            "request-failure": [
                "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
            ],
            "reset-context": [
                "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
            ],
        },
        failureModes: {
            "async API failure leaves the previous settings snapshot or null plus error": [
                "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
            ],
            "vault switch must reset cached settings before the next load completes": [
                "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
            ],
        },
    },
    "src/plugins/knowledge-graph/store/graphSettingsStore.ts": {
        actions: {
            "load-settings": [
                "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
            ],
            "save-settings": [
                "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
            ],
            "reset-settings": [
                "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
            ],
        },
        flow: {
            "load-or-save-request": [
                "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
            ],
            "request-success": [
                "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
            ],
            "request-failure": [
                "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
            ],
            "reset-context": [
                "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
            ],
        },
        failureModes: {
            "invalid persisted graph settings are normalized before consumers see them": [
                "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
            ],
            "save failure preserves the current in-memory snapshot plus error": [
                "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
            ],
        },
    },
};

/**
 * store 使用逻辑覆盖清单。
 */
export const storeConsumerCoverage = {
    "src/App.tsx": [
        "e2e/vault-switch-regression.e2e.ts",
        "e2e/custom-activity.e2e.ts",
    ],
    "src/host/settings/registerBuiltinSettings.ts": [
        "src/host/settings/registerBuiltinSettings.test.ts",
    ],
    "src/host/store/registrations/themeManagedStoreRegistration.ts": [
        "src/host/store/registerBuiltinManagedStores.test.ts",
        "src/host/store/storeRegistry.test.ts",
    ],
    "src/host/store/registrations/shortcutManagedStoreRegistration.ts": [
        "src/host/store/registerBuiltinManagedStores.test.ts",
        "src/host/store/storeRegistry.test.ts",
    ],
    "src/host/store/registrations/configManagedStoreRegistration.ts": [
        "src/host/store/registerBuiltinManagedStores.test.ts",
        "src/host/store/configStore.test.ts",
    ],
    "src/host/store/registrations/vaultManagedStoreRegistration.ts": [
        "src/host/store/registerBuiltinManagedStores.test.ts",
        "e2e/vault-switch-regression.e2e.ts",
    ],
    "src/plugins/vault-fs-sync/vaultFsSyncPlugin.ts": [
        "src/plugins/vault-fs-sync/vaultFsSyncPlugin.test.ts",
    ],
    "src/plugins/backlinks/backlinksPlugin.tsx": [
        "e2e/frontmatter-visibility.e2e.ts",
    ],
    "src/plugins/outline/outlinePlugin.tsx": [
        "e2e/frontmatter-visibility.e2e.ts",
    ],
    "src/host/window/useWindowEffectsSync.ts": [
        "src/host/window/useWindowEffectsSync.test.ts",
    ],
    "src/plugins/markdown-codemirror/settings/codeMirrorSettingsRegistrar.tsx": [
        "src/plugins/markdown-codemirror/settings/codeMirrorSettingsRegistrar.test.tsx",
    ],
    "src/plugins/file-tree/panel/VaultPanel.tsx": [
        "e2e/vault-switch-regression.e2e.ts",
    ],
    "src/host/commands/builtins/fileCommands.ts": [
        "src/host/commands/commandSystem.rename.test.ts",
        "src/host/commands/commandSystem.delete.test.ts",
    ],
    "src/host/commands/shortcutDispatcher.ts": [
        "src/host/commands/shortcutDispatcher.test.ts",
    ],
    "src/host/commands/systemShortcutSubsystem.ts": [
        "src/host/commands/shortcutDispatcher.test.ts",
    ],
    "src/host/layout/DockviewLayout.tsx": [
        "e2e/custom-activity.e2e.ts",
        "e2e/vault-switch-regression.e2e.ts",
    ],
    "src/plugins/knowledge-graph/knowledgeGraphPlugin.tsx": [
        "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
        "tests/knowledgeGraphInteractions.test.ts",
    ],
    "src/plugins/knowledge-graph/settings/graphSettingsRegistrar.tsx": [
        "src/plugins/knowledge-graph/settings/graphSettingsRegistrar.test.tsx",
    ],
    "src/plugins/knowledge-graph/tab/KnowledgeGraphTab.tsx": [
        "src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts",
        "tests/knowledgeGraphInteractions.test.ts",
    ],
    "src/plugins/calendar/CalendarView.tsx": [
        "e2e/calendar-convertible-view.e2e.ts",
    ],
    "src/plugins/custom-activity/CustomActivityModal.tsx": [
        "e2e/custom-activity.e2e.ts",
    ],
    "src/plugins/custom-activity/customActivityPlugin.tsx": [
        "e2e/custom-activity.e2e.ts",
    ],
    "src/plugins/ai-chat/aiChatPlugin.tsx": [
        "src/plugins/ai-chat/aiChatSettingsStore.test.ts",
    ],
    "src/host/settings/registrars/generalSettingsRegistrar.tsx": [
        "src/host/settings/registrars/builtinSettingsRegistrars.test.tsx",
    ],
    "src/host/settings/registrars/autoSaveSettingsRegistrar.tsx": [
        "src/host/settings/registrars/builtinSettingsRegistrars.test.tsx",
    ],
    "src/host/settings/registrars/themeSettingsRegistrar.tsx": [
        "src/host/settings/registrars/builtinSettingsRegistrars.test.tsx",
    ],
    "src/host/settings/registrars/shortcutSettingsRegistrar.tsx": [
        "src/host/settings/registrars/builtinSettingsRegistrars.test.tsx",
    ],
    "src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.tsx": [
        "src/plugins/markdown-codemirror/editor/lineNumbersModeExtension.test.ts",
        "e2e/frontmatter-visibility.e2e.ts",
    ],
    "src/plugins/search/searchPlugin.tsx": [
        "src/plugins/search/searchPlugin.test.ts",
    ],
};