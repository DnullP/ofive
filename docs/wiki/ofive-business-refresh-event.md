---
title: "ofive Business Refresh Event"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "event"
  - "refresh"
concepts:
  - "业务刷新事件"
  - "读型组件刷新"
  - "派生视图失效"
related:
  - "ofive-app-event-bus"
  - "ofive-persisted-content-event"
  - "ofive-query-index"
  - "ofive-vault-tree"
---

# ofive Business Refresh Event

Business Refresh Event 是提醒读型组件重新读取或失效派生视图的前端语义事件。它表达“某类业务投影需要刷新”，而不是低层事件来源。

## 边界

Business Refresh Event 不是内容事实源。它只提示消费者重新计算、重新读取或失效缓存。

## 关系

- [[ofive-persisted-content-event|Persisted Content Event]] 可触发业务刷新事件。
- [[ofive-query-index|Query Index]] 可根据刷新语义重建派生查询。
- [[ofive-vault-tree|Vault Tree]] 可根据结构刷新语义更新浏览投影。

## 维护要点

1. 刷新事件应表达领域语义，避免暴露低层文件系统细节。
2. 刷新消费者需要幂等处理。
3. 不同刷新范围应可区分，避免全量刷新成为默认策略。
