---
title: "ofive Mouse Drag Audit"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "testing"
  - "drag"
concepts:
  - "拖拽审计"
  - "命中区域"
  - "交互时序"
related:
  - "ofive-browser-e2e"
  - "ofive-workbench"
  - "ofive-local-layout-dependency"
---

# ofive Mouse Drag Audit

Mouse Drag Audit 验证高保真拖拽、命中区域和交互时序。它比普通 E2E 更接近真实用户操作。

## 维护要点

1. 拖拽、拆分、悬停预览和命中区域变化需要审计。
2. 审计应关注中间状态，而不只是最终结果。
3. 布局依赖升级后应优先复核拖拽行为。
