---
title: "ofive Render Parity"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "markdown"
  - "parity"
concepts:
  - "渲染一致性"
  - "编辑阅读一致"
  - "语义一致"
related:
  - "ofive-editor-edit-mode"
  - "ofive-editor-read-mode"
  - "ofive-exclusion-zone"
---

# ofive Render Parity

Render Parity 是编辑态和阅读态之间的语义一致性要求。用户不应在两个模式下看到互相矛盾的 Markdown 解释。

## 边界

Render Parity 关注语义一致，不要求两个模式视觉完全相同。编辑态可以显示编辑辅助，阅读态可以优化排版，但两者对内容结构的理解应一致。

## 关系

- [[ofive-editor-edit-mode|Editor Edit Mode]] 是输入状态。
- [[ofive-editor-read-mode|Editor Read Mode]] 是浏览状态。
- [[ofive-exclusion-zone|Exclusion Zone]] 是保持一致性的关键机制。

## 维护要点

1. 新增语法时必须同时考虑编辑态和阅读态。
2. 块级语法边界必须一致。
3. 不一致时，应优先修复语义解释，而不是只修样式。
