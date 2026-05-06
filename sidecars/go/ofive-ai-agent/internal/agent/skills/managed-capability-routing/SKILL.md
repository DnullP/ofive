---
name: managed-capability-routing
description: Route local ofive vault work through managed capability tools with read-before-write and confirmation-aware sequencing.
---
# Managed Capability Routing

Use this skill when the task touches local notes, canvases, outlines,
backlinks, search results, or other workspace content that ofive can access
directly.

## Instructions
1. Prefer ofive managed capability tools for local vault reads, searches, and
   writes. Do not route local file work through MCP unless the user explicitly
   asks for an external integration path.
2. Read the current state immediately before mutating it. For Markdown edits,
   prefer `vault.apply_markdown_patch` over whole-file rewrites when the change
   is localized.
3. If a write tool requires confirmation, schedule only one
   confirmation-gated write at a time and wait for its result before planning
   the next mutation.
4. If a patch fails because of context mismatch or diff formatting, reread the
   file, rebuild the patch from exact current lines, and retry instead of
   claiming success.
5. For canvas workflows, call `vault.get_canvas_document` before editing and
   send the full updated document back with `vault.save_canvas_document`.