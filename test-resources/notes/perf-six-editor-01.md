---
title: Split Resize Journal 01
tags: [perf, split]
---

# Split Resize Journal 01

Hot line with [[guide|Guide Alias]], [[network-segment]], [mock vault](https://example.test/mock-vault), and inline math $E = mc^2$.

$$
\int_0^1 x^2 dx = \frac{1}{3}
$$

| Area | Owner | Resize Signal | Risk |
| --- | --- | --- | --- |
| Frontmatter | Editor state | width and height | jumpy handoff |
| Table | Obeditor plugin | column reflow | overflow |

The first editor keeps frontmatter, title, links, table, block formula, and prose in the initial viewport so a six-pane split resize measures real editor reflow. The remaining paragraphs make the document feel like a normal article without hiding the hot widgets below the fold.

Resize should not interrupt selection layers, plugin widgets, or scroll state. When several editors are visible, every instance receives container changes, so redundant observers and layout reads become much easier to spot.

## Resize Notes 01

- File tree, editor, and AI chat should stay responsive while this pane reflows.
- The active editor keeps selection feedback; neighboring editors keep stable geometry.
- The table above should re-layout from markdown structure instead of being bitmap stretched.

> A quoted checkpoint remains in the document so blockquote painting participates in the resize sample without covering the table.

The rest of this note is deliberate article body. It gives CodeMirror a realistic height map, several wrapped lines, and enough ordinary prose that resize performance is not only measured against a tiny synthetic fixture.

When the column narrows, this paragraph wraps across more visual lines. That is the behavior we want: real text layout at the current pane width, with resize work kept cheap enough that six panes can update together.

The editor should avoid per-frame work that is unrelated to the current pointer movement. Gutter compensation, hover affordances, and decorative shadows can wait until the drag ends, while content and selection remain faithful.

Frontmatter, headings, wikilinks, LaTeX, tables, lists, blockquotes, and plain paragraphs are intentionally mixed here. Each surface is small on its own, but synchronized across six editors it can expose hidden layout and paint costs.

This paragraph references [[guide]] again so the wikilink renderer is not limited to a single line. It also includes inline code like `dom-flex` and `requestAnimationFrame` to keep inline styling in the hot path.

Resize diagnostics should be boring after the fix: widths change every frame, no editor vanishes, no transform stretches stale content, and the frame sampler remains close to the idle baseline.

The final paragraph makes the document long enough to exercise ordinary scrolling state without pushing all rich widgets out of the initial viewport.
