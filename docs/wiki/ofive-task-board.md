---
title: "ofive Task Board"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "vault"
tags:
  - "ofive"
  - "task"
  - "board"
concepts:
  - "任务看板"
  - "任务语法"
  - "聚合视图"
related:
  - "ofive-query-index"
  - "ofive-vault-search"
  - "ofive-panel"
  - "ofive-tab"
---

# ofive Task Board

Task Board 是从笔记中的任务语义派生出的聚合视图。它把散落在 Vault 中的任务组织成可扫描、可筛选、可操作的看板。

## 边界

Task Board 是派生视图，不是任务事实源。任务事实仍在笔记内容中，查询索引负责把它们聚合出来。

## 关系

- [[ofive-query-index|Query Index]] 支撑任务聚合。
- [[ofive-vault-search|Vault Search]] 可提供任务搜索入口。
- [[ofive-panel|Panel]] 或 [[ofive-tab|Tab]] 可以承载任务视图。

## 维护要点

1. 修改任务语法时，需要同步查询和渲染语义。
2. 看板操作如果改变任务状态，必须写回笔记事实源。
3. 聚合结果应能解释来源笔记。
