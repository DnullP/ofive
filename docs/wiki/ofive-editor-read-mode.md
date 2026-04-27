---
title: "ofive Editor Read Mode"
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
  - "阅读态"
  - "稳定渲染"
  - "内容浏览"
related:
  - "ofive-markdown-editor"
  - "ofive-editor-edit-mode"
  - "ofive-render-parity"
---

# ofive Editor Read Mode

Editor Read Mode 是 Markdown 编辑器的浏览渲染状态。它强调稳定渲染、链接跳转、视觉一致性和内容浏览。

## 边界

阅读态展示内容，不是新的内容事实源。它应根据持久态内容或编辑器可靠快照渲染。

## 关系

- [[ofive-editor-edit-mode|Editor Edit Mode]] 负责内容输入。
- [[ofive-render-parity|Render Parity]] 约束两个模式的语义一致性。
- [[ofive-wikilink|WikiLink]] 和 [[ofive-frontmatter|Frontmatter]] 都需要阅读态正确呈现。

## 维护要点

1. 阅读态解析规则应与编辑态保持一致。
2. 阅读态交互不应破坏编辑缓存。
3. 链接跳转和嵌入内容需要明确失败反馈。
