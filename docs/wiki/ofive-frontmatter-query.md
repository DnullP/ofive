---
title: "ofive Frontmatter Query"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
tags:
  - "ofive"
  - "frontmatter"
  - "query"
concepts:
  - "字段查询"
  - "结构化筛选"
  - "元数据聚合"
related:
  - "ofive-frontmatter"
  - "ofive-query-index"
  - "ofive-note"
---

# ofive Frontmatter Query

Frontmatter Query 是基于笔记结构化元数据的查询能力。它让维护者和用户可以按状态、标签、负责人、分类等字段筛选内容。

## 边界

Frontmatter Query 消费字段，不定义字段。字段语义应由 [[ofive-frontmatter|Frontmatter]] 和 wiki 写作规范维护。

## 关系

- [[ofive-frontmatter|Frontmatter]] 提供结构化字段。
- [[ofive-query-index|Query Index]] 提供派生查询能力。
- [[ofive-note|Note]] 是字段所属内容单元。

## 维护要点

1. 查询字段应稳定。
2. 字段值类型应尽量结构化。
3. 查询结果应允许回到原始笔记。
