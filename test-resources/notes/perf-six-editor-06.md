---
title: Split Resize Journal 06
tags: [perf, article]
---

# Split Resize Journal 06

Hot line with [[guide]], [[latex|Latex Fixture]], [six editor diagnostics](https://example.test/six-editors), and inline math $\phi = (1 + \sqrt{5}) / 2$.

$$
\lim_{n \to \infty}\left(1 + \frac{1}{n}\right)^n = e
$$

| Check | Expected | Why It Matters | Regression |
| --- | --- | --- | --- |
| Editors | six visible | split workflow | hidden pane |
| Tables | six widgets | heavy plugin path | overdraw |

The sixth pane gives the right column the same workload as the left column. Dragging the divider between the two columns should make all six editors resize at once, which is useful when comparing browser and Tauri WebKit behavior.

The goal is not fake smoothness from bitmap stretching. Text, table, and formula should be laid out at the current width from pointer down through release.

## Resize Notes 06

- The right column carries the same markdown feature mix as the left column.
- All six editors should update width in the same continuous drag.
- The frame sampler should stay near idle even when rich widgets are visible.

> The final quote keeps quote rendering represented in the lower-right pane.

This note closes the six-pane fixture with an article body that behaves like normal daily writing. There is enough text to wrap, but the first viewport still contains frontmatter, title, wikilinks, formula, and a table.

When the shared divider moves, every editor receives a new container width. A good implementation lets CSS and CodeMirror reflow the document while avoiding unrelated state writes and visual effects.

This paragraph references [[network-segment|Network Segment]] again and includes `cm-selectionLayer` so the regression contract is obvious in the document itself. Selection feedback must not disappear as a side effect of performance work.

A split resize should also avoid hidden concurrency bugs. AI chat sessions, outline data, and editor snapshots live outside the visual component tree, so UI refreshes should not reset the user workflow.

The right-bottom pane is useful because it often shares the smallest visible area after a split. If that pane can keep text and widgets readable, the layout is much closer to production use.

The article continues just enough to exercise the editor height map and scrolling behavior, while leaving the fixture deterministic and quick enough for repeated trace runs.

The closing paragraph repeats the core expectation: real reflow, mounted components, preserved selection layers, and resize cost low enough to feel like 60fps on capable hardware.
