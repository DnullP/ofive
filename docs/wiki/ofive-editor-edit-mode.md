---
title: "ofive Editor Edit Mode"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "editor"
  - "markdown"
concepts:
  - "编辑态"
  - "文本输入"
  - "即时反馈"
related:
  - "ofive-markdown-editor"
  - "ofive-editor-read-mode"
  - "ofive-render-parity"
---

# ofive Editor Edit Mode

Editor Edit Mode 是 Markdown 编辑器的文本输入状态。它强调键盘操作、局部语法装饰、即时反馈和内容变化事件。

## 边界

编辑态负责产生内容变化，但不直接承担跨模块查询职责。查询、图谱和反链应消费持久态或派生索引。

## 关系

- [[ofive-editor-read-mode|Editor Read Mode]] 是浏览渲染状态。
- [[ofive-render-parity|Render Parity]] 要求编辑态和阅读态解释一致。
- [[ofive-persisted-content-event|Persisted Content Event]] 连接编辑变化和读型刷新。

## 维护要点

1. 编辑态新增语法能力时，应同步考虑阅读态。
2. 内容变化事件应保持可去重和可追踪。
3. 编辑态不应静默覆盖用户未保存输入。
