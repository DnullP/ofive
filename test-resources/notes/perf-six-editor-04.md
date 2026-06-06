---
title: Split Resize Journal 04
tags: [perf, frontmatter]
---

# Split Resize Journal 04

Hot line with [[note1]], [[guide|Guide Alias]], [local diagnostics](https://example.test/local), and inline math $\lambda = h / p$.

$$
\det(A - \lambda I) = 0
$$

| Pane | Content | During Drag | After Drag |
| --- | --- | --- | --- |
| Top left | frontmatter | stable widget | editable again |
| Middle left | table | reflow | no distortion |

The user experience target is straightforward: split resizing should feel continuous for ordinary reading and editing layouts. If each editor schedules expensive work on every container tick, the combined cost can push the app toward a visible 30fps feel.

Every editor in the grid should report a width range during the drag. If all six change but the frame budget fails, the bottleneck is in shared reflow or editor widget work.

## Resize Notes 04

- Frontmatter rows should stay mounted and keep their reserved height.
- Source expansion should not make surrounding content jump while the split is moving.
- The editor should keep real layout at each intermediate width.

> A compact quote keeps blockquote styling in the visible document without becoming the main performance cost.

This pane focuses on frontmatter because metadata widgets often contain controls, icons, focus rings, and hover states. Those details matter while editing the widget, but they should not dominate split resizing in neighboring panes.

The resize path should preserve the user's mental map. Tables stay tables, formulas stay formulas, and markdown text wraps according to the pane width instead of snapping into place after release.

The article body also exercises normal paragraphs. A realistic editor surface is mostly prose, with rich widgets embedded at meaningful intervals, so this sample follows that shape.

This sentence includes [[note2]] and `active-tab-group` to keep link and inline code spans in the flow. The renderer should not need to recompute unrelated UI chrome for those spans during every pointer move.

If Tauri WebKit feels slower than Chromium, this scenario gives us a stable way to compare the same DOM contract across environments instead of relying on subjective drag feel alone.

The note continues for a few more lines so wrapping, scrolling, and height-map behavior are present even though the top hot widgets remain easy to assert.

The last paragraph confirms that the editor is still an ordinary markdown document fixture, not a bespoke performance-only component.
