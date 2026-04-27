---
title: "ofive Vault Module"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "vault"
tags:
  - "ofive"
  - "backend"
  - "module"
  - "vault"
concepts:
  - "Vault 模块"
  - "内容事实源"
  - "本地知识库"
related:
  - "ofive-vault"
  - "ofive-query-index"
  - "ofive-frontmatter"
  - "ofive-wikilink"
  - "ofive-persisted-content-event"
---

# ofive Vault Module

Vault Module 是本地知识库事实源模块。它负责笔记、目录、媒体、画布和结构化元数据等内容能力，并向查询、图谱和编辑器提供稳定边界。

## 边界

Vault Module 拥有本地内容事实源。查询索引、语义索引、图谱和前端树视图都是派生视图，不应反向成为内容事实源。

## 关系

- [[ofive-vault|Vault]] 是用户知识库的概念边界。
- [[ofive-query-index|Query Index]] 从 Vault 内容派生可查询结构。
- [[ofive-frontmatter|Frontmatter]] 和 [[ofive-wikilink|Wikilink]] 是 Vault 内容语义的一部分。
- [[ofive-persisted-content-event|Persisted Content Event]] 表示 Vault 持久态发生变化。

## 维护要点

1. 写入内容时，应保持事实源、事件和派生索引的语义一致。
2. 外部变更、编辑器保存和同步写入都应汇入同一内容更新语义。
3. 其他模块只能通过稳定公共面消费 Vault 能力。
