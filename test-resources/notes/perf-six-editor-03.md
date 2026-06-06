---
title: Split Resize Journal 03
tags: [perf, latex]
---

# Split Resize Journal 03

Hot line with [[latex]], [[network-segment|Network Segment]], [profile notes](https://example.test/profile), and inline math $\nabla \cdot E = \rho / \epsilon_0$.

$$
\frac{\partial u}{\partial t} = \alpha \nabla^2 u
$$

| Signal | Sampled By | Healthy Pattern | Failure Smell |
| --- | --- | --- | --- |
| Width | DOM rect | many distinct widths | stuck pane |
| Frame | rAF sampler | p95 near budget | 30fps plateau |

The multi-editor scenario makes a different class of problems visible. Single editor resize can pass while shared parent resize still causes synchronized work across every active editor.

The lower text adds realistic wrapping and preserves a normal scroll body. The editor should not lose active card containment while layout lightweight mode is set.

## Resize Notes 03

- Formula blocks should remain visible and measured at the current width.
- Header, list, and inline syntax renderers should avoid decorative repaint work during drag.
- Scroll state should not reset when neighboring panes update.

> The quote below the first table protects the spacing relationship between block widgets and ordinary markdown blocks.

This pane is a reminder that the resize problem is cumulative. One formula block or one table is cheap enough; six synchronized editors make every unnecessary observer callback and visual effect much more expensive.

The markdown body deliberately contains wrapped prose. If the right column becomes narrow, these sentences should occupy more visual lines while the editor keeps its viewport and selection model consistent.

The implementation should prefer batched reads and deferred decoration sync. Layout can change every frame, but nonessential editor chrome does not need to repaint on every frame.

This paragraph mentions [[latex|Latex Fixture]] again and includes inline math $\alpha + \beta = \gamma$ so inline plugin rendering remains present beyond the first hot line.

The active tab group marker lets ofive distinguish the editor the user is actually working in from neighboring panes. That gives us a safe place to reduce non-active decoration without changing document content.

Any optimization that hides selected text, collapses gutters with `display: none`, or swaps a real editor for a stretched compositor preview would fail the purpose of this fixture.

The final body paragraph keeps the note long enough that CodeMirror maintains a meaningful height map while the split divider moves.
