---
title: "ofive Persisted Content Event"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "backend"
tags:
  - "ofive"
  - "event"
  - "content"
concepts:
  - "持久态内容更新"
  - "内容刷新"
  - "同步语义"
related:
  - "ofive-app-event-bus"
  - "ofive-query-index"
  - "ofive-markdown-editor"
  - "ofive-vault-tree"
---

# ofive Persisted Content Event

Persisted Content Event 表示某个内容单元的持久态已经变化。它可以来自前端保存，也可以来自外部文件系统变化。

## 边界

持久态内容更新不等于编辑器应无条件覆盖当前缓冲区。具体如何处理由编辑器、读型组件或索引 owner 决定。

## 关系

- [[ofive-app-event-bus|App Event Bus]] 分发持久态更新语义。
- [[ofive-markdown-editor|Markdown 编辑器]] 可据此刷新已缓存内容。
- [[ofive-query-index|Query Index]] 可据此刷新派生读模型。
- [[ofive-vault-tree|Vault Tree]] 只在结构变化时刷新结构视图。

## 维护要点

1. 内容更新来源应可区分。
2. 自触发保存事件应避免造成重复刷新或循环。
3. 读型组件应订阅语义事件，而不是自行解释低层文件事件。
