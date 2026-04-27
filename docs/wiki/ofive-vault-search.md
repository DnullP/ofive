---
title: "ofive Vault Search"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "vault"
tags:
  - "ofive"
  - "search"
  - "vault"
concepts:
  - "Vault 搜索"
  - "文本查询"
  - "结构化结果"
related:
  - "ofive-query-index"
  - "ofive-frontmatter-query"
  - "ofive-semantic-search"
  - "ofive-vault"
---

# ofive Vault Search

Vault Search 是面向本地知识库的文本和结构化搜索能力。它帮助用户按文件名、正文、标签和元数据找到笔记。

## 边界

Vault Search 是查询能力，不是内容事实源。它从 [[ofive-vault|Vault]] 和 [[ofive-query-index|Query Index]] 派生结果。

## 关系

- [[ofive-query-index|Query Index]] 支撑普通文本和结构化查询。
- [[ofive-frontmatter-query|Frontmatter Query]] 支撑元数据过滤。
- [[ofive-semantic-search|Semantic Search]] 是语义召回能力，不替代普通 Vault 搜索。

## 维护要点

1. 搜索结果应可追溯到 Vault 内容。
2. 普通搜索和语义搜索需要清晰区分。
3. 索引失效后应有可解释刷新路径。
