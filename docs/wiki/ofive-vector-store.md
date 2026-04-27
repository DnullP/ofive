---
title: "ofive Vector Store"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "vector-store"
  - "semantic-index"
concepts:
  - "向量存储"
  - "派生存储"
  - "相似检索"
related:
  - "ofive-embedding"
  - "ofive-semantic-search"
  - "ofive-sync-status"
---

# ofive Vector Store

Vector Store 是保存向量和片段元数据的派生存储。它支撑语义相似检索，但不拥有用户内容事实源。

## 边界

Vector Store 可以重建。它的失效不应导致 Vault 内容丢失。

## 关系

- [[ofive-embedding|Embedding]] 是 Vector Store 的主要数据。
- [[ofive-semantic-search|Semantic Search]] 查询 Vector Store。
- [[ofive-sync-status|Sync Status]] 描述它与 Vault 内容的一致性。

## 维护要点

1. 向量记录应能回溯到 Chunk 和 Note。
2. 重建流程应可恢复。
3. 存储实现不应泄露到能力消费者。
