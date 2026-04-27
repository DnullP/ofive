---
title: "ofive Backlink Query"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
tags:
  - "ofive"
  - "backlinks"
  - "query"
concepts:
  - "反链查询"
  - "关系查询"
  - "派生读模型"
related:
  - "ofive-backlinks"
  - "ofive-wikilink"
  - "ofive-query-index"
---

# ofive Backlink Query

Backlink Query 是查询“哪些笔记指向当前笔记”的读模型。它把链接关系转换成可展示、可导航的反向上下文。

## 边界

Backlink Query 不直接拥有链接关系。链接关系来自内容解析和索引投影。

## 关系

- [[ofive-backlinks|Backlinks]] 是反链查询的用户视图。
- [[ofive-wikilink|WikiLink]] 是主要关系来源。
- [[ofive-query-index|Query Index]] 提供查询性能和结构化关系。

## 维护要点

1. 查询结果应包含来源上下文。
2. 内容更新后应刷新反链投影。
3. 查询规则应与 WikiLink Resolution 保持一致。
