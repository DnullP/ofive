---
title: "ofive Vault 与查询索引"
kind: "architecture"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "frontend"
tags:
  - "ofive"
  - "vault"
  - "query-index"
  - "knowledge"
concepts:
  - "Vault"
  - "Query Index"
  - "WikiLink"
  - "Backlinks"
  - "Frontmatter"
related:
  - "ofive-concept-glossary"
  - "ofive-markdown-editor"
  - "ofive-semantic-index"
  - "ofive-vault"
  - "ofive-query-index"
  - "ofive-content-source-of-truth"
  - "ofive-derived-view"
---

# ofive Vault 与查询索引

[[ofive-vault|Vault]] 是 ofive 的 [[ofive-content-source-of-truth|Content Source of Truth]]，[[ofive-query-index|Query Index]] 是围绕 Vault 构建的 [[ofive-derived-view|Derived View]]。二者共同支撑文件树、搜索、wikilink、frontmatter、backlinks 和知识图谱。

## 原子词条

- [[ofive-vault|Vault]]：本地知识库容器和内容事实源。
- [[ofive-vault-tree|Vault Tree]]：Vault 内容结构的浏览投影。
- [[ofive-content-source-of-truth|Content Source of Truth]]：本地内容权威来源。
- [[ofive-derived-view|Derived View]]：从内容事实源计算出的可重建视图。
- [[ofive-query-index|Query Index]]：面向结构化读取的派生索引。
- [[ofive-wikilink|WikiLink]]：笔记之间的显式语义链接。
- [[ofive-wikilink-resolution|WikiLink Resolution]]：链接目标解析过程。
- [[ofive-backlinks|Backlinks]]：反向链接视图。
- [[ofive-backlink-query|Backlink Query]]：反向关系查询能力。
- [[ofive-markdown-graph|Markdown Graph]]：Markdown 关系图模型。
- [[ofive-frontmatter|Frontmatter]]：结构化元数据。
- [[ofive-frontmatter-query|Frontmatter Query]]：字段查询能力。
- [[ofive-persisted-content-event|Persisted Content Event]]：持久态内容更新语义。

## 事实源与派生视图

```text
Vault
  -> Query Index
  -> Backlinks / Graph / Frontmatter Query / Search
```

内容以 [[ofive-vault|Vault]] 为准。[[ofive-query-index|Query Index]] 可以重建，用户内容不能丢失。

## 设计边界

1. 编辑器负责产生内容变化。
2. Vault 负责保存内容事实。
3. 查询索引负责高频读。
4. 插件负责把查询结果转化为用户视图。
5. 语义索引负责更高层的语义召回。
