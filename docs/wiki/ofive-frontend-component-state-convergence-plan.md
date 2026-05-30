---
title: "ofive Frontend Component State Convergence Plan"
kind: "governance-plan"
status: "active"
updated: "2026-05-30"
owners:
  - "frontend"
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "frontend"
  - "component"
  - "state"
  - "sync"
  - "testing"
concepts:
  - "Component State Owner"
  - "Frontend State Convergence"
  - "Frontend Backend Sync"
  - "Index Sync"
related:
  - "ofive-state-governance"
  - "ofive-component-glossary"
  - "ofive-content-source-of-truth"
  - "ofive-vault-and-query-index"
  - "ofive-testing-and-ci"
---

# ofive Frontend Component State Convergence Plan

This plan is the component-level execution map for [[ofive-state-governance|State Governance]]. It treats frontend components as consumers of owned state, not as owners of shared facts.

The inventory source is all non-test `src/**/*.tsx` files as of 2026-05-30. Registration-only plugin files are included because they mount panels, tabs, overlays, commands, and settings contributions that affect state lifetime.

## Target Model

State convergence has three layers:

1. Frontend canonical state feeds UI components.
2. Frontend canonical state syncs with backend filesystem state.
3. Backend filesystem state syncs with query and semantic indexes.

Component rules:

1. Shared UX facts must have one owner store or service.
2. Panel, activity, tab, and overlay mount lifecycle must not own long-lived facts.
3. Local component state is allowed only for ephemeral UI: input drafts, hover, dropdown open state, focus restoration, measured layout, temporary animation, or in-flight DOM handles.
4. Backend calls and event streams must go through `src/api/**`, App Event Bus bridges, plugin activation owners, or plugin-level hubs.
5. Read-oriented components should consume canonical Markdown snapshots for open documents and `persisted.content.updated` for persisted changes; backend index queries remain derived views.

## Canonical State Owners

| State class | Canonical owner | Component consumption rule | Required tests |
| --- | --- | --- | --- |
| Vault selection and tree | `src/host/vault/vaultStore.ts` plus mutation services | File tree, quick switcher, graph, calendar, editor, and settings consume snapshots; no component re-normalizes vault root or tree facts. | `vaultStore`/fs sync unit tests, vault switch E2E, mutation service tests. |
| Markdown editing content | `activeEditorStore`, `editorContextStore`, `persistedMarkdownContentSync`, `autoSaveService` | Editor owns dirty buffer, save boundary, view state, and external-update policy; derived panels read canonical snapshot first. | editor store tests, autosave tests, edit/read E2E, external update E2E. |
| Editor display and view state | `editorDisplayModeStore`, `editorViewStateStore`, CodeMirror owner | Tab remount, split, read/edit toggle, and sidebar changes must not drop scroll, cursor, folding, selection, or mode. | editor display/view-state unit tests, split/remount E2E. |
| Outline | `src/plugins/outline/outlineStore.ts` | `OutlinePanelPlugin` consumes outline snapshot; activity/sidebar switching must never trigger an unnecessary reload for the same source version. | outline store tests, outline reveal E2E, sidebar switch E2E. |
| AI chat runtime | `aiChatRuntimeStore`, AI stream event hub, backend session owner | `AiChatView` and `AiChatTab` are render surfaces; component remount must not stop stream/session. | runtime store tests, stream hub tests, AI chat remount/stream E2E, sidecar tests. |
| Settings | `configStore`, `themeStore`, `shortcutStore`, plugin-owned settings stores | Setting sections render registered schemas; save/rollback belongs to stores. | settings registrar tests, store-flow guard, unit tests. |
| Query/index views | backend query index, semantic index, plugin view stores when needed | Search, backlinks, graph, tasks, and semantic index treat index results as derived and stale-able. | Rust core query tests, semantic index tests, E2E after edit/rename/move/delete. |
| Workbench layout | `layout-v2` state plus ofive host projection stores | Sidebar icon changes, tab remounts, overlay open/close, and layout restore consume host projection; no plugin stores layout facts. | layout projection tests, activity/sidebar/tab E2E, layout-v2 CI. |

## Component Inventory And State Convergence

| Component file | Components | Surface | Current state dependencies | Convergence decision | Test anchor |
| --- | --- | --- | --- | --- | --- |
| `src/main.tsx` | bootstrap | bootstrap | plugin runtime bootstrap | Keep stateless; only start discovered plugins and render React. | `src/plugins/pluginRuntime.test.ts`, production build. |
| `src/App.tsx` | `App` | app shell | `configStore`, `themeStore`, `vaultStore`, `autoSaveService`, App Event Bus, `windowApi` | Keep as shell composer only; global side effects stay in host services/hooks. | `src/App.test.tsx`, `bun run build`. |
| `src/host/layout/WorkbenchLayoutHost.tsx` | `WorkbenchLayoutHost`, `LayoutV2WorkbenchHost`, `StableTabComponentWrapper` | host layout | shortcut, config, active editor, editor context, vault, activity bar, open-file service, App Event Bus, window API, local refs/state | Own host projection only; shared editor/vault/layout facts stay in owner stores. Local state limited to transient host UI and stable wrapper bookkeeping. | workbench/layout E2E, `src/host/layout/*.test.ts`, layout-v2 CI. |
| `src/host/layout/CreateEntryModal.tsx` | `CreateEntryModal` | host modal | props/local form only | Keep local because draft exists only while modal is open; mutation must go through caller-owned vault mutation service. | modal flow E2E via file tree/create tests. |
| `src/host/layout/MoveFileDirectoryModal.tsx` | `MoveFileDirectoryModal` | host modal | props/local form only | Keep local; move/rename fact belongs to vault mutation service and fs sync. | mutation service tests, move/rename E2E. |
| `src/host/layout/CustomTitlebar.tsx` | `CustomTitlebar` | host chrome | props only | Keep stateless; window actions stay behind `windowApi` callers. | titlebar/window smoke if changed. |
| `src/host/layout/SettingsTab.tsx` | `SettingsTab` | settings tab | settings registry snapshot | Keep as registry renderer; setting values belong to registered stores. | `src/host/layout/SettingsTab.test.tsx`, settings registrar tests. |
| `src/host/layout/WorkbenchHomeEmptyState.tsx` | `WorkbenchHomeEmptyState` | host empty state | props only | Keep stateless. | host render smoke. |
| `src/host/layout/sidebar/ActivityBar.tsx` | `ActivityBar` | sidebar | props only | Consume activity registry/host projection via parent; do not own selected activity. | activity/sidebar E2E. |
| `src/host/layout/sidebar/Sidebar.tsx` | `Sidebar` | sidebar | props only | Consume active sidebar and panel projection; no panel state ownership. | sidebar switch E2E. |
| `src/host/layout/sidebar/SidebarHeader.tsx` | `SidebarHeader` | sidebar | props only | Consume active panel metadata and registered actions. | sidebar header action tests. |
| `src/host/layout/sidebar/SidebarIconBar.tsx` | `SidebarIconBar` | sidebar | props only | Must switch icons without ungoverned panel fact reset; active activity belongs to host layout/activity store. | sidebar switch E2E covering outline and AI chat. |
| `src/host/layout/workbenchOverlayLayer.tsx` | `WorkbenchOverlayLayerProvider`, `WorkbenchOverlayPortal`, `OptionalWorkbenchOverlayPortal` | overlay host | overlay context | Keep overlay mount plumbing only; overlay state belongs to overlay registry/contribution. | overlay registry tests, command palette/quick switcher E2E. |
| `src/host/settings/SettingsRegisteredSection.tsx` | `SettingsRegisteredSection`, `RegisteredSettingsItem`, `RegisteredToggleItem`, `RegisteredSelectItem`, `RegisteredNumberItem` | settings | registered item props | Keep as pure settings renderer; store-owned actions handle persistence and rollback. | `src/host/settings/SettingsRegisteredSection.test.tsx`. |
| `src/host/settings/registrars/autoSaveSettingsRegistrar.tsx` | registration only | settings | `configStore` | Auto-save configuration belongs to `configStore`; registrar only contributes schema. | builtin settings registrar tests, config store tests. |
| `src/host/settings/registrars/frontmatterSettingsRegistrar.tsx` | `FrontmatterTemplateEditor` | settings/editor | `configStore`, local draft | Template value belongs to `configStore`; local textarea draft is allowed until commit. | frontmatter settings registrar tests. |
| `src/host/settings/registrars/generalSettingsRegistrar.tsx` | registration only | settings | `configStore` | Registrar only; no component-owned shared state. | builtin settings registrar tests. |
| `src/host/settings/registrars/languageSettingsRegistrar.tsx` | registration only | settings | registry only | Language value must remain store-backed when enabled; no local persistence. | builtin settings registrar tests. |
| `src/host/settings/registrars/shortcutSettingsRegistrar.tsx` | `ShortcutSettingsSection` | settings | `shortcutStore` | Shortcut edits belong to `shortcutStore`; local capture state may only track current key chord input. | shortcut store/dispatcher tests. |
| `src/host/settings/registrars/themeSettingsRegistrar.tsx` | `ThemeSettingsAdvancedItem`, `GlassSettingNumberRow` | settings/theme | `configStore`, `themeStore` | Theme mode belongs to `themeStore`; advanced values belong to `configStore`; local control state is not a second source. | theme/window effect tests, glass E2E. |
| `src/host/ui/UiPrimitives.tsx` | `UiButton`, `UiField`, `UiTextInput`, `UiTextArea`, `UiSelect`, `UiNumberInput`, `UiModal`, `UiDropdownMenu`, `UiDropdownMenuItem` | host UI primitives | local refs/state | Keep local and generic; primitives must not import business stores or APIs. | primitive tests only when behavior changes. |
| `src/plugins/agent-skills/AgentSkillsPanel.tsx` | `AgentSkillsPanel` | panel | `vaultApi` | If panel state becomes long-lived, add `agentSkillsStore`; current one-shot read state can stay local. Backend access remains through API wrapper. | panel E2E or API wrapper unit when changed. |
| `src/plugins/agent-skills/agentSkillsPlugin.tsx` | registration only | panel registration | panel registry | Keep registration-only. | plugin registration smoke. |
| `src/plugins/ai-chat/aiChatPlugin.tsx` | `AiChatView`, `AiChatTab`, `AiChatSettingsSection`, `AiChatToolCallGroupView`, `AiChatToolCallRecordView`, `AiChatToolCallRecordsView` | activity/panel/tab/settings | active editor, vault, open-file service, mutation service, AI runtime/settings stores, AI/project-reader/vault APIs, local refs/state | Runtime, messages, stream status, tool calls, confirmations, and backend session ids belong to `aiChatRuntimeStore` plus backend session owner. Component-local state is only input draft, scroll/focus affordances, and transient UI expansion. | `aiChatRuntimeStore.test.ts`, stream hub tests, `e2e/ai-chat-ux.e2e.ts`, sidecar tests. |
| `src/plugins/ai-chat/aiChatMessageMarkdown.tsx` | `AiChatMessageMarkdown` | renderer | props only | Keep pure renderer; no AI runtime ownership. | markdown render unit test. |
| `src/plugins/architecture-devtools/ArchitectureDevtoolsTab.tsx` | `ArchitectureDevtoolsTab`, `ArchitectureDagNode`, `InventorySection` | tab/devtool | local refs/state | Devtool UI state may stay local unless users expect persistence; architecture facts come from discovery code. | architecture discovery tests. |
| `src/plugins/architecture-devtools/ArchitectureDagEdgeCanvas.tsx` | `ArchitectureDagEdgeCanvasComponent` | renderer | props only | Keep pure drawing surface. | devtool visual smoke if changed. |
| `src/plugins/architecture-devtools/architectureDevtoolsPlugin.tsx` | registration only | activity/tab registration | registry only | Keep registration-only. | plugin registration tests. |
| `src/plugins/backlinks/backlinksPlugin.tsx` | `BacklinksPanel` | panel | `activeBacklinkTargetStore`, open-file service, App Event Bus, project-reader/vault APIs, local state | Target belongs to `activeBacklinkTargetStore`; backlink results come from backend query index, with canonical editor snapshot fallback for the active dirty document. Local state must only cover current request status and UI selection. | backlinks unit tests plus edit/rename/index E2E. |
| `src/plugins/calendar/CalendarPanel.tsx` | `CalendarPanel` | panel | props only | Keep navigation shell stateless; calendar date state should live in `CalendarView` or future calendar store if shared. | calendar panel E2E. |
| `src/plugins/calendar/CalendarTab.tsx` | `CalendarTab` | tab | open-file service | Keep tab wrapper stateless; actual date/note projection is in `CalendarView`. | calendar tab E2E. |
| `src/plugins/calendar/CalendarView.tsx` | `CalendarView` | calendar view | `vaultStore`, App Event Bus, `vaultApi`, local refs/state | Date cursor can stay local per view; note list derives from vault/content events. Add calendar store only if sidebar/tab must share cursor or cache. | calendar refresh E2E, persisted content event tests. |
| `src/plugins/calendar/calendarPlugin.tsx` | registration only | activity/panel/tab registration | registry only | Keep registration-only. | plugin registration tests. |
| `src/plugins/canvas/CanvasTab.tsx` | `CanvasTab`, `CanvasNodeRenderer` | canvas tab | open-file service, App Event Bus, `vaultApi`, local refs | Canvas document content belongs to persisted vault content and save service; viewport/selection may need a canvas view-state store if remount should preserve it. | canvas save/reload E2E, persisted content tests. |
| `src/plugins/canvas/CanvasMarkdown.tsx` | `CanvasMarkdown` | renderer | props only | Keep pure Markdown renderer. | canvas render tests if changed. |
| `src/plugins/canvas/canvasPlugin.tsx` | registration only | file opener/tab registration | open-file service | Keep registration-only; no content state. | opener tests. |
| `src/plugins/command-palette/overlay/CommandPaletteOverlay.tsx` | `CommandPaletteOverlay` | overlay | command registry props | Query input and highlighted row can stay local because overlay is transient; command registry owns commands. | command palette tests/E2E. |
| `src/plugins/command-palette/commandPalettePlugin.tsx` | registration only | overlay registration | registry only | Keep registration-only. | command registration tests. |
| `src/plugins/custom-activity/CustomActivityModal.tsx` | `CustomActivityModal` | modal | `configStore`, local refs/state | Custom activity list belongs to `configStore`; modal draft remains local until save. | custom activity config tests/E2E. |
| `src/plugins/custom-activity/customActivityPlugin.tsx` | registration only | activity/overlay registration | `configStore`, App Event Bus | Activation owner may subscribe to config changes and register activities; UI components must not duplicate custom activity state. | custom activity plugin tests. |
| `src/plugins/custom-activity/iconCatalog.tsx` | icon catalog | renderer | none | Keep static catalog. | no state tests needed. |
| `src/plugins/file-tree/panel/VaultPanel.tsx` | `VaultPanel` | panel | `configStore`, `editorContextStore`, open-file service, vault store/mutation service, App Event Bus, `vaultApi` | Tree facts belong to `vaultStore`; mutations to `vaultMutationService`; selection follows editor context. Expansion/inline rename draft may stay local unless persistence is required. | vault switch E2E, file tree mutation E2E, persisted guard tests. |
| `src/plugins/file-tree/panel/FileTree.tsx` | `FileTree`, `TreeItem` | tree renderer | local refs/state | Keep local only for expansion, drag hover, inline edit draft, and keyboard focus; file facts come from `VaultPanel`/`vaultStore`. | file tree interaction E2E. |
| `src/plugins/file-tree/fileTreePlugin.tsx` | registration only | activity/panel registration | vault mutation service, `vaultApi` | Keep registration and command owner; writes must stay behind mutation service. | mutation guard and file tree command tests. |
| `src/plugins/image-viewer/tab/ImageViewerTab.tsx` | `ImageViewerTab` | tab | `vaultApi` | Image blob/cache can stay local per tab; file identity belongs to tab params/vault. | image opener E2E. |
| `src/plugins/image-viewer/imageViewerOpenerPlugin.tsx` | registration only | file opener/tab registration | open-file service | Keep registration-only. | opener tests. |
| `src/plugins/knowledge-graph/tab/KnowledgeGraphTab.tsx` | `KnowledgeGraphTab`, `KnowledgeGraphColorQueryInput` | graph tab | open-file service, theme, vault, graph settings store, `vaultApi`, local refs/state | Graph data derives from backend query index; graph settings belong to `graphSettingsStore`; viewport/layout may stay local unless graph tab remount persistence is required. | graph settings tests, graph interaction tests, index E2E. |
| `src/plugins/knowledge-graph/settings/graphSettingsRegistrar.tsx` | `GraphSettingsSection`, `GraphSettingField` | graph settings | vault store, graph settings store | Settings belong to `graphSettingsStore`; field edit drafts are local until commit. | graph settings registrar tests. |
| `src/plugins/knowledge-graph/knowledgeGraphPlugin.tsx` | registration only | activity/tab registration | config store, store registry, graph settings store | Keep registration-only; plugin registers graph settings store. | managed store registration tests. |
| `src/plugins/log-notification/LogNotificationOverlay.tsx` | `LogNotificationOverlay` | overlay | `configStore` | Notification queue should be owned by log notification API/plugin hub; overlay only renders snapshot and user dismissal intent. | log notification tests. |
| `src/plugins/log-notification/logNotificationPlugin.tsx` | registration only | overlay registration | `logNotificationApi` | Activation owner may subscribe through API wrapper; no component-level backend listener. | log notification plugin tests. |
| `src/plugins/log-notification/logNotificationTestActivityPlugin.tsx` | registration only | dev/test activity registration | registry only | Keep isolated test activity. | existing test activity tests. |
| `src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.tsx` | `CodeMirrorEditorTab` | markdown editor tab | shortcut, config, active editor, editor context, display mode, open-file service, vault mutation/store, title rename service, App Event Bus, `vaultApi`, local refs | Editor content, dirty state, save lifecycle, display mode, and active context belong to host editor stores/services. Component refs hold CodeMirror DOM/runtime only. | editor unit tests, autosave tests, frontmatter/table/read-edit E2E. |
| `src/plugins/markdown-codemirror/editor/MarkdownReadView.tsx` | `MarkdownReadView`, `ReadModeFrontmatterPanel`, `ReadModeImageEmbed`, `ReadModeLatex`, `ReadModeMermaidDiagram`, `ReadModeWikiLinkAnchor` | read view | local refs/state, `vaultApi` | Read view consumes canonical Markdown content from editor tab. Image/diagram render cache may stay local. WikiLink open intent goes through open-file service. | read-mode E2E, render parity tests. |
| `src/plugins/markdown-codemirror/editor/CodeMirrorEditorPreviewMirror.tsx` | `CodeMirrorEditorPreviewMirror` | editor mirror | local state | Preview mirror follows editor view; no content source ownership. | preview mirror tests/E2E. |
| `src/plugins/markdown-codemirror/editor/components/FrontmatterYamlVisualEditor.tsx` | `FrontmatterYamlVisualEditor`, `FrontmatterInlineTextField` | editor subcomponent | local refs/state | Visual editor edits local row drafts, then commits to CodeMirror owner. It must not persist directly or fork markdown content. | frontmatter E2E and component tests. |
| `src/plugins/markdown-codemirror/editor/components/MarkdownTableVisualEditor.tsx` | `MarkdownTableVisualEditor` | editor subcomponent | local refs/state, `vaultApi` | Table visual state is a projection of CodeMirror document; commits go back through editor transaction. Local selection/focus only. | table editor unit/E2E, virtualization E2E. |
| `src/plugins/markdown-codemirror/editor/components/MarkdownTableCellLatex.tsx` | `TableCellLatex` | renderer | props only | Keep pure renderer. | table latex render tests if changed. |
| `src/plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkPreviewExtension.tsx` | `WikiLinkPreviewCard` | editor popover | `vaultApi` | Preview data may be request-local with cancellation; link resolution comes from vault/query API and must not own document content. | wikilink preview tests. |
| `src/plugins/markdown-codemirror/settings/codeMirrorSettingsRegistrar.tsx` | `CodeMirrorSettingsErrorItem` | editor settings | `configStore` | Editor settings belong to `configStore`; registrar only contributes schema and errors. | CodeMirror settings registrar tests. |
| `src/plugins/markdown-codemirror/codemirrorOpenerPlugin.tsx` | registration only | file opener/tab/settings registration | open-file service, `vaultApi` | Keep registration-only; editor state stays in editor stores. | opener tests, editor E2E. |
| `src/plugins/outline/outlinePlugin.tsx` | `OutlinePanelPlugin` | activity/panel | outline store, managed-store registration, App Event Bus, `vaultApi` | Outline facts belong to `outlineStore`. Panel mount, activity switch, and sidebar remount must consume existing snapshot and only refresh on source version/path change. | `outlineStore.test.ts`, `outlineManagedStoreRegistration.test.ts`, outline/sidebar E2E. |
| `src/plugins/project-reader/ProjectReaderPanel.tsx` | `ProjectReaderPanel` | panel | local state, `projectReaderApi` | If query/session should survive sidebar switch, introduce `projectReaderStore`; otherwise local request state is acceptable with stale-response cancellation. | project-reader E2E and API tests. |
| `src/plugins/project-reader/ProjectReaderCodeTab.tsx` | `ProjectReaderCodeTab` | tab | local ref, `projectReaderApi` | Code tab content is project-reader API result; local ref for scroll/focus only. Add tab view-state if users expect remount restore. | project-reader E2E. |
| `src/plugins/project-reader/ProjectReaderWikiLinkPreviewContent.tsx` | `ProjectReaderWikiLinkPreviewContent` | renderer | props only | Keep pure preview renderer. | preview tests if changed. |
| `src/plugins/project-reader/projectReaderPlugin.tsx` | registration only | panel/tab registration | registry only | Keep registration-only. | plugin registration tests. |
| `src/plugins/quick-switcher/overlay/QuickSwitcherOverlay.tsx` | `QuickSwitcherOverlay` | overlay | `configStore`, `vaultApi` | Overlay query/highlight can stay local; vault file list comes from `vaultStore` or API wrapper. Consider consuming `vaultStore` snapshot to avoid duplicate backend reads. | quick switcher tests/E2E. |
| `src/plugins/quick-switcher/quickSwitcherPlugin.tsx` | registration only | overlay registration | registry only | Keep registration-only. | quick switcher plugin tests. |
| `src/plugins/search/searchPlugin.tsx` | `SearchPanel` | activity/panel | `configStore`, local refs/state, `vaultApi` | Search query and results should move to a `searchStore` if they must survive sidebar switch; backend index remains owner of persisted search results. Always use request ids to discard stale responses. | search unit tests, edit/index E2E. |
| `src/plugins/semantic-index/semanticIndexPlugin.tsx` | `SemanticIndexSettingsSection` | settings/index control | vault store, `semanticIndexApi`, local refs/state | Semantic indexing status belongs to backend/semantic index API. Add a frontend status store if multiple components render it. | semantic index plugin tests, sidecar/semantic index CI. |
| `src/plugins/tasks/task-board/TaskBoardTab.tsx` | `TaskBoardTab` | task tab | editor context store, open-file service, App Event Bus, `vaultApi`, `localStorage` | Task facts derive from backend/query index plus canonical open-editor snapshots. Replace direct `localStorage` persistence with a governed store if board preferences must persist. | task board E2E, index sync E2E, localStorage guard. |
| `src/plugins/tasks/taskBoardPlugin.tsx` | registration only | activity/tab registration | registry only | Keep registration-only. | task board plugin tests. |

## High-Risk State Convergence Workstreams

1. Editor and read view continuity.
   - Ensure `CodeMirrorEditorTab`, `MarkdownReadView`, frontmatter editor, table editor, preview mirror, outline, backlinks, task board, and AI context all consume the same canonical open-document snapshot.
   - Add E2E for edit/read toggle, split editor, sidebar switch, tab remount, external update while dirty, and rename while open.

2. Sidebar and panel remount resilience.
   - Make sidebar icons pure selectors of activity/panel projection.
   - Keep `OutlinePanelPlugin` and `AiChatView` as render consumers, not runtime owners.
   - Add E2E that starts AI stream, switches through file tree/search/outline/settings, returns to AI, and verifies stream/session continuity.
   - Add E2E that opens outline, switches activities repeatedly, and verifies no same-version reload.

3. Frontend/backend filesystem sync.
   - Keep all Markdown saves behind `persistedMarkdownContentSync` and all rename/move/delete/create behind `vaultMutationService`.
   - Require `sourceTraceId` for local writes and assert self-triggered watcher events cannot overwrite editor buffers.
   - Add tests for autosave plus external update, rename open file, move folder with open descendants, delete active file, and vault switch during in-flight read.

4. Backend index sync for derived views.
   - Search, backlinks, graph, tasks, frontmatter queries, project reader, and semantic index must treat query results as derived and refreshable.
   - Add Rust core tests for save/rename/move/delete/external-update index invalidation.
   - Add E2E that edits a note and verifies search/backlinks/graph/tasks observe the update after stable query refresh.

5. Settings and plugin registration convergence.
   - Every plugin-owned long-lived state must register a managed store with schema, flows, actions, and failure modes.
   - Registrars stay declarative and must not own setting persistence.
   - Add/extend guard coverage so new settings contributions require tests.

6. Local state audit.
   - Keep local state for modal drafts, overlay query text, hover/focus/drag state, DOM refs, and temporary request spinners.
   - Escalate local state to a store when it crosses component lifecycle, tab lifecycle, vault lifecycle, backend event lifecycle, or user-visible session continuity.

## Guard And Test Plan

| Gate | Purpose | Current or planned enforcement |
| --- | --- | --- |
| Component inventory guard | Detect new `tsx` components and require state owner classification. | Add a script that regenerates this inventory and fails when a component lacks a convergence row. |
| Store-flow coverage guard | Ensure managed stores have schema, actions, flow, and failure-mode tests. | Existing `scripts/check-store-state-tests.mjs` and `scripts/store-state-flow-coverage.config.mjs`; extend for new stores. |
| Persisted-content guard | Block raw save/rename/move/delete paths outside owner services. | Existing `scripts/check-persisted-content-guards.mjs`; extend for new content APIs. |
| Event-subscription guard | Block UI components from directly subscribing to backend events/streams. | Existing event subscription guard; extend allowlist only for API wrappers, app event bridges, activation owners, and plugin hubs. |
| Local persistence guard | Block `localStorage`/`sessionStorage` in business components unless registered as governed local device state. | Add scan, initially flagging `TaskBoardTab` for migration or explicit exception. |
| Backend index sync tests | Prove filesystem and query/semantic indexes stay consistent. | Rust core query tests, semantic index tests, and E2E for edit/rename/move/delete. |
| Remount resilience E2E | Prove component mount/unmount never owns sessions or derived document state. | Add sidebar switch tests for AI chat, outline, search, file tree, graph, and task board. |

## Execution Order

1. Freeze the inventory.
   - Add the component inventory guard.
   - Require every new `tsx` component to declare state owner, local-state rationale, and test anchor.

2. Close the critical UX gaps.
   - AI chat stream/session remount.
   - Outline same-source reload prevention.
   - Editor read/edit/split/sidebar continuity.
   - File tree mutations with open editor tabs.

3. Normalize derived views.
   - Move long-lived search/project-reader/task-board state into stores where continuity is user-visible.
   - Add canonical open-editor snapshot fallback for active-document derived views.
   - Add stale-response/request-id handling where backend queries race.

4. Harden frontend/backend sync.
   - Expand `sourceTraceId` tests.
   - Add concurrent autosave/external change tests.
   - Add rename/move/delete tests that cover editor, outline, search, backlinks, graph, and task board.

5. Harden backend index sync.
   - Add Rust tests for query index invalidation and rebuild.
   - Add semantic index status tests for reindex, cancel, error, and vault switch.
   - Add E2E smoke for derived views after content mutation.

6. Make CI the release gate.
   - Required local gate: `bun run check:guards`, `bunx tsc --noEmit --pretty false`, `bun run test:ci:unit`, `bun run test:e2e:ci --reporter=line`, `bun run build`, Rust core/sidecar, Go sidecar as touched.
   - Required GitHub gate: frontend unit, production build, Playwright E2E, Rust core, Rust sidecar, Go sidecar all green.

## Acceptance Criteria

The convergence is complete when:

1. Every component in the inventory has a declared state owner and test anchor.
2. Sidebar activity switching cannot interrupt AI chat streams or reload same-version outline data.
3. Editor content, read view, outline, backlinks, tasks, graph, and search agree on active-document content.
4. Local writes cannot loop back through watcher events and overwrite frontend state.
5. External changes produce explicit refresh/merge/conflict behavior instead of silent overwrite.
6. Backend query and semantic indexes recover after save, rename, move, delete, external update, and vault switch.
7. Guard scans block new unowned components, raw persisted mutations, direct backend subscriptions in UI components, and ungoverned local persistence.
8. Full local tests and GitHub CI pass before release.
