---
title: "Obsidian Alignment Iteration Plan"
kind: "workflow"
status: "active"
updated: "2026-05-28"
owners:
  - "frontend"
tags:
  - "ofive"
  - "obsidian-alignment"
  - "workbench"
  - "frontend"
related:
  - "wiki/ofive-workbench.md"
  - "wiki/ofive-layout-restoration.md"
  - "testing-handbook.md"
---

# Obsidian Alignment Iteration Plan

This plan records the real-app comparison between `/Applications/ofive-dev.app` and Obsidian 1.12.7 on the same `Notes` vault. The goal is not to clone Obsidian feature-for-feature, but to make ofive feel equally fast, dense, calm, and native while keeping ofive's AI, task, graph, and project-reader advantages.

## Validation Baseline

Default validation for this plan is real Tauri operation:

```bash
bun run tauri dev
```

Use the real Tauri window for user-visible behavior, layout, editor, sidebar, tab, drag, focus, vault, and native-shell checks. Mock-web may be used only as auxiliary isolation or regression coverage.

When comparing packaged builds, use:

```text
/Applications/ofive-dev.app
```

Do not use stale release bundles under `src-tauri/target/**/bundle/macos/ofive.app`.

## Observed Baseline

- ofive opened `/Users/kaiqiu/Documents/Notes`, restored `HomePage.md`, and indexed 1593 Markdown notes.
- Opening `HomePage.md` showed a visible `Preparing content` phase before the editor became usable.
- ofive search for `cache` returned 80 results quickly, but each row carries path, tags, snippet, labels, and counts in a crowded layout.
- Obsidian search for `cache` returned 256 results grouped by file, with local hit snippets and highlighted matches, making scanning easier despite more results.
- ofive right panels exist for AI, outline, backlinks, and calendar. Empty backlinks currently read more like status text than a contextual panel.
- ofive settings are usable and structured, but they occupy the main tab like a full application page.
- ofive task board is a strong differentiator, but its current page-level presentation feels separate from the note workspace.

## P0: Interaction Feel And Loading Baseline

Target: remove obvious waiting seams and stabilize workspace restoration.

- Remove or soften full-page `Preparing content` for Markdown tabs.
- Prefer immediate editor presentation with internal stabilization over a blocking placeholder.
- Preserve workspace restore, tab restore, focus restore, and scroll restore behavior.
- Validate with a real Tauri window by opening notes with frontmatter and switching tabs.

Primary owners:

- `src/host/layout/WorkbenchLayoutHost.tsx`
- `src/host/layout/workspaceLayoutPersistence.ts`
- `src/plugins/markdown-codemirror/codemirrorOpenerPlugin.tsx`
- `src/plugins/markdown-codemirror/editor/**`

## P1: Obsidian-Like Workbench Shell

Target: make the shell feel compact, calm, and durable for all-day note work.

- Tighten activity rail, sidebar headers, icon affordances, tab strip, and empty-tab state.
- Reduce landing-page-like home copy and make empty state closer to a command surface.
- Make settings feel quick to enter and leave, not like a separate app mode.

Primary owners:

- `src/host/layout/WorkbenchLayoutHost.tsx`
- `src/host/layout/sidebar/**`
- `src/host/layout/SettingsTab.tsx`
- `src/host/layout/WorkbenchHomeEmptyState.tsx`

## P2: File Tree And Search Density

Target: keep ofive's richer index while making result scanning as easy as Obsidian.

- Group search results by file by default.
- Highlight local matches and collapse long path/tag metadata.
- Add tighter keyboard navigation and predictable result opening.
- Keep filter controls visible without making every row visually busy.

Primary owners:

- `src/plugins/file-tree/**`
- `src/plugins/search/searchPlugin.tsx`
- `src/plugins/search/searchPlugin.css`

## P3: Editor And Properties Polish

Target: make editing and reading feel native, immediate, and stable.

- Continue improving Live Preview parity.
- Tighten frontmatter/property row density.
- Verify cursor, focus, scroll, title rename, and mode-switch restoration in real Tauri.
- Keep tag chips readable without taking over the page.

Primary owners:

- `src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.tsx`
- `src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.css`
- `src/plugins/markdown-codemirror/editor/components/FrontmatterYamlVisualEditor.tsx`
- `src/plugins/markdown-codemirror/editor/components/FrontmatterYamlVisualEditor.css`

## P4: Context-First Right Panels

Target: make the right sidebar describe the current note before advertising features.

- Prioritize outline, outlinks, backlinks, local graph, and properties around the focused note.
- Make empty states compact and contextual.
- Reduce AI panel dominance when AI is not configured or not actively requested.

Primary owners:

- `src/plugins/backlinks/**`
- `src/plugins/outline/**`
- `src/plugins/knowledge-graph/**`
- AI panel ownership under the current AI plugin/module paths.

## P5: Differentiators As Native Extensions

Target: make AI, task board, graph, and project-reader feel like natural extensions of notes.

- Bind task board views to current file/project context when possible.
- Make graph exploration fast and unobtrusive.
- Keep AI contextual and opt-in, with clear inactive states.
- Validate task and graph workflows against real vault data.

Primary owners:

- `src/plugins/tasks/**`
- `src/plugins/knowledge-graph/**`
- `src/plugins/project-reader/**`
- AI plugin/module paths.

## Delivery Notes

Every phase should end with:

- A real Tauri validation path.
- A focused automated check when practical.
- A short before/after note covering interaction feel, not only functional correctness.

## Iteration Log

### 2026-05-28 - P2 Search Grouping By File

Completed:

- Grouped search results by `relativePath` so one file now renders as one compact header with collapsible hit rows.
- Defaulted the first matching file group to expanded and kept other groups collapsed to reduce repeated path/tag noise on first scan.
- Moved file-level path, match badges, and tag summary into the group header while leaving per-hit snippet rows focused on local context only.
- Added focused unit coverage for result grouping and initial expanded-state behavior.

Files touched:

- `src/plugins/search/searchPlugin.tsx`
- `src/plugins/search/searchPlugin.css`
- `src/plugins/search/searchPlugin.test.ts`
- `src/i18n/locales/en.ts`
- `src/i18n/locales/zh.ts`

Validation path:

- Intended real-app path: `bun run tauri dev` and verify Search panel behavior against the same vault used in Obsidian.
- Intended browser isolation path: `http://127.0.0.1:1420/web-mock/mock-tauri-test.html?showControls=0`
- This iteration could not complete runtime validation because the worktree currently has no local `node_modules` install, so React resolution fails before the search panel can be exercised.

Commands run:

```bash
git status --short
git branch --show-current
sed -n '1,260p' /Users/kaiqiu/Documents/projects/rust/tauris/ofive/docs/obsidian-alignment-iteration-plan.md
sed -n '1,520p' src/plugins/search/searchPlugin.tsx
sed -n '1,260p' src/plugins/search/searchPlugin.css
sed -n '1,260p' src/plugins/search/searchPlugin.test.ts
bun test src/plugins/search/searchPlugin.test.ts
TMPDIR=/private/tmp bun test src/plugins/search/searchPlugin.test.ts
bunx tsc --noEmit
TMPDIR=/private/tmp bunx tsc --noEmit
```

Command outcomes:

- `bun test src/plugins/search/searchPlugin.test.ts`: blocked by missing package resolution for `react`.
- `bunx tsc --noEmit`: blocked by Bun tempdir access in this environment before TypeScript completed.
- No Tauri or Browser validation was run to completion in this iteration.

Before/after interaction note:

- Before: every hit repeated title, path, badges, tags, and snippet in a flat list, making dense queries feel noisy even with fewer results than Obsidian.
- After: the result list scans by file first, then by local hit, which is closer to Obsidian's grouped reading flow while preserving ofive's richer metadata.

Remaining risks:

- Expand/collapse affordance and keyboard behavior still need runtime verification in real Tauri and mock-web.
- Group ordering currently follows backend result order; if backend interleaves files oddly, a later pass may want explicit file-level ranking.
- File-level matches without snippets now show a compact fallback row, but the wording and spacing still need visual confirmation against real vault data.

Next recommended item:

- Continue P2 with keyboard navigation and predictable open behavior for grouped search results, then validate in real Tauri with an intermediate collapsed/expanded state check.
