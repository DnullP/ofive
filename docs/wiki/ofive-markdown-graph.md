---
title: "ofive Markdown Graph"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "frontend"
tags:
  - "ofive"
  - "markdown"
  - "graph"
concepts:
  - "Markdown 关系图"
  - "节点"
  - "边"
related:
  - "ofive-knowledge-graph"
  - "ofive-wikilink"
  - "ofive-query-index"
---

# ofive Markdown Graph

Markdown Graph 是从 Markdown 内容中派生出的关系图模型。它把笔记、链接和可解析关系转换成图谱可消费的节点与边。

## 边界

Markdown Graph 是派生模型，不是图谱布局。布局只是展示方式，关系模型才是可查询语义。

## 关系

- [[ofive-knowledge-graph|Knowledge Graph]] 展示图模型。
- [[ofive-wikilink|WikiLink]] 提供显式关系。
- [[ofive-query-index|Query Index]] 可维护图关系投影。

## 维护要点

1. 节点和边应能追溯到内容来源。
2. 内容更新应触发图关系刷新。
3. 图模型不应混入视图布局偏好。
