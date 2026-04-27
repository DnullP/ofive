---
title: "ofive Web Development"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "development"
  - "web"
concepts:
  - "Web 开发"
  - "前端验证"
  - "插件验证"
related:
  - "ofive-build-and-dev-workflow"
  - "ofive-frontend-runtime"
  - "ofive-frontend-unit"
---

# ofive Web Development

Web Development 是快速验证前端工作台、插件和 UI 行为的开发域。它适合前端反馈循环，但不代表完整桌面运行时。

## 维护要点

1. Web 通过不代表 Tauri 宿主能力通过。
2. 前端插件和布局行为可优先在 Web 开发域验证。
3. 涉及后端、文件系统或 sidecar 的能力必须进入桌面验证。
