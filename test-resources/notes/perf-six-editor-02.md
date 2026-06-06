---
title: Split Resize Journal 02
tags: [perf, table]
---

# Split Resize Journal 02

Hot line with [[guide]], [[task-board-e2e|Task Board Fixture]], [diagnostics](https://example.test/diagnostics), and inline math $a^2 + b^2 = c^2$.

$$
\sum_{i=1}^{n} i = \frac{n(n + 1)}{2}
$$

| Component | Visible State | Resize Expectation | Notes |
| --- | --- | --- | --- |
| Heading | rendered line | wrap normally | no repaint burst |
| Link | wikilink span | stay mounted | capability injected |

The second editor uses the same compact hot zone so all six panes expose the same expensive surfaces while the shared divider moves. It catches cases where a single editor feels fine but synchronized CodeMirror and plugin work becomes visible at split scale.

The layout should report real `dom-flex` resizing, keep content mounted, and avoid transforms that would only stretch a stale visual surface.

## Resize Notes 02

- Non-active panes keep their text and selection layers mounted during drag.
- Expensive hover chrome can be quiet while the divider is moving.
- The article body should remain a normal markdown document, not a special preview.

> A second blockquote gives the fixture another block style that must stay below its preceding table.

This note adds enough prose to make the middle-left pane behave like an article editor. The visual weight is still concentrated near the top so frontmatter, heading, wikilinks, formula, and table all mount before sampling starts.

When six editors resize together, the expensive part is not one line wrapping. It is all the small reads, paints, and layer updates that repeat in lockstep across the workbench.

The active pane should feel complete to the user. Neighboring panes can drop cursor chrome, table handles, and gutter paint during the short drag, provided the content geometry and selection contract remain intact.

This line includes [[network-segment]] and inline code `layout-lightweight` so link and code spans continue to participate in text flow. The goal is stable document layout, not frozen screenshots.

A user reading notes while the AI chat or outline is open should not notice a component lifecycle reset just because a split edge moved. Editor state lives above the visual components, and this fixture guards that assumption.

The trailing paragraphs are intentionally repetitive in shape. That makes regression diffs easier to reason about while still creating a realistic number of wrapped visual lines.

The resize path should be able to finish without long tasks, without a 30fps plateau, and without restoring layout by snapping after pointerup.
