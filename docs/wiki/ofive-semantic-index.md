---
title: "ofive 语义索引"
kind: "architecture"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "semantic-index"
  - "vector"
  - "design"
concepts:
  - "语义检索"
  - "向量索引"
  - "Chunk"
  - "Embedding"
related:
  - "ofive-ai-sidecar-and-capabilities"
  - "ofive-vault-and-query-index"
  - "ofive-semantic-chunk"
  - "ofive-vector-store"
  - "ofive-semantic-index-module"
  - "ofive-derived-view"
---

# ofive 语义索引

语义索引是 ofive 的本地语义检索层。它把 Vault 中的持久态知识转化为可向量检索的 [[ofive-derived-view|Derived View]]，服务 AI 上下文增强和语义搜索。

## 原子词条

- [[ofive-semantic-chunk|Semantic Chunk]]：从笔记内容中切分出的检索片段。
- [[ofive-embedding|Embedding]]：文本片段的向量表示。
- [[ofive-vector-store|Vector Store]]：保存向量和片段元数据的派生存储。
- [[ofive-semantic-search|Semantic Search]]：按语义相似度召回内容片段。
- [[ofive-model-catalog|Model Catalog]]：可用模型及其状态目录。
- [[ofive-sync-status|Sync Status]]：派生索引与 Vault 持久态之间的一致性状态。
- [[ofive-semantic-index-module|Semantic Index Module]]：语义索引的后端模块边界。

## 派生链路

```text
Vault
  -> Semantic Chunk
  -> Embedding
  -> Vector Store
  -> Semantic Search
```

这条链路说明语义索引始终是派生层。它可以重建，不应替代 [[ofive-content-source-of-truth|Content Source of Truth]]。

## 设计边界

1. [[ofive-vault|Vault]] 是内容事实源。
2. 语义索引是派生索引。
3. AI 通过 [[ofive-capability|Capability]] 使用语义检索。
4. 模型缓存和 Vault 绑定状态应分开治理。
5. 向量检索能力不应暴露底层存储实现。
