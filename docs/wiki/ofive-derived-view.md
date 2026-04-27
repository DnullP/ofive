---
title: "ofive Derived View"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "index"
  - "view"
concepts:
  - "派生视图"
  - "派生索引"
  - "可重建投影"
related:
  - "ofive-content-source-of-truth"
  - "ofive-query-index"
  - "ofive-semantic-index"
  - "ofive-knowledge-graph"
  - "ofive-vault-tree"
---

# ofive Derived View

Derived View 是从内容事实源计算出的可重建视图。它可以服务搜索、图谱、反链、文件树、任务聚合和 AI 召回。

## 边界

Derived View 不拥有内容真实性。它可以缓存、失效、重建或局部刷新，但不能替代 [[ofive-content-source-of-truth|Content Source of Truth]]。

## 关系

- [[ofive-query-index|Query Index]] 是结构化派生视图。
- [[ofive-semantic-index|Semantic Index]] 是语义派生索引。
- [[ofive-knowledge-graph|Knowledge Graph]] 是关系派生视图。
- [[ofive-vault-tree|Vault Tree]] 是结构浏览投影。

## 维护要点

1. 派生视图需要清晰的失效和重建语义。
2. 派生结果应能追溯到来源内容。
3. 当派生视图与事实源冲突时，以事实源为准。
