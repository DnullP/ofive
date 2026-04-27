---
title: "ofive Note"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "backend"
tags:
  - "ofive"
  - "note"
  - "markdown"
concepts:
  - "笔记"
  - "知识单元"
  - "Markdown 文档"
related:
  - "ofive-vault"
  - "ofive-markdown-editor"
  - "ofive-frontmatter"
  - "ofive-wikilink"
---

# ofive Note

Note 是 ofive 面向用户的知识单元，通常由 Markdown 内容承载。它可以包含标题、正文、frontmatter、wikilink、标签、任务、嵌入内容和外部引用。

## 边界

Note 是内容单元，不是编辑器实例。一个 Note 可以被多个 tab 打开，也可以被搜索、图谱、反链和语义索引读取。

Note 也不是查询结果。查询结果只是基于 Note 内容生成的派生视图。

## 关系

- [[ofive-vault|Vault]] 是 Note 的容器。
- [[ofive-markdown-editor|Markdown 编辑器]] 是 Note 的主要编辑界面。
- [[ofive-frontmatter|Frontmatter]] 提供结构化元数据。
- [[ofive-wikilink|WikiLink]] 让 Note 形成知识网络。
- [[ofive-backlinks|Backlinks]] 提供反向上下文。

## 维护要点

1. Note 的事实源是持久态内容。
2. 编辑器缓存必须与持久态内容保持清晰同步语义。
3. 新增 Note 结构时，应评估查询索引、图谱和语义索引是否需要同步理解。
4. Note 的用户可见语义应优先由内容结构表达，而不是隐藏在界面状态中。
