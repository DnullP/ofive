---
title: "ofive Model Catalog"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "ai"
  - "maintainers"
tags:
  - "ofive"
  - "model"
  - "catalog"
concepts:
  - "模型目录"
  - "Embedding 模型"
  - "模型资产"
related:
  - "ofive-embedding"
  - "ofive-semantic-index"
  - "ofive-sidecar"
---

# ofive Model Catalog

Model Catalog 描述可用模型及其状态。对语义索引而言，它主要说明 embedding 模型的可用性和治理信息。

## 边界

Model Catalog 是模型资产目录，不是单个 Vault 的内容配置。模型可被多个知识库使用。

## 关系

- [[ofive-embedding|Embedding]] 依赖模型生成向量。
- [[ofive-sidecar|Sidecar]] 可承接模型相关运行时能力。
- [[ofive-semantic-index|语义索引]] 根据模型状态决定同步能力。

## 维护要点

1. 模型可用性应可解释。
2. 模型变化可能触发索引重建。
3. 模型资产治理应与 Vault 内容治理分离。
