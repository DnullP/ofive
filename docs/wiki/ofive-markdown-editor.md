---
title: "ofive Markdown 编辑器"
kind: "architecture"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "markdown"
  - "editor"
  - "design"
concepts:
  - "编辑态"
  - "阅读态"
  - "语法渲染"
  - "排斥区域"
related:
  - "ofive-vault-and-query-index"
  - "ofive-component-glossary"
  - "ofive-editor-edit-mode"
  - "ofive-render-parity"
---

# ofive Markdown 编辑器

Markdown 编辑器是 ofive 笔记体验的核心组件。它负责编辑、阅读、语法装饰、链接体验、图片嵌入、表格交互和内容变化事件。

## 原子词条

- [[ofive-editor-edit-mode|Editor Edit Mode]]：Markdown 编辑器的文本输入状态。
- [[ofive-editor-read-mode|Editor Read Mode]]：Markdown 编辑器的浏览渲染状态。
- [[ofive-preview-mirror|Preview Mirror]]：编辑器内容的轻量投影。
- [[ofive-line-rendering|Line Rendering]]：单行或局部文本的渲染能力。
- [[ofive-block-rendering|Block Rendering]]：结构化 Markdown 区域的渲染能力。
- [[ofive-exclusion-zone|Exclusion Zone]]：保护块级语义的排斥区域机制。
- [[ofive-render-parity|Render Parity]]：编辑态和阅读态之间的语义一致性要求。
- [[ofive-persisted-content-event|Persisted Content Event]]：连接保存和读型刷新的内容更新语义。

## 内容流

```text
Edit Mode
  -> 内容变化事件
  -> 持久态更新
  -> 读型插件刷新
```

编辑器负责内容输入和内容解释。跨文档查询、反链、图谱和语义召回应交给对应索引或插件。

## 治理原则

1. 新增块级语法必须声明排斥关系。
2. 新增文本解析能力必须跳过块级排除区域。
3. 编辑态和阅读态应同步设计。
4. 编辑器不直接承担跨模块查询职责。
