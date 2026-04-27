---
title: "ofive Sync Status"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "sync"
  - "status"
concepts:
  - "同步状态"
  - "索引一致性"
  - "后台任务"
related:
  - "ofive-semantic-index"
  - "ofive-vector-store"
  - "ofive-persisted-content-event"
---

# ofive Sync Status

Sync Status 描述派生索引与 Vault 持久态内容之间的一致性状态。它帮助用户和维护者理解索引是否可用、是否过期、是否正在重建。

## 边界

Sync Status 是状态描述，不是内容本身。它不能修复内容，只能引导同步或重建。

## 关系

- [[ofive-semantic-index|语义索引]] 需要同步状态表达可用性。
- [[ofive-vector-store|Vector Store]] 的一致性由同步状态描述。
- [[ofive-persisted-content-event|Persisted Content Event]] 可触发同步状态变化。

## 维护要点

1. 同步状态应区分空闲、运行、失败和过期。
2. 失败状态应可恢复。
3. 状态展示应避免误导用户认为内容丢失。
