# @ofive/editor

`@ofive/editor` is the standalone frontend editor project extracted from ofive. Its goal is to make the editor a reusable implementation with explicit host and plugin contracts.

## Layers

1. `EditorService`
   - Owns the canonical document snapshot, dirty state, mode, status, commands, plugin lifecycle, and subscribers.
   - Does not know about vaults, filesystems, tabs, workbench panels, or Tauri.

2. `EditorHostAdapter`
   - Lets a host provide `loadDocument`, `saveDocument`, `resolveLink`, logging, and lifecycle callbacks.
   - ofive maps this adapter to vault read/write, persisted content sync, active editor store, editor context store, and display mode store.

3. `EditorPlugin`
   - Lets feature plugins contribute commands and CodeMirror extensions.
   - The default Markdown plugin contributes formatting and link-open commands.

4. React surfaces
   - `UniversalMarkdownEditor` renders toolbar, CodeMirror edit mode, read mode, and split mode.
   - The surface consumes an `EditorService`; it does not own shared editor facts.

## ofive Integration

ofive should create an editor service through:

```ts
import { createDefaultOfiveEditorService } from "../../host/editor/ofiveEditorService";

const service = createDefaultOfiveEditorService({
  articleId: tabApi.id,
  path: params.path,
  content: params.content,
  containerApi,
});
```

The ofive adapter currently maps:

- `readMarkdown` -> `readVaultMarkdownFile`
- `saveMarkdown` -> `savePersistedMarkdownContent`
- focus/content reports -> `editorContextStore`
- active editor reports -> `activeEditorStore`
- mode changes -> `editorDisplayModeStore`

## Scripts

From ofive root:

```bash
bun run editor:test
bun run editor:build
bun run editor:dev
```

From this package:

```bash
bun run test
bun run build
bun run dev
```

## Migration Path

1. Keep the existing ofive `CodeMirrorEditorTab` as the product surface while this package stabilizes.
2. Route shared document content, focus, and display mode through `createDefaultOfiveEditorService`.
3. Move host-independent CodeMirror extensions and Markdown renderers behind `EditorPlugin`.
4. Let read-only consumers consume editor snapshots from the ofive adapter instead of component mount state.
