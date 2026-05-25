---
title: "ofive Workbench Section Resize Performance"
kind: "handoff"
status: "active"
updated: "2026-05-26"
owners:
  - "frontend"
tags:
  - "ofive"
  - "workbench"
  - "performance"
  - "e2e"
concepts:
  - "真实重绘"
  - "section resize"
  - "performance smoke"
related:
  - "ofive-workbench"
  - "ofive-calendar"
  - "ofive-performance-smoke"
  - "ofive-testing-and-ci"
---

# ofive Workbench Section Resize Performance

本轮性能修复目标是让用户拖动 section 边界时，内部 editor、calendar、task board 等真实内容持续平滑重绘。禁止使用内容层 `scaleX` / `scaleY` 之类的视觉拉伸预览，因为它会产生果冻感，虽然可能降低 raster 指标，但不符合真实画面变化要求。

## 当前结论

1. 真正有效的主路径是 layout-v2 的 `dom-flex` resize：拖动中直接更新相邻 `.layout-v2__child-slot` 的真实 flex 尺寸，pointerup 后再提交布局状态。
2. 本轮进一步把拖动中的 DOM flex 写入从比例值改成像素级 `flex-basis`，因为拖动开始时父容器尺寸已固定，可减少浏览器每帧的 flex 百分比分配成本。
3. 日历 tab 的 6 周月历网格应使用固定 6 行 `grid-template-rows: repeat(6, var(--calendar-day-min-height))`，避免 resize 时日期内容反复参与 `auto` 行高回算。
4. 性能测试中的 placeholder 必须保持轻量。不要用 Architecture Devtools 作为对照组，否则 DAG、渐变和 canvas 会污染 calendar/task 的增量判断。
5. Workbench overlay portal 的全屏 wrapper 只能负责定位，必须保持 `pointer-events: none`。真正需要交互的 backdrop、floating surface 或注册 overlay 再恢复 pointer events，否则空 portal 会截获任务板、日历和 resize 用例的点击。

## 证据

以 `e2e/workbench-section-performance.e2e.ts` 为准，最后一轮独立 trace 结果：

| 场景 | p95 | over33 | FunctionCall | Layout | Paint | RasterTask |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| editor-placeholders | 27.8ms | 5 | 75.9ms | 27.1ms | 49.1ms | 9250.2ms |
| editor-calendar | 28.0ms | 3 | 96.1ms | 42.7ms | 58.1ms | 9164.0ms |
| editor-task | 28.5ms | 5 | 99.9ms | 29.5ms | 54.8ms | 9233.7ms |
| editor-calendar-task | 28.8ms | 6 | 124.6ms | 44.0ms | 65.6ms | 9241.5ms |

所有场景都要求 `maxInnerTransformCount === 0`，确认拖动中没有内容层 transform 拉伸。

## 回归命令

```bash
cd /Users/kaiqiu/Documents/projects/rust/tauris/layout-v2
bun run build
bun test

cd /Users/kaiqiu/Documents/projects/rust/tauris/ofive
bunx playwright test e2e/workbench-section-performance.e2e.ts --reporter=line
OFIVE_PERF_TRACE=1 bunx playwright test e2e/workbench-section-performance.e2e.ts --reporter=line
bunx playwright test e2e/task-board.e2e.ts e2e/calendar-task-link.e2e.ts e2e/workbench-section-performance.e2e.ts --reporter=line
bunx playwright test e2e/workbench-section-performance.e2e.ts e2e/calendar-refresh.e2e.ts e2e/calendar-task-link.e2e.ts --reporter=line
```

## 继续排查时的注意事项

1. 不要只看 RasterTask 总量。它是 Chromium tile/raster 累计值，容易受并行调度和采样噪声影响；应同时看 `p95`、`over33`、`FunctionCall`、`Layout`、`Paint`。
2. 宽泛的 CSS containment、resize 中禁用全部阴影/滤镜、内容层 transform 预览都已试过，不应作为默认方向重新引入。
3. 如果继续优化绘制，优先从真实业务组件内部的固定布局约束、可见区域、重复测量和不必要 React 更新入手。
