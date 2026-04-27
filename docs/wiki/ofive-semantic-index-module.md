---
title: "ofive Semantic Index Module"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "backend"
  - "module"
  - "semantic-index"
concepts:
  - "语义索引模块"
  - "派生索引"
  - "语义召回"
related:
  - "ofive-semantic-index"
  - "ofive-semantic-chunk"
  - "ofive-embedding"
  - "ofive-vector-store"
  - "ofive-semantic-search"
---

# ofive Semantic Index Module

Semantic Index Module 是语义检索模块。它把 Vault 的持久态知识投影成可语义召回的派生索引，并向搜索和 AI 上下文增强提供能力。

## 边界

Semantic Index Module 是派生索引 owner，不是笔记事实源。它可以重建、失效、局部刷新，但不能成为 Vault 内容的权威来源。

## 关系

- [[ofive-semantic-index|Semantic Index]] 描述语义索引的整体设计。
- [[ofive-semantic-chunk|Semantic Chunk]] 是索引的文本切分单元。
- [[ofive-embedding|Embedding]] 把 chunk 转换为向量表达。
- [[ofive-vector-store|Vector Store]] 保存可召回的向量数据。
- [[ofive-semantic-search|Semantic Search]] 消费语义索引提供用户能力。

## 维护要点

1. 索引刷新应由持久态内容事件驱动。
2. 模型、chunk 策略和向量存储版本需要一起治理。
3. 召回结果必须能追溯到 Vault 内容语义，而不是只返回孤立向量。
