---
title: "ofive Panel"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "panel"
  - "sidebar"
concepts:
  - "侧边栏面板"
  - "辅助信息"
  - "Activity 归属"
related:
  - "ofive-activity"
  - "ofive-workbench"
  - "ofive-workbench-host"
  - "ofive-extension-registry"
---

# ofive Panel

Panel 是工作台侧边栏中的功能面板。它通常展示当前 Vault、当前笔记或当前编辑器上下文相关的辅助信息。

## 边界

Panel 是辅助视图，不是主任务容器。主编辑、图谱、画布或任务看板等长期工作区通常应以 [[ofive-tab|Tab]] 呈现。

Panel 不应绕过工作台直接管理布局。它应通过 Activity 归属和 Workbench Host 上下文进入界面。

## 关系

- [[ofive-activity|Activity]] 是 Panel 的入口分组。
- [[ofive-workbench-host|Workbench Host]] 负责渲染 Panel。
- [[ofive-app-event-bus|App Event Bus]] 可触发 Panel 重新读取派生数据。
- [[ofive-managed-store|Managed Store]] 可为 Panel 提供共享状态。

## 维护要点

1. Panel 应声明明确归属 Activity。
2. Panel 应避免持有唯一业务事实源。
3. Panel 首屏加载和空态需要可解释。
4. Panel 订阅事件时必须清理订阅。
