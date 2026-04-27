---
title: "ofive Knowledge Graph"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "backend"
tags:
  - "ofive"
  - "knowledge-graph"
  - "graph"
concepts:
  - "知识图谱"
  - "节点"
  - "边"
  - "链接网络"
related:
  - "ofive-wikilink"
  - "ofive-backlinks"
  - "ofive-markdown-graph"
  - "ofive-query-index"
---

# ofive Knowledge Graph

Knowledge Graph 是笔记关系的图形视图。它将 WikiLink、普通链接和查询索引中的关系投影为节点与边，服务于探索、理解和维护。

## 边界

Knowledge Graph 是可视化和探索工具，不是内容事实源。它呈现关系，但不创造关系。

Knowledge Graph 也不同于语义相似图。它主要表达显式或可解析的内容关系，而不是模型推断出的相似性。

## 关系

- [[ofive-wikilink|WikiLink]] 是图边的重要来源。
- [[ofive-markdown-graph|Markdown Graph]] 是面向 Markdown 关系的派生图模型。
- [[ofive-backlinks|Backlinks]] 和 Knowledge Graph 共享反向关系语义。
- [[ofive-query-index|Query Index]] 为图谱提供可查询的关系投影。

## 维护要点

1. 图谱节点应对应稳定内容单元。
2. 图谱边应能解释来源，避免不可追踪关系。
3. 图谱刷新应跟随持久态内容更新。
4. 图谱布局属于视图状态，不应改变底层关系事实。
