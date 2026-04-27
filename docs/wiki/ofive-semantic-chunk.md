---
title: "ofive Semantic Chunk"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "semantic-index"
  - "chunk"
concepts:
  - "检索片段"
  - "上下文窗口"
  - "切分策略"
related:
  - "ofive-semantic-index"
  - "ofive-embedding"
  - "ofive-semantic-search"
---

# ofive Semantic Chunk

Semantic Chunk 是从笔记内容中切分出的检索片段。它应保留足够上下文，同时避免过大导致召回不精确。

## 边界

Chunk 是语义索引的派生单元，不是用户编辑的内容单元。用户仍编辑 [[ofive-note|Note]]。

## 关系

- [[ofive-embedding|Embedding]] 将 Chunk 转换为向量。
- [[ofive-semantic-search|Semantic Search]] 按语义召回 Chunk。
- [[ofive-vault|Vault]] 是 Chunk 的内容来源。

## 维护要点

1. Chunk 应能追溯到原始笔记。
2. 切分策略应平衡上下文完整性和检索精度。
3. 内容更新后相关 Chunk 应重新同步。
