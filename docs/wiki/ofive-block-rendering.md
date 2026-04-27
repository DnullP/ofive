---
title: "ofive Block Rendering"
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
  - "块级渲染"
  - "结构化区域"
  - "嵌入内容"
related:
  - "ofive-line-rendering"
  - "ofive-exclusion-zone"
  - "ofive-markdown-editor"
---

# ofive Block Rendering

Block Rendering 是面向结构化 Markdown 区域的渲染能力。frontmatter、代码块、公式块、表格和图片嵌入都属于这一层。

## 边界

块级渲染拥有比行级渲染更高的结构优先级。块级区域内部不应被普通行级规则误解析。

## 关系

- [[ofive-line-rendering|Line Rendering]] 处理局部文本语义。
- [[ofive-exclusion-zone|Exclusion Zone]] 表达块级区域之间的排斥关系。
- [[ofive-frontmatter|Frontmatter]] 是典型块级结构。

## 维护要点

1. 新增块级语法必须声明排斥关系。
2. 块级渲染应保持编辑态和阅读态一致。
3. 块级区域应有清晰的开始和结束边界。
