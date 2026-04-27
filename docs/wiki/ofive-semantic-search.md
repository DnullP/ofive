---
title: "ofive Semantic Search"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "semantic-search"
  - "search"
concepts:
  - "语义检索"
  - "相似片段"
  - "上下文召回"
related:
  - "ofive-semantic-index"
  - "ofive-semantic-chunk"
  - "ofive-vector-store"
  - "ofive-ai-chat"
---

# ofive Semantic Search

Semantic Search 是通过查询向量查找相似内容片段的过程。它适合 AI 上下文召回和跨措辞搜索。

## 边界

Semantic Search 是召回能力，不是事实判断。召回结果需要保留来源，不能替代原始笔记内容。

## 关系

- [[ofive-vector-store|Vector Store]] 提供相似检索。
- [[ofive-semantic-chunk|Semantic Chunk]] 是召回结果单位。
- [[ofive-ai-chat|AI Chat]] 可消费语义召回作为上下文。

## 维护要点

1. 召回结果必须可追溯到原文。
2. 语义搜索不应替代显式 WikiLink 关系。
3. 查询失败应可降级为无语义上下文。
