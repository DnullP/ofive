---
title: "ofive Exclusion Zone"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "markdown"
  - "parsing"
concepts:
  - "排斥区域"
  - "语法保护"
  - "块级边界"
related:
  - "ofive-block-rendering"
  - "ofive-line-rendering"
  - "ofive-render-parity"
---

# ofive Exclusion Zone

Exclusion Zone 是 Markdown 块级语法之间的排斥区域机制。它避免代码块、公式块或其他结构化区域内的文本被误识别为标题、链接或其他语法。

## 边界

Exclusion Zone 是解析治理机制，不是视觉样式。它的目标是保护语义边界。

## 关系

- [[ofive-block-rendering|Block Rendering]] 提供块级区域。
- [[ofive-line-rendering|Line Rendering]] 必须尊重排斥区域。
- [[ofive-render-parity|Render Parity]] 依赖一致的排斥规则。

## 维护要点

1. 新增块级语法时，必须评估排斥范围。
2. 排斥区域应在编辑态和阅读态一致。
3. 排斥规则过宽会漏渲染，过窄会误渲染。
