---
title: "ofive Line Rendering"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "markdown"
  - "rendering"
concepts:
  - "行级渲染"
  - "局部语法"
  - "文本装饰"
related:
  - "ofive-markdown-editor"
  - "ofive-block-rendering"
  - "ofive-exclusion-zone"
---

# ofive Line Rendering

Line Rendering 是面向单行或局部文本的 Markdown 渲染能力。标题、加粗、标签、链接和引用等语义通常属于这一层。

## 边界

行级渲染不应穿透块级排斥区域。代码块、公式块和其他块级结构内部的文本应优先遵循块级语义。

## 关系

- [[ofive-block-rendering|Block Rendering]] 处理结构化区域。
- [[ofive-exclusion-zone|Exclusion Zone]] 防止行级规则误入块级区域。
- [[ofive-render-parity|Render Parity]] 要求行级语义在编辑态和阅读态一致。

## 维护要点

1. 新增行级规则时，应检查排斥区域。
2. 行级装饰应避免改变原始文本。
3. 行级渲染和跳转交互应保持可预测。
