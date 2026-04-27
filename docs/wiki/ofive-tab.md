---
title: "ofive Tab"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "tab"
  - "workbench"
concepts:
  - "主工作区实例"
  - "Tab 类型"
  - "Tab 生命周期"
related:
  - "ofive-workbench"
  - "ofive-file-opener"
  - "ofive-extension-registry"
  - "ofive-workbench-host"
---

# ofive Tab

Tab 是主工作区中的内容实例。Markdown 编辑器、画布、图片查看、知识图谱、任务看板和设置页都可以以 Tab 形式呈现。

## 边界

Tab 实例不同于 Tab 类型。Tab 类型由 [[ofive-extension-registry|Extension Registry]] 注册，Tab 实例由 [[ofive-workbench-host|Workbench Host]] 打开和管理。

Tab 也不同于文件本身。一个文件可以对应一个或多个 Tab 实例，具体取决于打开策略。

## 关系

- [[ofive-file-opener|File Opener]] 将文件打开请求解析为 Tab 定义。
- [[ofive-workbench|Workbench]] 管理 Tab 的布局和激活。
- [[ofive-markdown-editor|Markdown 编辑器]] 是典型 Tab 类型。
- [[ofive-managed-store|Managed Store]] 可为跨 Tab 状态提供治理视图。

## 维护要点

1. Tab 类型标识应稳定。
2. Tab 实例 ID 应能支持恢复和去重策略。
3. Vault 切换时，应明确 Tab 生命周期作用域。
4. Tab 不应隐式拥有文件内容事实源。
