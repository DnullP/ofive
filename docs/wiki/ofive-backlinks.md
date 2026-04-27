---
title: "ofive Backlinks"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "backend"
tags:
  - "ofive"
  - "backlinks"
  - "knowledge"
concepts:
  - "反向链接"
  - "上下文回溯"
  - "链接依赖"
related:
  - "ofive-wikilink"
  - "ofive-backlink-query"
  - "ofive-knowledge-graph"
  - "ofive-query-index"
---

# ofive Backlinks

Backlinks 是“哪些笔记链接到当前笔记”的反向视图。它帮助用户从当前笔记回溯上下文，也帮助维护者理解文档依赖关系。

## 边界

Backlinks 是派生视图，不是内容事实源。它应从笔记内容和链接解析结果生成。

Backlinks 也不是所有引用的集合。只有被系统识别为链接关系的内容才应进入反链语义。

## 关系

- [[ofive-wikilink|WikiLink]] 是 Backlinks 的主要关系来源。
- [[ofive-backlink-query|Backlink Query]] 负责查询反向关系。
- [[ofive-knowledge-graph|Knowledge Graph]] 将反链关系可视化为图结构。
- [[ofive-query-index|Query Index]] 支撑反链查询性能。

## 维护要点

1. 反链必须随笔记内容变化而更新。
2. 反链显示应说明来源上下文，避免只给出孤立标题。
3. 链接解析规则变化时，反链结果也会变化。
4. 反链面板应消费派生查询结果，不应自行扫描全部内容。
