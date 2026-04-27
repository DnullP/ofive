---
title: "ofive WikiLink"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "backend"
tags:
  - "ofive"
  - "wikilink"
  - "knowledge-graph"
concepts:
  - "双链"
  - "链接解析"
  - "知识网络"
related:
  - "ofive-note"
  - "ofive-wikilink-resolution"
  - "ofive-backlinks"
  - "ofive-knowledge-graph"
---

# ofive WikiLink

WikiLink 是笔记之间的显式语义链接。它让笔记不只是孤立文本，而能形成可浏览、可反查、可建图的知识网络。

## 边界

WikiLink 是内容语义，不是 UI 跳转按钮。编辑器、查询索引、反链和图谱都可以消费 WikiLink，但它们不拥有 WikiLink 本身。

WikiLink 也不是普通全文搜索。它表达作者明确建立的关系，而不是系统推断出来的相似性。

## 关系

- [[ofive-wikilink-resolution|WikiLink Resolution]] 负责把链接目标解析为具体笔记。
- [[ofive-backlinks|Backlinks]] 从反方向展示 WikiLink 关系。
- [[ofive-knowledge-graph|Knowledge Graph]] 将 WikiLink 投影为图关系。
- [[ofive-markdown-editor|Markdown 编辑器]] 提供 WikiLink 编辑、建议和跳转体验。

## 维护要点

1. WikiLink 解析规则应稳定，避免同一文本在不同界面中指向不同目标。
2. WikiLink 更新应触发相关派生视图刷新。
3. 别名、重复标题和跨目录目标需要有明确解析策略。
4. WikiLink 语义应保持可解释，不应被语义搜索结果替代。
