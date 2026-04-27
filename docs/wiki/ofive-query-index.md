---
title: "ofive Query Index"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
tags:
  - "ofive"
  - "query-index"
  - "search"
concepts:
  - "派生索引"
  - "读模型"
  - "结构化查询"
related:
  - "ofive-vault"
  - "ofive-frontmatter-query"
  - "ofive-backlink-query"
  - "ofive-markdown-graph"
---

# ofive Query Index

Query Index 是面向读查询的派生索引。它从 Vault 内容中提取便于搜索、反链、图谱、frontmatter 和快速跳转使用的信息。

## 边界

Query Index 不是内容事实源。它可以重建，也可以失效后重新同步。用户知识内容仍由 [[ofive-vault|Vault]] 保存。

Query Index 也不同于 [[ofive-semantic-index|语义索引]]。前者偏结构化查询和显式关系，后者偏向量召回和语义相似。

## 关系

- [[ofive-frontmatter-query|Frontmatter Query]] 消费结构化字段。
- [[ofive-backlink-query|Backlink Query]] 消费链接关系。
- [[ofive-markdown-graph|Markdown Graph]] 消费文档关系投影。
- [[ofive-persisted-content-event|Persisted Content Event]] 是刷新索引的重要触发语义。

## 维护要点

1. 索引必须能从 Vault 内容重新生成。
2. 索引更新应跟随持久态内容变化。
3. 查询结果应可解释来源，不能只返回不可追踪片段。
4. 索引失败时，应提供可恢复路径，而不是污染内容事实源。
