---
title: "ofive Desktop Development"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
  - "backend"
tags:
  - "ofive"
  - "desktop"
  - "development"
concepts:
  - "桌面开发"
  - "宿主验证"
  - "原生能力"
related:
  - "ofive-build-and-dev-workflow"
  - "ofive-backend-module-platform"
  - "ofive-sidecar"
---

# ofive Desktop Development

Desktop Development 是验证桌面宿主、窗口能力、后端命令、文件系统和 sidecar 联动的开发域。

## 维护要点

1. 涉及 Vault 文件系统、窗口能力或后端命令时，需要桌面域验证。
2. 桌面域问题应区分前端投影、宿主命令和后端模块 owner。
3. Sidecar 联动应同时关注进程边界和 capability 边界。
