---
title: "ofive Preview Mirror"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "preview"
  - "editor"
concepts:
  - "预览镜像"
  - "拖拽预览"
  - "轻量投影"
related:
  - "ofive-markdown-editor"
  - "ofive-workbench-host"
  - "ofive-tab"
---

# ofive Preview Mirror

Preview Mirror 是编辑器内容的轻量投影，用于工作台交互中的预览场景，例如拖拽预览或临时展示。

## 边界

Preview Mirror 不是内容事实源。它只镜像已有内容状态，不应产生新的内容语义。

## 关系

- [[ofive-markdown-editor|Markdown 编辑器]] 提供可镜像内容。
- [[ofive-workbench-host|Workbench Host]] 可在工作台交互中使用预览。
- [[ofive-tab|Tab]] 是预览所关联的内容实例。

## 维护要点

1. 预览应轻量，避免引入完整编辑器副作用。
2. 预览失效时应安全降级。
3. 预览不能修改原内容状态。
