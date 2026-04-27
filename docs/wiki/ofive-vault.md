---
title: "ofive Vault"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
  - "backend"
tags:
  - "ofive"
  - "vault"
  - "knowledge"
concepts:
  - "本地知识库"
  - "内容事实源"
  - "配置容器"
related:
  - "ofive-vault-and-query-index"
  - "ofive-query-index"
  - "ofive-vault-tree"
  - "ofive-note"
---

# ofive Vault

Vault 是 ofive 的本地知识库容器。它保存用户笔记、画布、媒体和与当前知识库相关的配置状态，是内容事实源的最高边界。

## 边界

Vault 拥有原始内容，但不拥有所有派生视图。文件树、反链、图谱、搜索结果和语义召回都应视为从 Vault 派生出来的读模型。

Vault 也不是前端工作台布局本身。工作台可以围绕当前 Vault 恢复界面，但布局状态不能替代 Vault 内容事实源。

## 关系

- [[ofive-note|Note]] 是 Vault 中最常见的知识单元。
- [[ofive-query-index|Query Index]] 为 Vault 提供结构化查询能力。
- [[ofive-vault-tree|Vault Tree]] 是 Vault 内容结构的浏览投影。
- [[ofive-semantic-index|语义索引]] 从 Vault 内容派生语义检索能力。

## 维护要点

1. Vault 切换会影响目录树、配置、查询索引、语义索引和工作台恢复。
2. 任何派生视图都必须能从 Vault 内容重新生成。
3. Vault 内部配置属于知识库上下文，不应被当成应用全局状态。
4. 修改 Vault 行为时，优先检查事实源与派生视图是否仍保持一致。
