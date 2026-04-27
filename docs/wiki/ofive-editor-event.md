---
title: "ofive Editor Event"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "event"
  - "editor"
concepts:
  - "编辑器事件"
  - "编辑语义"
  - "定位请求"
related:
  - "ofive-app-event-bus"
  - "ofive-markdown-editor"
  - "ofive-editor-edit-mode"
  - "ofive-editor-read-mode"
---

# ofive Editor Event

Editor Event 是 Markdown 编辑器向前端运行时表达的用户编辑语义，例如内容变化、焦点变化、定位请求和命令请求。

## 边界

Editor Event 应描述用户意图和编辑状态，不应暴露编辑器内部实现细节。编辑器内部数据结构变化不应直接成为公共事件语义。

## 关系

- [[ofive-markdown-editor|Markdown Editor]] 是编辑器事件的主要 owner。
- [[ofive-app-event-bus|App Event Bus]] 分发跨组件需要感知的编辑语义。
- [[ofive-editor-edit-mode|Editor Edit Mode]] 和 [[ofive-editor-read-mode|Editor Read Mode]] 可能产生不同事件。

## 维护要点

1. 新增事件前，确认它是否是稳定用户语义。
2. 定位和命令请求应与内容持久态更新区分。
3. 订阅者应在生命周期结束时清理事件监听。
