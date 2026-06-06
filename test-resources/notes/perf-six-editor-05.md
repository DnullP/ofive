---
title: Split Resize Journal 05
tags: [perf, obeditor]
---

# Split Resize Journal 05

Hot line with [[note2]], [[task-board-e2e]], [grid report](https://example.test/grid), and inline math $f'(x) = \lim_{h \to 0}(f(x+h)-f(x))/h$.

$$
\begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix}
$$

| Layer | Responsibility | Resize Work | Guard |
| --- | --- | --- | --- |
| Layout | flex slots | width assignment | no React loop |
| Editor | viewport | measure lines | batched reads |

The fifth editor ensures matrix rendering and table layout are present in the same pane. In a split layout this content should stay readable while the surrounding column changes size.

This diagnostic uses the real ofive workbench, persisted layout hydration, mock vault file reads, and active markdown tabs so the result stays close to the path users hit after splitting articles.

## Resize Notes 05

- Matrix LaTeX and table widgets should not add a visible resize hitch.
- Non-active editor cursors can be hidden while selection layers remain available.
- Gutter width synchronization should be deferred during layout lightweight mode.

> This quote belongs after the primary table and should remain below it while table row heights reflow.

The fifth note mirrors a common working setup: several related documents open side by side, each with a small amount of structure near the top and prose filling the rest of the page.

The important part is not just maximum throughput. The user should be able to drag a split edge and trust that every pane is reflecting the current size, without sessions restarting or editor state being replaced.

This paragraph includes [[task-board-e2e|Task Board Fixture]] and inline code `ResizeObserver`. It makes the prose more representative of technical notes that mix links, code, and rendered markdown.

During the drag, lightweight styling should remove shadows, filters, handle chrome, and repeated large backgrounds. It should not remove the text, table, formula, or selected ranges the user cares about.

The active editor keeps the full editing affordances that matter. Other visible editors keep readable content and geometry, which is enough for resize feedback and avoids unnecessary paint work.

Additional body text keeps the document from being a two-widget toy case. It is long enough to exercise CodeMirror's normal viewport model while remaining stable for CI.

The final line anchors the sample: six panes, six markdown editors, real widths, no transform stretching, no component remount surprises.
