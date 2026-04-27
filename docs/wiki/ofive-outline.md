---
title: "ofive Outline"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "markdown"
tags:
  - "ofive"
  - "markdown"
  - "outline"
concepts:
  - "文档大纲"
  - "标题导航"
  - "结构投影"
related:
  - "ofive-markdown-editor"
  - "ofive-query-index"
  - "ofive-panel"
  - "ofive-line-rendering"
---

# ofive Outline

Outline 是当前 Markdown 文档的标题结构投影。它帮助用户在长文档中导航，并为阅读、编辑和侧边栏提供文档结构视图。

## 边界

Outline 是当前文档结构视图，不是独立内容事实源。标题变更后，Outline 应从 Markdown 内容重新派生。

## 关系

- [[ofive-markdown-editor|Markdown Editor]] 产生和消费当前文档结构。
- [[ofive-panel|Panel]] 可承载 Outline 视图。
- [[ofive-query-index|Query Index]] 可提供跨文档结构查询。
- [[ofive-line-rendering|Line Rendering]] 影响标题在编辑态的显示。

## 维护要点

1. Outline 应跟随当前文档内容变化刷新。
2. 标题识别应与 Markdown 渲染语义保持一致。
3. 导航动作不应改变文档内容事实源。
