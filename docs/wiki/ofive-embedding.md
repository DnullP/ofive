---
title: "ofive Embedding"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "ai"
  - "backend"
tags:
  - "ofive"
  - "embedding"
  - "vector"
concepts:
  - "向量表示"
  - "语义相似"
  - "模型输出"
related:
  - "ofive-semantic-chunk"
  - "ofive-vector-store"
  - "ofive-model-catalog"
---

# ofive Embedding

Embedding 是文本片段的向量表示。它让系统能够按语义相似度检索，而不是只按关键词匹配。

## 边界

Embedding 是派生数据，不是内容事实源。模型或策略变化时，Embedding 可以重新生成。
  
## 关系

- [[ofive-semantic-chunk|Semantic Chunk]] 是 Embedding 的输入。
- [[ofive-vector-store|Vector Store]] 保存向量和片段元数据。
- [[ofive-model-catalog|Model Catalog]] 描述可用 embedding 模型。

## 维护要点

1. Embedding 必须能追溯到原始 Chunk。
2. 模型变化可能要求重建向量。
3. 向量质量问题应反馈到模型和切分策略治理。
